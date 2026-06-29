// Spawns the TypeScript backend (Bun) and learns how to reach it.
//
// The backend binds 127.0.0.1 on a free port and prints one handshake line:
//   ARBOR_BACKEND {"port":NNNN,"token":"..."}
// We block setup until that line arrives, store {port, token}, then drain the
// rest of the child's stdout to the log so its pipe never fills. The token is
// handed to the webview via `backend_info` and sent back as a Bearer header,
// so only our UI can drive the API.
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Clone, serde::Serialize)]
pub struct BackendInfo {
    pub port: u16,
    pub token: String,
}

pub struct Backend {
    info: BackendInfo,
    child: Mutex<Child>,
}

impl Backend {
    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

fn entry_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../backend/src/server.ts")
    } else {
        app.path()
            .resource_dir()
            .expect("resource dir")
            .join("resources/backend/src/server.ts")
    }
}

fn bun_path() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from("bun")
    } else {
        let exe = std::env::current_exe().expect("current_exe");
        exe.parent().unwrap().join("bun")
    }
}

pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<Backend, String> {
    let entry = entry_path(app);
    let bun = bun_path();
    let mut child = Command::new(&bun)
        .arg(&entry)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn backend ({} {}): {e}", bun.display(), entry.display()))?;

    let stdout = child.stdout.take().ok_or("backend stdout unavailable")?;
    let mut reader = BufReader::new(stdout);

    // Block until the handshake line (or the child dies first).
    let info = loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("backend exited before handshake".into());
        }
        if let Some(rest) = line.trim().strip_prefix("ARBOR_BACKEND ") {
            let v: serde_json::Value = serde_json::from_str(rest).map_err(|e| e.to_string())?;
            let port = v["port"].as_u64().ok_or("handshake missing port")? as u16;
            let token = v["token"].as_str().ok_or("handshake missing token")?.to_string();
            break BackendInfo { port, token };
        }
        log::info!("[backend] {}", line.trim_end());
    };

    // Keep draining stdout so the child never blocks on a full pipe.
    std::thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            log::info!("[backend] {line}");
        }
    });

    Ok(Backend {
        info,
        child: Mutex::new(child),
    })
}

#[tauri::command]
pub fn backend_info(backend: State<'_, Backend>) -> BackendInfo {
    backend.info.clone()
}
