// Studio: NotebookLM-style generated outputs, local-first (uses the user's
// configured provider — cloud only if they set a key). Backend-only so both the
// SvelteKit and native frontends inherit it.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { chatComplete } from "../agent/complete.ts";
import { badRequest } from "../errors.ts";
import { readSource } from "../kb/index.ts";
import { log } from "../log.ts";
import { db } from "../store/db.ts";
import { reviewItems } from "../store/schema.ts";

export const studioRoutes = new Hono();

// One node of the mind map: a topic with a 1-line summary + its parent (null = root).
export interface MindNode {
	id: string;
	title: string;
	summary: string;
	parent: string | null;
}

const MINDMAP_SYSTEM =
	"You are an expert at distilling documents into hierarchical mind maps. " +
	"You reply with ONLY valid JSON, no prose, no markdown fences.";

const MINDMAP_PROMPT = (source: string, text: string) =>
	`Build a mind map of the document "${source}" from the content below.

<content>
${text}
</content>

Return JSON of this exact shape:
{"root":"<the central topic, 2-5 words>","nodes":[{"title":"<branch topic>","summary":"<one sentence>","children":[{"title":"...","summary":"..."}]}]}

Rules:
- 3 to 6 top-level branches; each with 2 to 5 children.
- Titles are short (2-6 words). Summaries are one plain sentence.
- Base it strictly on the content. Output ONLY the JSON object.`;

// First 800 chars of model output for logs — enough to spot a malformed shape
// without dumping a whole document into the log stream.
const snippet = (s: string, n = 800) =>
	s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s;

// Tolerant parse: models wrap JSON in prose, code fences, or leave trailing
// commas. Strip fences, slice the outermost { … } object, drop trailing commas,
// then JSON.parse. Throws (with the offending text visible to the caller's log).
export function parseJson(raw: string): unknown {
	let s = raw
		.trim()
		.replace(/```(?:json)?/gi, "")
		.trim();
	// Slice from the first "{" to the last "}" so leading/trailing prose is dropped.
	const start = s.indexOf("{");
	const end = s.lastIndexOf("}");
	if (start !== -1 && end > start) s = s.slice(start, end + 1);
	// Remove trailing commas before } or ] (common LLM mistake, invalid JSON).
	s = s.replace(/,(\s*[}\]])/g, "$1");
	return JSON.parse(s);
}

// Flatten the LLM's nested tree into id'd nodes with parent pointers.
export function flatten(tree: {
	root?: string;
	nodes?: { title?: string; summary?: string; children?: { title?: string; summary?: string }[] }[];
}): MindNode[] {
	const out: MindNode[] = [];
	const rootId = "n0";
	out.push({
		id: rootId,
		title: (tree.root ?? "Overview").slice(0, 80),
		summary: "",
		parent: null,
	});
	let counter = 1;
	for (const branch of tree.nodes ?? []) {
		if (!branch?.title) continue;
		const bid = `n${counter++}`;
		out.push({
			id: bid,
			title: branch.title.slice(0, 80),
			summary: (branch.summary ?? "").slice(0, 240),
			parent: rootId,
		});
		for (const child of branch.children ?? []) {
			if (!child?.title) continue;
			out.push({
				id: `n${counter++}`,
				title: child.title.slice(0, 80),
				summary: (child.summary ?? "").slice(0, 240),
				parent: bid,
			});
		}
	}
	return out;
}

// POST /api/studio/:canvas/mindmap  { source }  → { nodes: MindNode[] }
studioRoutes.post("/:canvas/mindmap", async (c) => {
	const canvas = c.req.param("canvas");
	const { source } = (await c.req.json().catch(() => ({}))) as { source?: string };
	if (!source) throw badRequest("source required");

	const chunks = await readSource(canvas, source);
	if (chunks.length === 0) throw badRequest("source not found in this canvas");
	// Cap the context so a huge doc doesn't blow the prompt window.
	const text = chunks.join("\n\n").slice(0, 12_000);
	log.info("studio", `mindmap start [${source}]`, {
		canvas,
		chunks: chunks.length,
		chars: text.length,
	});

	const raw = await chatComplete(MINDMAP_PROMPT(source, text), 2000, MINDMAP_SYSTEM, {
		json: true,
	});
	if (!raw.trim()) {
		// No provider/key configured, or the model returned nothing.
		log.warn("studio", `mindmap no output [${source}]`, { canvas });
		return c.json({ error: "no_provider", nodes: [] }, 422);
	}
	log.info("studio", `mindmap raw output [${source}]`, { chars: raw.length, head: snippet(raw) });

	try {
		const nodes = flatten(parseJson(raw) as Parameters<typeof flatten>[0]);
		if (nodes.length <= 1) {
			log.warn("studio", `mindmap empty after parse [${source}]`, {
				nodes: nodes.length,
				raw: snippet(raw),
			});
			return c.json({ error: "empty", nodes: [] }, 422);
		}
		log.info("studio", `mindmap done [${source}]`, { nodes: nodes.length });
		return c.json({ nodes });
	} catch (err) {
		log.error("studio", `mindmap parse failed [${source}]`, {
			err: String(err),
			raw: snippet(raw),
		});
		return c.json({ error: "parse", nodes: [] }, 422);
	}
});

// ---- Flashcards + quizzes ---------------------------------------------------

// A row as the frontend sees it (choices already parsed).
export interface StudyItem {
	id: string;
	kind: "flashcard" | "mcq";
	question: string;
	answer: string;
	choices: string[] | null;
}

const STUDY_SYSTEM =
	"You are an expert tutor who writes study material. " +
	"You reply with ONLY valid JSON, no prose, no markdown fences.";

const STUDY_PROMPT = (source: string, text: string) =>
	`Create study material from the document "${source}" below.

<content>
${text}
</content>

Return JSON of this exact shape:
{"flashcards":[{"q":"<question>","a":"<concise answer>"}],"quiz":[{"q":"<question>","choices":["<A>","<B>","<C>","<D>"],"answer":"<the exact text of the correct choice>"}]}

Rules:
- 6 to 12 flashcards and 4 to 8 multiple-choice questions.
- Each quiz item has exactly 4 choices; "answer" must equal one of them verbatim.
- Base everything strictly on the content. Output ONLY the JSON object.`;

// Parse + validate the LLM's study set into storable items. Drops malformed
// entries rather than failing the whole batch.
export function parseStudySet(
	raw: unknown,
): { kind: "flashcard" | "mcq"; question: string; answer: string; choices: string[] | null }[] {
	const data = raw as {
		flashcards?: { q?: string; a?: string }[];
		quiz?: { q?: string; choices?: string[]; answer?: string }[];
	};
	const out: {
		kind: "flashcard" | "mcq";
		question: string;
		answer: string;
		choices: string[] | null;
	}[] = [];
	for (const f of data.flashcards ?? []) {
		if (!f?.q || !f?.a) continue;
		out.push({
			kind: "flashcard",
			question: f.q.slice(0, 500),
			answer: f.a.slice(0, 1000),
			choices: null,
		});
	}
	for (const q of data.quiz ?? []) {
		const choices = (q?.choices ?? []).filter((x) => typeof x === "string" && x.trim()).slice(0, 4);
		// A valid MCQ needs a question, 4 choices, and an answer among them.
		if (!q?.q || choices.length !== 4 || !q.answer || !choices.includes(q.answer)) continue;
		out.push({ kind: "mcq", question: q.q.slice(0, 500), answer: q.answer, choices });
	}
	return out;
}

function toStudyItem(row: Pick<typeof reviewItems.$inferSelect, "id" | "kind" | "question" | "answer" | "choices">): StudyItem {
	return {
		id: row.id,
		kind: row.kind as "flashcard" | "mcq",
		question: row.question,
		answer: row.answer,
		choices: row.choices ? (JSON.parse(row.choices) as string[]) : null,
	};
}

// POST /api/studio/:canvas/generate  { source }  → { items: StudyItem[] }
studioRoutes.post("/:canvas/generate", async (c) => {
	const canvas = c.req.param("canvas");
	const { source } = (await c.req.json().catch(() => ({}))) as { source?: string };
	if (!source) throw badRequest("source required");

	const chunks = await readSource(canvas, source);
	if (chunks.length === 0) throw badRequest("source not found in this canvas");
	const text = chunks.join("\n\n").slice(0, 12_000);
	log.info("studio", `study start [${source}]`, {
		canvas,
		chunks: chunks.length,
		chars: text.length,
	});

	const raw = await chatComplete(STUDY_PROMPT(source, text), 2500, STUDY_SYSTEM, { json: true });
	if (!raw.trim()) {
		log.warn("studio", `study no output [${source}]`, { canvas });
		return c.json({ error: "no_provider", items: [] }, 422);
	}
	log.info("studio", `study raw output [${source}]`, { chars: raw.length, head: snippet(raw) });

	let parsed: ReturnType<typeof parseStudySet>;
	try {
		parsed = parseStudySet(parseJson(raw));
	} catch (err) {
		log.error("studio", `study parse failed [${source}]`, { err: String(err), raw: snippet(raw) });
		return c.json({ error: "parse", items: [] }, 422);
	}
	if (parsed.length === 0) {
		log.warn("studio", `study empty after parse [${source}]`, { raw: snippet(raw) });
		return c.json({ error: "empty", items: [] }, 422);
	}
	log.info("studio", `study done [${source}]`, { items: parsed.length });

	const now = Date.now();
	const rows = parsed.map((p) => ({
		id: randomUUID(),
		canvas,
		source,
		kind: p.kind,
		question: p.question,
		answer: p.answer,
		choices: p.choices ? JSON.stringify(p.choices) : null,
		createdAt: now,
		dueAt: now,
	}));
	db.insert(reviewItems).values(rows).run();
	return c.json({ items: rows.map(toStudyItem) });
});

// GET /api/studio/:canvas/review  → { items: StudyItem[] }  (all stored items)
studioRoutes.get("/:canvas/review", (c) => {
	const canvas = c.req.param("canvas");
	const rows = db.select().from(reviewItems).where(eq(reviewItems.canvas, canvas)).all();
	return c.json({ items: rows.map(toStudyItem) });
});

// DELETE /api/studio/:canvas/review/:id  → { ok: true }
studioRoutes.delete("/:canvas/review/:id", (c) => {
	const canvas = c.req.param("canvas");
	const id = c.req.param("id");
	db.delete(reviewItems)
		.where(and(eq(reviewItems.canvas, canvas), eq(reviewItems.id, id)))
		.run();
	return c.json({ ok: true });
});
