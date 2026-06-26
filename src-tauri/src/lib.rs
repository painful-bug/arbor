mod rag;
mod sidecar;
mod store;

use base64::{engine::general_purpose::STANDARD, Engine};
use rag::Rag;
use sidecar::{Message, Sidecar, ToolSpec};
use store::Store;
use tauri::{AppHandle, Manager, Runtime, State};

// ── Keychain ──────────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "app.loom.canvas";

#[tauri::command]
fn keychain_set(provider: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider).map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(provider: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// Providers that authenticate with no API key (local).
fn keyless(provider: &str) -> bool {
    matches!(provider, "ollama")
}

// ── Agent (pi sidecar) ──────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn agent_prompt<R: Runtime>(
    app: AppHandle<R>,
    sidecar: State<'_, Sidecar>,
    card_id: String,
    messages: Vec<Message>,
    provider: String,
    model: String,
    system_prompt: Option<String>,
    workflow: Option<String>,
    bash: bool,
    websearch: bool,
    websearch_backend: Option<String>,
) -> Result<(), String> {
    let api_key = if keyless(&provider) {
        None
    } else {
        Some(
            keychain_get(provider.clone())?
                .ok_or_else(|| format!("no API key for '{provider}' — add it in Settings"))?,
        )
    };
    // Tavily key only when web search + tavily backend; injected here, never via webview.
    let tavily_key = if websearch && websearch_backend.as_deref() == Some("tavily") {
        keychain_get("tavily".into())?
    } else {
        None
    };
    sidecar.prompt(
        &app,
        card_id,
        provider,
        model,
        api_key,
        system_prompt,
        messages,
        workflow,
        ToolSpec { bash },
        websearch,
        websearch_backend,
        tavily_key,
    )
}

#[tauri::command]
fn agent_cancel(sidecar: State<'_, Sidecar>, card_id: String) -> Result<(), String> {
    sidecar.cancel(&card_id)
}

// Lightweight provider check: confirms a key is stored (or provider is keyless).
// ponytail: presence check, not a live round-trip. Add a real ping if users hit
// silently-bad keys often enough to matter.
#[tauri::command]
fn provider_test(provider: String) -> Result<(), String> {
    if keyless(&provider) {
        return Ok(());
    }
    keychain_get(provider.clone())?
        .map(|_| ())
        .ok_or_else(|| format!("no API key saved for '{provider}'"))
}

// ── Per-canvas RAG ──────────────────────────────────────────────────────────

#[tauri::command]
async fn rag_add(
    rag: State<'_, Rag>,
    canvas: String,
    filename: String,
    mime: String,
    data: String,
) -> Result<usize, String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    match rag::extract_text(&filename, &mime, &bytes) {
        Ok(text) => rag.add(&canvas, &filename, &text),
        Err(e) if e.starts_with("image:") => {
            rag.add_image(&canvas, &filename, &mime, &bytes);
            Ok(0)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn rag_search(rag: State<'_, Rag>, canvas: String, query: String) -> Result<Vec<String>, String> {
    rag.search(&canvas, &query, 4)
}

// ── Local files (preview/edit side-split) ───────────────────────────────────

#[tauri::command]
fn file_read(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// Returns raw file bytes as base64. Used by the drag-drop handler to load binary files
// (PDF, images, docx) whose paths come from Tauri's onDragDropEvent (not DataTransfer).
#[tauri::command]
fn file_read_bytes(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
fn file_write(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

// Open a file with the OS default app for its type.
#[tauri::command]
fn open_path<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(&path, None).map_err(|e| e.to_string())
}

// ── App entry ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::new())
        .setup(|app| {
            let cache_dir = app.path().app_data_dir()?.join("fastembed");
            let home_dir = app.path().home_dir()?;
            let loom_dir = home_dir.join(".loom");

            let store = Store::new(loom_dir.clone())
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            app.manage(store);

            let rag_dir = loom_dir.join("rag");
            app.manage(Rag::new(cache_dir, rag_dir));

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            keychain_set,
            keychain_get,
            agent_prompt,
            agent_cancel,
            provider_test,
            rag_add,
            rag_search,
            file_read,
            file_read_bytes,
            file_write,
            open_path,
            store::store_read,
            store::store_write,
            store::store_delete,
            store::store_list,
            store::blob_read,
            store::blob_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
