// SQLite schema (Drizzle). Four small tables:
//   canvases   — one row per canvas; `doc` is the JSON {nodes, edges}.
//   meta       — kv for "current" canvas id and "order" (JSON array of ids).
//   settings   — single row (id=1) holding the settings JSON blob.
//   blob_meta  — mime/name for each dropped file; bytes live on disk in ~/.loom/blobs.
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
