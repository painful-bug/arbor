import { LANCEDB_DIR } from "../paths.ts";

// ponytail: require() because Bun's ESM resolution clashes with @langchain/community's
// optional peer dep on a different @lancedb/lancedb version, causing cache misresolution.
const lancedb = require("@lancedb/lancedb") as typeof import("@lancedb/lancedb");

let _db: InstanceType<typeof lancedb.Connection> | null = null;

async function getDb() {
	if (!_db) _db = await lancedb.connect(LANCEDB_DIR);
	return _db;
}

const tname = (canvas: string) => `rag_${canvas.replace(/[^a-z0-9]/gi, "_")}`;

export interface Row {
	id: string;
	source: string;
	text: string;
	vector: number[];
}

export async function upsert(canvas: string, source: string, rows: Row[]): Promise<void> {
	if (!rows.length) return;
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();

	if (names.includes(name)) {
		const tbl = await db.openTable(name);
		await tbl.delete(`source = '${source.replace(/'/g, "''")}'`);
		await tbl.add(rows);
		try { await tbl.createIndex("text", { config: lancedb.Index.fts(), replace: true }); } catch {}
	} else {
		const tbl = await db.createTable(name, rows);
		try { await tbl.createIndex("text", { config: lancedb.Index.fts() }); } catch {}
	}
}

export async function hybridSearch(
	canvas: string,
	queryVec: number[],
	queryText: string,
	k = 6
): Promise<string[]> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (!names.includes(name)) return [];

	const tbl = await db.openTable(name);

	// Try FTS first for hybrid-quality results
	try {
		const ftsResults = await tbl
			.search(queryText)
			.select(["text"])
			.limit(k)
			.toArray();

		const vecResults = await tbl
			.search(queryVec)
			.select(["text"])
			.limit(k)
			.toArray();

		// Manual RRF fusion
		return rrfFuse(vecResults, ftsResults, k);
	} catch {
		// FTS unavailable — pure vector fallback
		const results = await tbl
			.search(queryVec)
			.select(["text"])
			.limit(k)
			.toArray();
		return results.map((r: any) => r.text);
	}
}

// Reciprocal Rank Fusion: combine two ranked lists by 1/(rank+60) scoring
function rrfFuse(vecResults: any[], ftsResults: any[], k: number): string[] {
	const scores = new Map<string, number>();
	const RRF_K = 60;

	for (let i = 0; i < vecResults.length; i++) {
		const text = vecResults[i].text as string;
		scores.set(text, (scores.get(text) ?? 0) + 1 / (i + RRF_K));
	}
	for (let i = 0; i < ftsResults.length; i++) {
		const text = ftsResults[i].text as string;
		scores.set(text, (scores.get(text) ?? 0) + 1 / (i + RRF_K));
	}

	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, k)
		.map(([text]) => text);
}

export async function removeSource(canvas: string, source: string): Promise<void> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (!names.includes(name)) return;
	const tbl = await db.openTable(name);
	await tbl.delete(`source = '${source.replace(/'/g, "''")}'`);
}

export async function clear(canvas: string): Promise<void> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (names.includes(name)) await db.dropTable(name);
}

export async function sourceContent(canvas: string, source: string): Promise<string[]> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (!names.includes(name)) return [];

	const tbl = await db.openTable(name);
	const rows = await tbl
		.query()
		.where(`source = '${source.replace(/'/g, "''")}'`)
		.select(["text"])
		.toArray();
	return rows.map((r: any) => r.text as string);
}

export async function sources(canvas: string): Promise<{ source: string; chunks: number }[]> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (!names.includes(name)) return [];

	const tbl = await db.openTable(name);
	const rows = await tbl.query().select(["source"]).toArray();
	const counts = new Map<string, number>();
	for (const r of rows) {
		const s = r.source as string;
		counts.set(s, (counts.get(s) ?? 0) + 1);
	}
	return [...counts.entries()].map(([source, chunks]) => ({ source, chunks }));
}
