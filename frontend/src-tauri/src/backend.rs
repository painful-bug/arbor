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
        let name = if cfg!(target_os = "windows") { "bun.exe" } else { "bun" };
        exe.parent().unwrap().join(name)
    }
}

/// Set only when non-empty — release builds bake these in from CI secrets
/// (.github/workflows/build.yml) so every shipped install can connect Google
/// Drive with no user setup. Local/dev builds compile this as `None` and the
/// spawned process falls back to inheriting the shell's own env vars, if any.
fn baked_env(cmd: &mut Command, key: &str, val: Option<&str>) {
    if let Some(v) = val {
        if !v.is_empty() {
            cmd.env(key, v);
        }
    }
}

pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<Backend, String> {
    let entry = entry_path(app);
    let bun = bun_path();
    let mut cmd = Command::new(&bun);
    cmd.arg(&entry);
    // Dev: cwd = backend/ so Bun auto-loads backend/.env (the developer's own
    // local ARBOR_GOOGLE_CLIENT_ID/SECRET etc.), same as `cd backend && bun run dev`.
    if cfg!(debug_assertions) {
        if let Some(backend_dir) = entry.parent().and_then(|p| p.parent()) {
            cmd.current_dir(backend_dir);
        }
    }
    baked_env(&mut cmd, "ARBOR_GOOGLE_CLIENT_ID", option_env!("ARBOR_GOOGLE_CLIENT_ID"));
    baked_env(
        &mut cmd,
        "ARBOR_GOOGLE_CLIENT_SECRET",
        option_env!("ARBOR_GOOGLE_CLIENT_SECRET"),
    );
    // Bun is a console-subsystem binary; a GUI app (main.rs sets
    // `windows_subsystem = "windows"`) spawning it makes Windows allocate a
    // fresh console window on launch. CREATE_NO_WINDOW (0x0800_0000) suppresses
    // it so only the app window shows. cfg-gated → compiled out off Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
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
