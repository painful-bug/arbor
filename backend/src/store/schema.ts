// SQLite schema (Drizzle). Four small tables:
//   canvases   — one row per canvas; `doc` is the JSON {nodes, edges}.
//   meta       — kv for "current" canvas id and "order" (JSON array of ids).
//   settings   — single row (id=1) holding the settings JSON blob.
//   blob_meta  — mime/name for each dropped file; bytes live on disk in ~/.arbor/blobs.
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const canvases = sqliteTable("canvases", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
	doc: text("doc").notNull(), // JSON: { nodes, edges }
});

export const meta = sqliteTable("meta", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export const settings = sqliteTable("settings", {
	id: integer("id").primaryKey(),
	json: text("json").notNull(),
});

export const blobMeta = sqliteTable("blob_meta", {
	id: text("id").primaryKey(),
	mime: text("mime").notNull(),
	name: text("name").notNull(),
});

// Study items generated from a KB source: flashcards (q/a) and MCQs.
// `choices` is a JSON array for kind='mcq', null for flashcards.
// SM-2 scheduling columns (ease/intervalDays/reps/dueAt) feed Phase 5c; a plain
// review loop ignores them.
export const reviewItems = sqliteTable("review_items", {
	id: text("id").primaryKey(),
	canvas: text("canvas").notNull(),
	source: text("source").notNull(),
	kind: text("kind").notNull(), // 'flashcard' | 'mcq'
	question: text("question").notNull(),
	answer: text("answer").notNull(),
	choices: text("choices"), // JSON string[] for mcq, null for flashcard
	createdAt: integer("created_at").notNull(),
	ease: integer("ease").notNull().default(250), // SM-2 ease ×100 (2.5)
	intervalDays: integer("interval_days").notNull().default(0),
	reps: integer("reps").notNull().default(0),
	dueAt: integer("due_at").notNull(),
});
