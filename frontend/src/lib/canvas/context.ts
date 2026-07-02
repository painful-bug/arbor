// Context builders for agent runs: digests of canvas content injected into the
// system prompt. All pure functions over nodes/edges — no store import, unit-testable.
import type { Edge, Node } from "@xyflow/svelte";
import type { ChatMessage } from "$lib/ai/client";
import { type CardData, type FileData, lastTurn, type TextData, type Turn } from "./cards";

/** Representative text of a node, for embedding / clustering / digests. */
export function snippetOf(node: Node): string {
	const d = node.data as Record<string, unknown>;
	if (node.type === "card") {
		const turns = d.turns as Turn[] | undefined;
		const title = (d.title as string) ?? "";
		const answer = turns?.length ? turns[0].answer?.slice(0, 200) : "";
		return `${title} ${answer}`.trim();
	}
	if (node.type === "text") return ((d.text as string) ?? "").slice(0, 200);
	if (node.type === "file") {
		const name = (d.filename as string) ?? "";
		const preview = (d.preview as string) ?? "";
		return `${name} ${preview.slice(0, 200)}`.trim();
	}
	if (node.type === "web") return (d.title as string) ?? (d.url as string) ?? "";
	return "";
}

/** Nodes directly linked to `id` by any edge (manual or semantic), either direction. */
export function connectedIds(id: string, edges: Edge[]): Set<string> {
	const ids = new Set<string>();
	for (const e of edges) {
		if (e.source === id) ids.add(e.target);
		else if (e.target === id) ids.add(e.source);
	}
	ids.delete(id);
	return ids;
}

export interface ConnectedItem {
	kind: "card" | "text" | "file";
	title: string; // card title / filename ('' for notes)
	body: string; // pre-truncated content to show
}

/**
 * Richer, higher-priority context block for nodes directly connected to a card —
 * fuller text than the generic one-line digest, since the user wired them together.
 */
export function connectedDigestFrom(items: ConnectedItem[]): string {
	const sections = items
		.map((it) => {
			const body = it.body.trim();
			if (it.kind === "card") return body ? `### "${it.title || "(untitled card)"}"\n${body}` : "";
			if (it.kind === "text") return body ? `### [note]\n${body}` : "";
			return `### [file: ${it.title}]\n${body || "(not yet indexed)"}`;
		})
		.filter(Boolean);
	if (!sections.length) return "";
	return (
		"## Connected to this card\n" +
		'The user directly linked these on the canvas — prioritize them over the "Other threads" section below.\n\n' +
		sections.join("\n\n")
	);
}

/** connectedDigestFrom over the live graph, skipping ids already sent as history. */
export function connectedDigest(
	id: string,
	skip: Set<string>,
	nodes: Node[],
	edges: Edge[],
): string {
	const ids = [...connectedIds(id, edges)].filter((cid) => !skip.has(cid));
	const items: ConnectedItem[] = ids
		.map((cid) => nodes.find((n) => n.id === cid))
		.filter((n): n is Node => !!n && (n.type === "card" || n.type === "text" || n.type === "file"))
		.map((n) => {
			if (n.type === "card") {
				const d = n.data as CardData;
				const t = lastTurn(d);
				const body = [t?.prompt, t?.answer]
					.filter(Boolean)
					.join("\n")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 800);
				return { kind: "card" as const, title: d.title ?? "", body };
			}
			if (n.type === "text") {
				const d = n.data as TextData;
				return { kind: "text" as const, title: "", body: (d.text ?? "").slice(0, 1500) };
			}
			const d = n.data as FileData;
			return {
				kind: "file" as const,
				title: d.filename ?? "",
				body: (d.preview ?? "").slice(0, 1500),
			};
		});
	return connectedDigestFrom(items);
}

/** One-line-per-card digest of everything else on the canvas. */
export function canvasDigest(excludeId: string, skip: Set<string>, nodes: Node[]): string {
	const cards = nodes
		.filter(
			(n) =>
				(n.type === "card" || n.type === "text" || n.type === "file") &&
				n.id !== excludeId &&
				!skip.has(n.id),
		)
		.map((n) => {
			if (n.type === "text") {
				const d = n.data as TextData;
				return { id: n.id, title: "[note]", lastAnswer: (d.text ?? "").slice(0, 120) };
			}
			if (n.type === "file") {
				const d = n.data as FileData;
				return { id: n.id, title: `[file: ${d.filename}]`, lastAnswer: "" };
			}
			const d = n.data as CardData;
			return { id: n.id, title: d.title ?? "", lastAnswer: lastTurn(d)?.answer ?? "" };
		});
	return digestFrom(cards, excludeId);
}

/** Format a card list into the "Other threads" digest block. */
export function digestFrom(
	cards: { id: string; title: string; lastAnswer: string }[],
	excludeId: string,
): string {
	const lines: string[] = [];
	for (const c of cards) {
		if (c.id === excludeId) continue;
		const title = c.title.trim();
		if (!title) continue;
		const snippet = c.lastAnswer.replace(/\s+/g, " ").trim().slice(0, 120);
		lines.push(snippet ? `- "${title}": ${snippet}` : `- "${title}"`);
	}
	if (!lines.length) return "";
	return `## Other threads on this canvas\nThe user may reference these. Use them as context when relevant.\n${lines.join("\n")}`;
}

/**
 * Canvas digest that includes node ids — needed so the agent can reference cards by
 * id. Full card content is included (capped at 6000 chars each) for reasoning.
 */
export function canvasDigestWithIds(nodes: Node[]): string {
	const cards = nodes
		.filter((n) => n.type === "card" || n.type === "text")
		.map((n) => {
			const d = n.data as CardData & { text?: string };
			const title = (d.title ?? d.text ?? "").trim();
			const content = n.type === "card" ? (lastTurn(d)?.answer ?? "") : (d.text ?? "");
			return { id: n.id, title, content };
		})
		.filter((c) => c.title);
	if (!cards.length) return "";
	const sections = cards.map((c) => {
		const body = c.content.trim().slice(0, 6000);
		return body
			? `### [${c.id}] ${c.title}\n${body}`
			: `### [${c.id}] ${c.title}\n(no content yet)`;
	});
	return `## Canvas cards (use ids with create_card / update_card)\n\n${sections.join("\n\n")}`;
}

/** Ancestor chain of `id` following edges upward (root first). */
export function ancestry(id: string, edges: Edge[]): string[] {
	const parentOf = new Map<string, string>();
	for (const e of edges) parentOf.set(e.target, e.source);
	const chain: string[] = [];
	let cur = parentOf.get(id);
	while (cur) {
		chain.unshift(cur);
		cur = parentOf.get(cur);
	}
	return chain;
}

/** Flatten a card's turns into alternating user/assistant messages. */
export function pushTurns(messages: ChatMessage[], d: CardData): void {
	for (const t of d.turns ?? []) {
		if (t.prompt) messages.push({ role: "user", content: t.prompt });
		if (t.answer) messages.push({ role: "assistant", content: t.answer });
	}
}
