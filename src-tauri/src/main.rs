#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(debug_assertions))]
use std::{
    process::{Child, Command, Stdio},
    sync::Mutex,
};
#[cfg(not(debug_assertions))]
use tauri::{path::BaseDirectory, Manager};
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::os::windows::process::CommandExt;

#[cfg(all(not(debug_assertions), target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(not(debug_assertions))]
struct BackendProcess(Mutex<Option<Child>>);

#[cfg(not(debug_assertions))]
impl Drop for BackendProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let runtime_name = if cfg!(target_os = "windows") {
                    "runtime/node-runtime.exe"
                } else {
                    "runtime/node-runtime"
                };
                let runtime_path = app
                    .path()
                    .resolve(runtime_name, BaseDirectory::Resource)?;
                let server_path = app
                    .path()
                    .resolve("runtime/server/index.js", BaseDirectory::Resource)?;

                let mut command = Command::new(runtime_path);
                command
                    .arg(server_path)
                    .env("AGENT_OFFICE_DESKTOP", "1")
                    .env("HOST", "127.0.0.1")
                    .env("PORT", "3001")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());

                #[cfg(target_os = "windows")]
                command.creation_flags(CREATE_NO_WINDOW);

                match command.spawn() {
                    Ok(child) => {
                        app.manage(BackendProcess(Mutex::new(Some(child))));
                    }
                    Err(error) => {
                        // Keep the shell visible so diagnostics can report startup failure.
                        eprintln!("Agent Office backend failed to start: {error}");
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Office");

    app.run(|_app_handle, _event| {});
}
