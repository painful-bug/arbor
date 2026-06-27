// Per-canvas RAG: text extraction → chunking → BGE embeddings → LanceDB.
// One LanceDB table per canvas (named rag_<canvasId>).
import * as lancedb from "@lancedb/lancedb";
import { mkdirSync } from "node:fs";
import { LANCEDB_DIR } from "../paths.ts";
import { embed } from "./embeddings.ts";
import { loadText } from "./loaders.ts";

mkdirSync(LANCEDB_DIR, { recursive: true });

let _db: lancedb.Connection | null = null;
async function getDb() {
	if (!_db) _db = await lancedb.connect(LANCEDB_DIR);
	return _db;
}

const tname = (canvas: string) => `rag_${canvas.replace(/[^a-z0-9]/gi, "_")}`;

// ponytail: paragraph-aware char chunker (~800 chars, 120 overlap).
// Swap for RecursiveCharacterTextSplitter from langchain if quality matters.
function splitText(text: string, size = 800, overlap = 120): string[] {
	const paragraphs = text.split(/\n\n+/);
	const chunks: string[] = [];
	let buf = "";
	for (const para of paragraphs) {
		if (buf.length + para.length + 2 > size && buf) {
			chunks.push(buf.trim());
			buf = buf.slice(Math.max(0, buf.length - overlap));
		}
		buf += (buf ? "\n\n" : "") + para;
	}
	if (buf.trim()) chunks.push(buf.trim());
	return chunks.length ? chunks : text.length ? [text.slice(0, size)] : [];
}

export async function addFile(
	canvas: string,
	filename: string,
	mime: string,
	bytes: Uint8Array,
): Promise<number> {
	const text = await loadText(filename, mime, bytes);
	if (!text.trim()) return 0;

	const chunks = splitText(text);
	const vectors = await embed(chunks);

	const rows = chunks.map((t, i) => ({
		id: `${filename}:${i}`,
		text: t,
		source: filename,
		vector: vectors[i],
	}));

	const db = await getDb();
	const tables = await db.tableNames();
	const name = tname(canvas);

	if (tables.includes(name)) {
		const tbl = await db.openTable(name);
		await tbl.delete(`source = '${filename.replace(/'/g, "''")}'`);
		await tbl.add(rows);
	} else {
		await db.createTable(name, rows);
	}

	return chunks.length;
}

export async function search(canvas: string, query: string, k = 4): Promise<string[]> {
	const db = await getDb();
	const name = tname(canvas);
	const tables = await db.tableNames();
	if (!tables.includes(name)) return [];

	const [qvec] = await embed([query]);
	const tbl = await db.openTable(name);
	const results = await tbl.vectorSearch(qvec).limit(k).toArray();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return results.map((r: any) => r.text as string);
}

export async function clearCanvas(canvas: string): Promise<void> {
	const db = await getDb();
	const name = tname(canvas);
	const tables = await db.tableNames();
	if (tables.includes(name)) await db.dropTable(name);
}
