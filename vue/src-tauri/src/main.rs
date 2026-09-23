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

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetDriveTypeW(root_path: *const u16) -> u32;
}

#[tauri::command]
fn can_native_drag(paths: Vec<String>) -> bool {
    #[cfg(windows)]
    {
        !paths.is_empty() && paths.iter().all(|path| {
            let bytes = path.as_bytes();
            // drag-rs currently has an open Windows crash for SMB/UNC paths.
            if path.starts_with("\\\\") || path.starts_with("//") {
                return false;
            }
            if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
                return false;
            }
            let root = [bytes[0] as u16, b':' as u16, b'\\' as u16, 0];
            matches!(unsafe { GetDriveTypeW(root.as_ptr()) }, 2 | 3 | 5 | 6)
        })
    }
    #[cfg(not(windows))]
    {
        !paths.is_empty()
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_windows_file_drop::init())
        .setup(|app| {
            // Each desktop instance owns its backend; the standalone server uses 7877.
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);
            let log_dir = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_dir)?;
            // Keep the bundled server's database, backups, exports and logs in
            // a writable location regardless of how Windows launches the app.
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_dir.join("iib_api_server.log"))?;
            let (mut rx, child) = app.shell().sidecar("iib_api_server")?
                .current_dir(&data_dir)
                .args(["--port", &port.to_string(), "--allow_cors"])
                .env("IIB_DEFAULT_CACHE_DIR", app.path().app_cache_dir()?)
                .env("IIB_MODEL_DIR", data_dir.join("models"))
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
        .invoke_handler(tauri::generate_handler![get_tauri_conf, can_native_drag])
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
