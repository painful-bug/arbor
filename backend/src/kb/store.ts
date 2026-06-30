import { LANCEDB_DIR } from "../paths.ts";

// ponytail: require() because Bun's ESM resolution clashes with @langchain/community's
// optional peer dep on a different @lancedb/lancedb version, causing cache misresolution.
// Lazy: the native addon spins up a CPU-core-sized tokio thread pool at require()
// time, so deferring to first actual KB use keeps idle sessions thread-light.
let _lancedb: typeof import("@lancedb/lancedb") | null = null;
function getLancedb() {
	if (!_lancedb) _lancedb = require("@lancedb/lancedb") as typeof import("@lancedb/lancedb");
	return _lancedb;
}

let _db: Awaited<ReturnType<(typeof import("@lancedb/lancedb"))["connect"]>> | null = null;

async function getDb() {
	if (!_db) _db = await getLancedb().connect(LANCEDB_DIR);
	return _db;
}

const tname = (canvas: string) => `rag_${canvas.replace(/[^a-z0-9]/gi, "_")}`;

export interface Row {
	id: string;
	source: string;
	text: string;
	vector: number[];
	page?: number; // 1-based source page; absent on legacy tables
}

// Field names of a table's current schema. Legacy tables predate the `page`
// column, so reads/writes must probe before touching it.
async function fieldNames(tbl: any): Promise<Set<string>> {
	const schema = await tbl.schema();
	return new Set((schema.fields as { name: string }[]).map((f) => f.name));
}

export async function upsert(canvas: string, source: string, rows: Row[]): Promise<void> {
	if (!rows.length) return;
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();

	if (names.includes(name)) {
		const tbl = await db.openTable(name);
		// Legacy table without a `page` column: drop page so add() matches the schema.
		const add = (await fieldNames(tbl)).has("page")
			? rows
			: rows.map(({ page, ...r }) => r);
		await tbl.delete(`source = '${source.replace(/'/g, "''")}'`);
		await tbl.add(add);
		try { await tbl.createIndex("text", { config: getLancedb().Index.fts(), replace: true }); } catch {}
	} else {
		const tbl = await db.createTable(name, rows);
		try { await tbl.createIndex("text", { config: getLancedb().Index.fts() }); } catch {}
	}
}

// chat:* and card:* rows are conversation/title scraps, not uploaded source material.
// They must never surface in topic search — a raw "User: ... Assistant: ..." transcript
// from an unrelated card, returned as a "knowledge_base_search" hit, reads to the LLM
// like a live instruction and derails it into continuing that other conversation.
const NOT_CHAT = "source NOT LIKE 'chat:%' AND source NOT LIKE 'card:%'";

export interface Hit {
	text: string;
	source: string;
	page?: number;
}

export async function hybridSearch(
	canvas: string,
	queryVec: number[],
	queryText: string,
	k = 6
): Promise<Hit[]> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (!names.includes(name)) return [];

	const tbl = await db.openTable(name);
	// Legacy tables lack `page`; selecting a missing column throws.
	const cols = (await fieldNames(tbl)).has("page")
		? ["text", "source", "page"]
		: ["text", "source"];

	// Try FTS first for hybrid-quality results
	try {
		const ftsResults = await tbl
			.search(queryText)
			.where(NOT_CHAT)
			.select(cols)
			.limit(k)
			.toArray();

		const vecResults = await tbl
			.search(queryVec)
			.where(NOT_CHAT)
			.select(cols)
			.limit(k)
			.toArray();

		// Manual RRF fusion
		return rrfFuse(vecResults, ftsResults, k);
	} catch {
		// FTS unavailable — pure vector fallback
		const results = await tbl
			.search(queryVec)
			.where(NOT_CHAT)
			.select(cols)
			.limit(k)
			.toArray();
		return results.map((r: any) => ({ text: r.text as string, source: r.source as string, page: r.page ?? undefined }));
	}
}

// Reciprocal Rank Fusion: combine two ranked lists by 1/(rank+60) scoring.
// Keyed by chunk text (unique per chunk); source carried alongside for attribution.
function rrfFuse(vecResults: any[], ftsResults: any[], k: number): Hit[] {
	const scores = new Map<string, number>();
	const sources = new Map<string, string>();
	const pages = new Map<string, number | undefined>();
	const RRF_K = 60;

	const tally = (rows: any[]) => {
		for (let i = 0; i < rows.length; i++) {
			const text = rows[i].text as string;
			scores.set(text, (scores.get(text) ?? 0) + 1 / (i + RRF_K));
			sources.set(text, rows[i].source as string);
			pages.set(text, rows[i].page ?? undefined);
		}
	};
	tally(vecResults);
	tally(ftsResults);

	return [...scores.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, k)
		.map(([text]) => ({ text, source: sources.get(text) ?? "", page: pages.get(text) }));
}

// Nearest *sources* (not chunks) to a query vector. Unlike hybridSearch this does
// NOT apply NOT_CHAT — semantic auto-linking must compare cards/notes (chat:/card:/
// text:) too. Aggregates chunk hits to the best cosine per source. Vectors are
// normalized, so cosine = 1 - L2²/2 (lancedb returns L2 _distance).
export async function relate(
	canvas: string,
	queryVec: number[],
	k: number,
	exclude: string[],
): Promise<{ source: string; score: number }[]> {
	const db = await getDb();
	const name = tname(canvas);
	const names = await db.tableNames();
	if (!names.includes(name)) return [];

	const tbl = await db.openTable(name);
	const rows = await tbl
		.search(queryVec)
		.select(["source"])
		.limit(Math.max(k * 8, 24))
		.toArray();

	const skip = new Set(exclude);
	const best = new Map<string, number>();
	for (const r of rows as { source: string; _distance: number }[]) {
		if (skip.has(r.source)) continue;
		const cosine = 1 - r._distance / 2;
		const prev = best.get(r.source);
		if (prev === undefined || cosine > prev) best.set(r.source, cosine);
	}

	return [...best.entries()]
		.map(([source, score]) => ({ source, score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, k);
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
