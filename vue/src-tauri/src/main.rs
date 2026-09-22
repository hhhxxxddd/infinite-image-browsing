// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

struct AppState {
    port: u16,
    child: Mutex<Option<CommandChild>>,
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(serde::Serialize)]
struct AppConf {
    port: u16,
}

#[tauri::command]
fn get_tauri_conf(state: tauri::State<'_, AppState>) -> AppConf {
    AppConf { port: state.port }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Each desktop instance owns its backend; the standalone server uses 7877.
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            let mut log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_dir.join("iib_api_server.log"))?;
            let (mut rx, child) = app.shell().sidecar("iib_api_server")?
                .args(["--port", &port.to_string(), "--allow_cors"])
                .spawn()?;
            app.manage(AppState { port, child: Mutex::new(Some(child)) });
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    let (level, bytes) = match event {
                        CommandEvent::Stdout(bytes) => ("INFO", bytes),
                        CommandEvent::Stderr(bytes) => ("ERROR", bytes),
                        _ => continue,
                    };
                    let _ = writeln!(log_file, "{} [{}] {}", Local::now().format("%Y-%m-%d %H:%M:%S"), level, String::from_utf8_lossy(&bytes));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_tauri_conf])
        .build(tauri::generate_context!())
        .expect("error while building the desktop application");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                if let Ok(mut child) = state.child.lock() {
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
