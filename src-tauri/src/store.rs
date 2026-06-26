// Thin durable store rooted at ~/.loom. All paths are relative to that base.
// Rejects ".." and absolute paths (trust boundary — paths come from the webview).
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, path::PathBuf};
use tauri::State;

pub struct Store {
    base: PathBuf,
}

impl Store {
    pub fn new(base: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        Ok(Self { base })
    }

    fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
            return Err(format!("invalid path: {rel}"));
        }
        Ok(self.base.join(rel))
    }
}

#[tauri::command]
pub fn store_read(store: State<'_, Store>, rel: String) -> Option<String> {
    fs::read_to_string(store.resolve(&rel).ok()?).ok()
}

#[tauri::command]
pub fn store_write(store: State<'_, Store>, rel: String, contents: String) -> Result<(), String> {
    let path = store.resolve(&rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn store_delete(store: State<'_, Store>, rel: String) -> Result<(), String> {
    let path = store.resolve(&rel)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn store_list(store: State<'_, Store>, dir: String) -> Vec<String> {
    let Ok(path) = store.resolve(&dir) else { return vec![] };
    let Ok(entries) = fs::read_dir(&path) else { return vec![] };
    entries
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

#[tauri::command]
pub fn blob_read(store: State<'_, Store>, id: String) -> Option<String> {
    let path = store.resolve(&format!("blobs/{id}")).ok()?;
    Some(STANDARD.encode(fs::read(path).ok()?))
}

#[tauri::command]
pub fn blob_write(
    store: State<'_, Store>,
    id: String,
    data: String,
    mime: String,
    name: String,
) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let dir = store.resolve("blobs")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&id), &bytes).map_err(|e| e.to_string())?;
    let meta = serde_json::json!({ "mime": mime, "name": name });
    fs::write(dir.join(format!("{id}.meta.json")), meta.to_string()).map_err(|e| e.to_string())
}
