// Starter canvas templates: seed nodes/edges for the "Start from template" flow in
// Library.svelte. Positions are hand-laid on a 360×240 grid — no overlaps.
import type { Edge, Node } from "@xyflow/svelte";
import { childEdge, type TextData } from "./cards";

export interface CanvasSeed {
	nodes: Node[];
	edges: Edge[];
}

export interface CanvasTemplate {
	id: string;
	name: string;
	description: string;
	seed: CanvasSeed;
}

const BLOCKS = ["lime", "lilac", "cream", "pink"];

function text(id: string, x: number, y: number, body: string, block: string): Node {
	const data: TextData = { text: body, block };
	return { id, type: "text", position: { x, y }, data, width: 320 };
}

function card(id: string, x: number, y: number, title: string, block: string): Node {
	return {
		id,
		type: "card",
		position: { x, y },
		width: 400,
		data: { title, turns: [{ prompt: title, answer: "", events: [] }], streaming: false, block },
	};
}

// lit-review: research question → 3 paper placeholders → synthesis card.
const litReview: CanvasSeed = {
	nodes: [
		text("q", 0, 0, "## Research question\n\nWhat question is this review answering?", BLOCKS[0]),
		text("p1", 360, 0, "## Paper 1\n\nDrop a PDF here or paste notes.", BLOCKS[1]),
		text("p2", 360, 240, "## Paper 2\n\nDrop a PDF here or paste notes.", BLOCKS[1]),
		text("p3", 360, 480, "## Paper 3\n\nDrop a PDF here or paste notes.", BLOCKS[1]),
		card("synth", 760, 240, "Synthesis", BLOCKS[2]),
	],
	edges: [
		childEdge("q", "p1"),
		childEdge("q", "p2"),
		childEdge("q", "p3"),
		childEdge("p1", "synth"),
		childEdge("p2", "synth"),
		childEdge("p3", "synth"),
	],
};

// paper-draft: IMRaD sections, chained.
const paperDraft: CanvasSeed = {
	nodes: [
		text(
			"outline",
			0,
			0,
			"## Outline\n\n- Introduction\n- Methods\n- Results\n- Discussion",
			BLOCKS[0],
		),
		text("intro", 360, 0, "## Introduction\n\nMotivation, gap, contribution.", BLOCKS[1]),
		text("methods", 720, 0, "## Methods\n\nDesign, sampling, procedure.", BLOCKS[1]),
		text("results", 1080, 0, "## Results\n\nFindings, no interpretation yet.", BLOCKS[1]),
		text(
			"discussion",
			1440,
			0,
			"## Discussion\n\nInterpretation, limitations, future work.",
			BLOCKS[2],
		),
	],
	edges: [
		childEdge("outline", "intro"),
		childEdge("intro", "methods"),
		childEdge("methods", "results"),
		childEdge("results", "discussion"),
	],
};

// compare-sources: two sources feeding a comparison card.
const compareSources: CanvasSeed = {
	nodes: [
		text("a", 0, 0, "## Source A\n\nPaste or summarize the first source.", BLOCKS[0]),
		text("b", 0, 240, "## Source B\n\nPaste or summarize the second source.", BLOCKS[0]),
		card("cmp", 360, 120, "Comparison", BLOCKS[2]),
	],
	edges: [childEdge("a", "cmp"), childEdge("b", "cmp")],
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
	{
		id: "lit-review",
		name: "Literature Review",
		description: "Research question, three paper slots, and a synthesis card.",
		seed: litReview,
	},
	{
		id: "paper-draft",
		name: "Paper Draft",
		description: "IMRaD outline chained through Introduction → Discussion.",
		seed: paperDraft,
	},
	{
		id: "compare-sources",
		name: "Compare Sources",
		description: "Two sources side by side feeding a comparison card.",
		seed: compareSources,
	},
];
