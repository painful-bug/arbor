// Per-canvas local RAG: parse dropped files → chunk → embed (fastembed, on-device)
// → cosine store. Persisted to ~/.loom/rag/<canvas>.json so the index survives restarts.
//
// ponytail: in-memory Vec + cosine, not sqlite-vec. A researcher's canvas holds a
// handful of files (thousands of chunks at most) — linear scan is microseconds.
// Upgrade path: swap CanvasIndex.chunks for sqlite-vec when a canvas exceeds ~10k chunks.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};

const CHUNK_CHARS: usize = 800;
const CHUNK_OVERLAP: usize = 120;

#[derive(Serialize, Deserialize, Clone)]
struct Chunk {
    text: String,
    source: String,
    embedding: Vec<f32>,
}

#[derive(Default, Serialize, Deserialize)]
struct CanvasIndex {
    chunks: Vec<Chunk>,
}

// Binary files (images) that can't be text-embedded. Stored as base64 so the sidecar
// can pass them to Claude as vision content blocks.
#[derive(Serialize, Deserialize, Clone)]
pub struct StoredImage {
    pub filename: String,
    pub mime: String,
    pub data: String, // base64-encoded bytes
}

pub struct Rag {
    model: Mutex<Option<TextEmbedding>>,
    canvases: Mutex<HashMap<String, CanvasIndex>>,
    images: Mutex<HashMap<String, Vec<StoredImage>>>,
    cache_dir: PathBuf,
    rag_dir: PathBuf,
}

impl Rag {
    pub fn new(cache_dir: PathBuf, rag_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&rag_dir);
        Rag {
            model: Mutex::new(None),
            canvases: Mutex::new(HashMap::new()),
            images: Mutex::new(HashMap::new()),
            cache_dir,
            rag_dir,
        }
    }

    fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        let mut guard = self.model.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            std::fs::create_dir_all(&self.cache_dir)
                .map_err(|e| format!("cache dir {}: {e}", self.cache_dir.display()))?;
            // bge-small-en-v1.5: small, fast, normalized embeddings; downloaded once to cache.
            let m = TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::BGESmallENV15)
                    .with_cache_dir(self.cache_dir.clone())
                    .with_show_download_progress(true),
            )
            .map_err(|e| format!("embedder init failed: {e}"))?;
            *guard = Some(m);
        }
        let model = guard.as_ref().unwrap();
        model.embed(texts, None).map_err(|e| e.to_string())
    }

    pub fn add(&self, canvas: &str, source: &str, text: &str) -> Result<usize, String> {
        let pieces = chunk_text(text);
        if pieces.is_empty() {
            return Ok(0);
        }
        let embeddings = self.embed(pieces.clone())?;
        let mut canvases = self.canvases.lock().map_err(|e| e.to_string())?;
        let idx = canvases.entry(canvas.to_string()).or_default();
        for (text, embedding) in pieces.into_iter().zip(embeddings) {
            idx.chunks.push(Chunk {
                text,
                source: source.to_string(),
                embedding,
            });
        }
        let count = idx.chunks.len();
        // Persist so the index survives restarts.
        let path = self.rag_dir.join(format!("{canvas}.json"));
        if let Ok(json) = serde_json::to_string(idx) {
            let _ = std::fs::write(path, json);
        }
        Ok(count)
    }

    pub fn add_image(&self, canvas: &str, filename: &str, mime: &str, bytes: &[u8]) {
        let mut images = self.images.lock().unwrap_or_else(|e| e.into_inner());
        let list = images.entry(canvas.to_string()).or_default();
        if !list.iter().any(|img| img.filename == filename) {
            list.push(StoredImage {
                filename: filename.to_string(),
                mime: mime.to_string(),
                data: STANDARD.encode(bytes),
            });
        }
    }

    pub fn get_images(&self, canvas: &str) -> Vec<StoredImage> {
        let images = self.images.lock().unwrap_or_else(|e| e.into_inner());
        images.get(canvas).cloned().unwrap_or_default()
    }

    pub fn search(&self, canvas: &str, query: &str, k: usize) -> Result<Vec<String>, String> {
        let qvec = self.embed(vec![query.to_string()])?.remove(0);
        let mut canvases = self.canvases.lock().map_err(|e| e.to_string())?;
        // Lazily load from disk on first search after restart — zero startup cost.
        if !canvases.contains_key(canvas) {
            let path = self.rag_dir.join(format!("{canvas}.json"));
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(idx) = serde_json::from_str::<CanvasIndex>(&raw) {
                    canvases.insert(canvas.to_string(), idx);
                }
            }
        }
        let Some(idx) = canvases.get(canvas) else {
            return Ok(vec![]);
        };
        let mut scored: Vec<(f32, &Chunk)> = idx
            .chunks
            .iter()
            .map(|c| (cosine(&qvec, &c.embedding), c))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored
            .into_iter()
            .take(k)
            .map(|(_, c)| format!("[{}] {}", c.source, c.text))
            .collect())
    }
}

// Sliding-window chunking on character count with overlap. Good enough for prose/PDF;
// not token-aware, but bge truncates and the overlap covers boundary context.
fn chunk_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    if chars.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    let step = CHUNK_CHARS.saturating_sub(CHUNK_OVERLAP).max(1);
    let mut start = 0;
    while start < chars.len() {
        let end = (start + CHUNK_CHARS).min(chars.len());
        out.push(chars[start..end].iter().collect());
        if end == chars.len() {
            break;
        }
        start += step;
    }
    out
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0;
    let mut na = 0.0;
    let mut nb = 0.0;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

// Extract plain text from dropped file bytes by mime/extension.
// Returns Err("image:...") for image files — caller must route those to add_image() instead.
pub fn extract_text(filename: &str, mime: &str, bytes: &[u8]) -> Result<String, String> {
    if mime.starts_with("image/") {
        return Err(format!("image:{mime}"));
    }
    let lower = filename.to_lowercase();
    if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")
        || lower.ends_with(".gif") || lower.ends_with(".webp") || lower.ends_with(".svg")
    {
        return Err(format!("image:{}", mime.to_string()));
    }
    if mime == "application/pdf" || lower.ends_with(".pdf") {
        let raw = pdf_extract::extract_text_from_mem(bytes).map_err(|e| format!("pdf parse: {e}"))?;
        // pdf-extract emits NUL bytes for some font encodings (seen interleaving every glyph
        // on Ghostscript-produced PDFs). They pollute chunks and embeddings — strip them.
        return Ok(raw.replace('\0', ""));
    }
    // text/markdown/plain and anything utf8-ish
    Ok(String::from_utf8_lossy(bytes).replace('\0', ""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_covers_text_with_overlap() {
        let text = "word ".repeat(500); // ~2500 chars
        let chunks = chunk_text(&text);
        assert!(chunks.len() >= 3, "expected multiple chunks, got {}", chunks.len());
        assert!(chunks.iter().all(|c| c.chars().count() <= CHUNK_CHARS));
        let a: String = chunks[0].chars().rev().take(CHUNK_OVERLAP).collect();
        let b: String = chunks[1].chars().take(CHUNK_OVERLAP).collect::<String>().chars().rev().collect();
        assert_eq!(a, b, "chunks should overlap by {CHUNK_OVERLAP} chars");
    }

    #[test]
    fn extract_strips_null_bytes() {
        let t = extract_text("notes.txt", "text/plain", b"a\0b\0c").unwrap();
        assert_eq!(t, "abc");
    }

    #[test]
    fn cosine_identical_is_one() {
        let v = vec![1.0, 2.0, 3.0];
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-6);
        assert!(cosine(&v, &[0.0, 0.0, 0.0]).abs() < 1e-6);
    }

    #[test]
    fn canvas_index_serde_roundtrip() {
        let idx = CanvasIndex {
            chunks: vec![Chunk {
                text: "hello world".into(),
                source: "test.txt".into(),
                embedding: vec![0.1, 0.2, 0.3],
            }],
        };
        let json = serde_json::to_string(&idx).unwrap();
        let back: CanvasIndex = serde_json::from_str(&json).unwrap();
        assert_eq!(back.chunks.len(), 1);
        assert_eq!(back.chunks[0].source, "test.txt");
        assert!((back.chunks[0].embedding[1] - 0.2).abs() < 1e-6);
    }

    #[test]
    #[ignore = "downloads/loads the bge model; run explicitly"]
    fn embeddings_are_searchable_per_canvas() {
        let tmp = std::env::temp_dir().join("loom-rag-test");
        let rag = Rag::new(std::path::PathBuf::from(".fastembed_cache"), tmp);
        rag.add(
            "default",
            "3nf_notes.pdf",
            "Third normal form (3NF) is violated when a non-prime attribute is transitively \
             dependent on the primary key. A relation is in 3NF if for every functional \
             dependency X -> A, either X is a superkey or A is a prime attribute.",
        )
        .expect("add 3nf");
        rag.add(
            "default",
            "cooking.txt",
            "To bake sourdough you need flour, water, salt, and a live starter culture.",
        )
        .expect("add cooking");

        let hits = rag
            .search("default", "when is third normal form violated?", 1)
            .expect("search");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].contains("3nf_notes.pdf"), "top hit should be 3NF source, got: {}", hits[0]);

        assert!(rag.search("other", "3nf", 4).expect("empty canvas").is_empty());
    }
}
