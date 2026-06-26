// Sidecar broker: spawns the pi agent sidecar, injects Keychain API keys, and
// relays its newline-JSON stdout to the webview as `loom:agent` events.
// The webview never sees an API key — it sends provider+model; we add the key here.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::rag::{Rag, StoredImage};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ToolSpec {
    pub bash: bool,
}

// One long-lived sidecar process. stdin guarded for concurrent writes.
pub struct Sidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
}

impl Sidecar {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }

    // Spawn on first use; start a reader task that re-emits stdout lines.
    fn ensure_started<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        let cmd = app
            .shell()
            .sidecar("pi-sidecar")
            .map_err(|e| format!("sidecar resolve failed: {e}"))?;
        let (mut rx, child) = cmd.spawn().map_err(|e| format!("sidecar spawn failed: {e}"))?;
        *guard = Some(child);
        drop(guard); // release before spawning reader task

        let app = app.clone();
        let child_arc = Arc::clone(&self.child);
        tauri::async_runtime::spawn(async move {
            let mut buf: Vec<u8> = Vec::new();
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        buf.extend_from_slice(&bytes);
                        emit_complete_lines(&app, &mut buf);
                    }
                    CommandEvent::Stderr(bytes) => {
                        // sidecar logs go to the Tauri log, not the webview
                        log::info!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end());
                    }
                    CommandEvent::Terminated(_) => {
                        log::warn!("[sidecar] terminated — cleared; next prompt will respawn");
                        if let Ok(mut g) = child_arc.lock() {
                            *g = None;
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    fn write_line(&self, line: &str) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        let child = guard
            .as_mut()
            .ok_or_else(|| "sidecar not started".to_string())?;
        let mut bytes = line.as_bytes().to_vec();
        bytes.push(b'\n');
        child.write(&bytes).map_err(|e| e.to_string())
    }

    // Send a prompt. `api_key` comes from the Keychain (added by the command).
    #[allow(clippy::too_many_arguments)]
    pub fn prompt<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        card_id: String,
        provider: String,
        model: String,
        api_key: Option<String>,
        system_prompt: Option<String>,
        messages: Vec<Message>,
        workflow: Option<String>,
        tools: ToolSpec,
        websearch: bool,
        websearch_backend: Option<String>,
        tavily_key: Option<String>,
    ) -> Result<(), String> {
        self.ensure_started(app)?;
        let line = serde_json::json!({
            "type": "prompt",
            "id": card_id,
            "provider": provider,
            "model": model,
            "apiKey": api_key,
            "systemPrompt": system_prompt,
            "messages": messages,
            "workflow": workflow,
            "tools": tools,
            "websearch": websearch,
            "websearchBackend": websearch_backend,
            "tavilyKey": tavily_key,
        });
        self.write_line(&line.to_string())
    }

    pub fn cancel(&self, card_id: &str) -> Result<(), String> {
        // best-effort: if the sidecar isn't running there's nothing to cancel
        if self.child.lock().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
        let line = serde_json::json!({ "type": "cancel", "id": card_id });
        self.write_line(&line.to_string())
    }

    // Reply to a rag_req the sidecar raised (duplex RAG tool).
    pub fn rag_resp(&self, rag_id: &str, chunks: Vec<String>, images: Vec<StoredImage>) -> Result<(), String> {
        let line = serde_json::json!({ "type": "rag_resp", "ragId": rag_id, "chunks": chunks, "images": images });
        self.write_line(&line.to_string())
    }
}

// Split the buffer on newlines and emit each complete JSON line to the webview.
fn emit_complete_lines<R: Runtime>(app: &AppHandle<R>, buf: &mut Vec<u8>) {
    loop {
        let Some(pos) = buf.iter().position(|&b| b == b'\n') else {
            return;
        };
        let line = buf.drain(..=pos).collect::<Vec<u8>>();
        let text = String::from_utf8_lossy(&line);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(v) => {
                // rag_req is a host-side call (search this canvas's file index), not a
                // UI event — intercept it and reply on stdin; everything else is for the UI.
                if v.get("type").and_then(|t| t.as_str()) == Some("rag_req") {
                    handle_rag_req(app, &v);
                } else {
                    let _ = app.emit("loom:agent", v);
                }
            }
            Err(e) => log::warn!("[sidecar] bad json line: {e}: {text}"),
        }
    }
}

// Answer a sidecar rag_req: embed+search the canvas index, write rag_resp to stdin.
// Runs off-thread so the stdout reader isn't blocked by the embedder.
fn handle_rag_req<R: Runtime>(app: &AppHandle<R>, v: &serde_json::Value) {
    let rag_id = v.get("ragId").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let query = v.get("query").and_then(|x| x.as_str()).unwrap_or("").to_string();
    // ponytail: single canvas until multi-canvas exists — default to the only index.
    // Add a `canvas` field to rag_req when cards span canvases.
    let canvas = v
        .get("canvas")
        .and_then(|x| x.as_str())
        .unwrap_or("default")
        .to_string();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let rag = app.state::<Rag>();
        let chunks = rag.search(&canvas, &query, 4).unwrap_or_else(|e| {
            log::warn!("[rag] search failed: {e}");
            vec![]
        });
        let images = rag.get_images(&canvas);
        if let Err(e) = app.state::<Sidecar>().rag_resp(&rag_id, chunks, images) {
            log::warn!("[rag] resp write failed: {e}");
        }
    });
}
