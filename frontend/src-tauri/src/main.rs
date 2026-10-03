// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct AppState {
    port: u16,
    token: String,
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
    token: String,
}

#[tauri::command]
fn get_tauri_conf(state: tauri::State<'_, AppState>) -> AppConf {
    AppConf {
        port: state.port,
        token: state.token.clone(),
    }
}

fn data_directory(default: &Path) -> PathBuf {
    std::fs::read(default.join("storage.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| {
            value
                .get("directory")
                .and_then(|value| value.as_str())
                .map(PathBuf::from)
        })
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| default.to_path_buf())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_windows_file_drop::init())
        .setup(|app| {
            // Each desktop instance owns its backend; the standalone server uses 7877.
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            let token = uuid::Uuid::new_v4().simple().to_string();
            drop(listener);
            // This stable location contains the startup locator. All managed data,
            // including runtime installations, follows the root selected in settings.
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let (mut rx, child) = app
                .shell()
                .sidecar("omnigallery_api_server")?
                .current_dir(&data_dir)
                .args(["--port", &port.to_string(), "--allow-cors"])
                .env("OMNIGALLERY_DATA_DIR", &data_dir)
                // Read only during the one-time upgrade from separate component paths.
                .env("OMNIGALLERY_LEGACY_CACHE_DIR", app.path().app_cache_dir()?)
                .env("OMNIGALLERY_DESKTOP_TOKEN", &token)
                .spawn()?;
            app.manage(AppState {
                port,
                token,
                child: Mutex::new(Some(child)),
            });
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    let (level, bytes) = match event {
                        CommandEvent::Stdout(bytes) => ("INFO", bytes),
                        CommandEvent::Stderr(bytes) => ("ERROR", bytes),
                        _ => continue,
                    };
                    // Resolve after startup migration; never hold an old-root log open.
                    let log_dir = data_directory(&data_dir).join("logs");
                    if std::fs::create_dir_all(&log_dir).is_ok() {
                        if let Ok(mut log_file) = OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(log_dir.join("desktop.log"))
                        {
                            let _ = writeln!(
                                log_file,
                                "{} [{}] {}",
                                Local::now().format("%Y-%m-%d %H:%M:%S"),
                                level,
                                String::from_utf8_lossy(&bytes)
                            );
                        }
                    }
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
