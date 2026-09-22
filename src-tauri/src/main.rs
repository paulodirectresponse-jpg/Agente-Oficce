#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::OpenOptions,
    io::Write,
    net::TcpListener,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{path::BaseDirectory, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendRuntime {
    child: Mutex<Option<Child>>,
    url: String,
}

impl BackendRuntime {
    fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

impl Drop for BackendRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tauri::command]
fn backend_url(runtime: State<'_, BackendRuntime>) -> String {
    runtime.url.clone()
}

fn reserve_loopback_port() -> Result<u16, std::io::Error> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_url])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

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
            let runtime_dir = app
                .path()
                .resolve("runtime", BaseDirectory::Resource)?;

            // In development, the Node/Vite stack is started by beforeDevCommand.
            // In an installed build, the bundled runtime is present and is launched here.
            if !runtime_path.exists() || !server_path.exists() {
                app.manage(BackendRuntime {
                    child: Mutex::new(None),
                    url: "http://127.0.0.1:3001".to_string(),
                });
                return Ok(());
            }

            let log_path = data_dir.join("backend.log");
            let mut log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)?;
            let _ = writeln!(
                log,
                "\n=== Agent Office backend startup ===\nruntime={}\nserver={}\ndata={}",
                runtime_path.display(),
                server_path.display(),
                data_dir.display()
            );
            let stderr_log = log.try_clone()?;

            let port = reserve_loopback_port()?;
            let url = format!("http://127.0.0.1:{port}");

            let mut command = Command::new(&runtime_path);
            command
                .arg(&server_path)
                .current_dir(&runtime_dir)
                .env("AGENT_OFFICE_DESKTOP", "1")
                .env("AGENT_OFFICE_DATA_DIR", &data_dir)
                .env("HOST", "127.0.0.1")
                .env("PORT", port.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(stderr_log));

            #[cfg(target_os = "windows")]
            command.creation_flags(CREATE_NO_WINDOW);

            let child = command.spawn()?;

            app.manage(BackendRuntime {
                child: Mutex::new(Some(child)),
                url,
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Agent Office");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            app_handle.state::<BackendRuntime>().stop();
        }
    });
}
