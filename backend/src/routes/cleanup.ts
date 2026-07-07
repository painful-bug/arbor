import { Hono } from "hono";
import { chatComplete } from "../agent/complete.ts";
import { type ArrangeEdge, type ArrangeReqNode, arrangeCanvas } from "../cleanup/arrange.ts";
import { readSource } from "../kb/index.ts";
import { log } from "../log.ts";
import { parseJson } from "./studio.ts";

export const cleanupRoutes = new Hono();

// POST /api/cleanup/:canvas/arrange — semantic force-clustering (see
// cleanup/arrange.ts). Best-effort: always 200, returns {layout:null} on any
// failure (frontend no-ops).
cleanupRoutes.post("/:canvas/arrange", async (c) => {
	try {
		const body = await c.req.json<{ nodes: ArrangeReqNode[]; edges: ArrangeEdge[] }>();
		const layout = await arrangeCanvas(body.nodes ?? [], body.edges ?? []);
		return c.json({ layout });
	} catch {
		// justified: best-effort domain fallback — frontend treats null as "no change".
		return c.json({ layout: null });
	}
});

interface NameMember {
	id: string;
	source?: string;
	text?: string;
	kind?: string;
}

// "2 PDF, 1 note" — dominant content types in a cluster, for the namer to reflect.
export function typeSummary(members: NameMember[]): string {
	const counts = new Map<string, number>();
	for (const m of members) {
		const k = m.kind?.trim();
		if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `${n} ${k}`)
		.join(", ");
}
interface NameCluster {
	id: string;
	members: NameMember[];
}

const NAME_SYSTEM =
	"You name groups of related notes. Reply with ONLY valid JSON, no prose, no fences.";

export function buildNamingPrompt(clusters: { id: string; text: string }[]): string {
	const blocks = clusters.map((c) => `<cluster id="${c.id}">\n${c.text}\n</cluster>`).join("\n\n");
	return `Name each cluster of notes below with a short declarative label (2-5 words, Title Case, no punctuation). Each cluster lists its content types (e.g. "2 PDF, 1 note") — reflect the dominant type in the label when the notes share one, e.g. "Data Mining PDFs" or "Physics Lecture Notes".

${blocks}

Return JSON of this exact shape:
{"names":{"<cluster id>":"<label>", ...}}
Include every cluster id. Base labels strictly on the content and its file type.`;
}

// Tolerant parse mirroring studio.parseJson's caller contract: drops non-string
// values and ids the model didn't echo back.
export function parseNames(raw: unknown, ids: string[]): Record<string, string> {
	const names = (raw as { names?: Record<string, unknown> })?.names ?? {};
	const out: Record<string, string> = {};
	for (const id of ids) {
		const v = names[id];
		if (typeof v === "string" && v.trim()) out[id] = v.trim().slice(0, 48);
	}
	return out;
}

// POST /api/cleanup/:canvas/name — auto-name clusters from member content + KB,
// using the cheap "small" model tier (see agent/complete.ts). Best-effort:
// always 200, returns {names:{}} on any failure (frontend keeps old/blank names).
cleanupRoutes.post("/:canvas/name", async (c) => {
	const canvas = c.req.param("canvas");
	const { clusters } = (await c.req.json().catch(() => ({}))) as { clusters?: NameCluster[] };
	if (!clusters?.length) return c.json({ names: {} });

	const enriched = await Promise.all(
		clusters.slice(0, 24).map(async (cl) => {
			const parts: string[] = [];
			const types = typeSummary(cl.members);
			if (types) parts.push(`Content types: ${types}`);
			for (const m of cl.members.slice(0, 12)) {
				if (m.text?.trim()) parts.push(m.text.slice(0, 300));
				if (m.source) {
					const chunks = await readSource(canvas, m.source).catch(() => []);
					if (chunks[0]) parts.push(chunks[0].slice(0, 500));
				}
			}
			return { id: cl.id, text: parts.join("\n---\n").slice(0, 2000) };
		}),
	);

	const prompt = buildNamingPrompt(enriched);
	// Generous budget: small models are often reasoning models (e.g. nemotron-nano)
	// that burn tokens thinking before emitting the JSON — 500 truncates them empty.
	// If strict json mode still yields nothing, retry as plain text (parseJson
	// tolerantly slices the JSON out of any surrounding prose / <think> blocks).
	let raw = await chatComplete(prompt, 1500, NAME_SYSTEM, { json: true, tier: "small" });
	if (!raw.trim()) raw = await chatComplete(prompt, 1500, NAME_SYSTEM, { tier: "small" });
	if (!raw.trim()) return c.json({ names: {} });
	try {
		return c.json({
			names: parseNames(
				parseJson(raw),
				clusters.map((x) => x.id),
			),
		});
	} catch (err) {
		log.warn("cleanup", "name parse failed", { err: String(err) });
		return c.json({ names: {} });
	}
});
