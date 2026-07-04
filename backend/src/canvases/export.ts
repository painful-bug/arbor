// Canvas export: Markdown (human-readable) and Obsidian Canvas 1.0 JSON
// (github.com/obsidianmd/jsoncanvas) — the two interop formats the frontend
// export button offers. Pure functions over the stored canvas doc shape.

interface Turn {
	prompt: string;
	answer: string;
}
interface CanvasNode {
	id: string;
	type: string; // "card" | "web" | "file" | "text" | "tag" | "group"
	position: { x: number; y: number };
	width?: number;
	height?: number;
	data: Record<string, unknown>;
}
interface CanvasEdge {
	id: string;
	source: string;
	target: string;
}

/** The stored canvas shape — same as what GET/PUT /api/canvases/:id already round-trips. */
export interface CanvasDoc {
	id: string;
	name: string;
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

const DEFAULT_W = 320;
const DEFAULT_H = 200;

function nodeTitle(n: CanvasNode): string {
	const d = n.data;
	if (n.type === "card")
		return (
			(d.title as string) || ((d.turns as Turn[])?.[0]?.prompt ?? "").slice(0, 60) || "Untitled"
		);
	if (n.type === "text") return ((d.text as string) ?? "").slice(0, 60) || "Note";
	if (n.type === "file") return (d.filename as string) ?? "File";
	if (n.type === "web") return (d.title as string) ?? (d.url as string) ?? "Link";
	return n.type;
}

/** Plain-text body of a node's content, for Markdown export and the Synthesize action. */
export function nodePlainText(n: CanvasNode): string {
	const d = n.data;
	if (n.type === "card") {
		const turns = (d.turns as Turn[]) ?? [];
		return turns.map((t) => `**You:** ${t.prompt}\n\n**AI:** ${t.answer}`).join("\n\n");
	}
	if (n.type === "text") return (d.text as string) ?? "";
	if (n.type === "file") return `![[${(d.filename as string) ?? ""}]]`;
	if (n.type === "web")
		return `[${(d.title as string) || (d.url as string) || ""}](${(d.url as string) ?? ""})`;
	return "";
}

/** Render a canvas as Markdown: one section per node (reading order), then connections. */
export function toMarkdown(canvas: CanvasDoc): string {
	const ordered = [...canvas.nodes].sort(
		(a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
	);
	const byId = new Map(canvas.nodes.map((n) => [n.id, n]));

	const sections = ordered.map((n) => `## ${nodeTitle(n)}\n\n${nodePlainText(n)}`);
	const lines: string[] = [`# ${canvas.name}`, "", ...sections.join("\n\n").split("\n")];

	if (canvas.edges.length) {
		lines.push("", "## Connections");
		for (const e of canvas.edges) {
			const src = byId.get(e.source);
			const tgt = byId.get(e.target);
			if (src && tgt) lines.push(`- ${nodeTitle(src)} → ${nodeTitle(tgt)}`);
		}
	}
	return lines.join("\n");
}

type ObsidianNodeType = "text" | "file" | "link";

function obsidianType(kind: string): ObsidianNodeType {
	if (kind === "web") return "link";
	if (kind === "file") return "text"; // rendered as a `![[name]]` embed placeholder
	return "text";
}

/** Render a canvas as JSON Canvas 1.0 (Obsidian Canvas) — returns a JSON string. */
export function toObsidianCanvas(canvas: CanvasDoc): string {
	const nodes = canvas.nodes.map((n) => {
		const type = obsidianType(n.type);
		const base = {
			id: n.id,
			type,
			x: Math.round(n.position.x),
			y: Math.round(n.position.y),
			width: n.width ?? DEFAULT_W,
			height: n.height ?? DEFAULT_H,
		};
		if (type === "link") return { ...base, url: (n.data.url as string) ?? "" };
		return { ...base, text: nodePlainText(n) };
	});
	const edges = canvas.edges.map((e) => ({
		id: e.id,
		fromNode: e.source,
		toNode: e.target,
		fromSide: "bottom",
		toSide: "top",
	}));
	return JSON.stringify({ nodes, edges }, null, 2);
}
