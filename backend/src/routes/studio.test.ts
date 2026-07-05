import { describe, expect, it } from "bun:test";
import { flatten, parseJson, parseStudySet } from "./studio.ts";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-studio-token");

describe("studio parseJson", () => {
	it("parses plain JSON", () => {
		expect(parseJson('{"a":1}')).toEqual({ a: 1 });
	});
	it("strips ```json code fences", () => {
		expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
	});
	it("drops leading/trailing prose around the object", () => {
		expect(parseJson('Here is your mind map:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
	});
	it("strips trailing commas", () => {
		expect(parseJson('{"a":1,"b":[2,3,],}')).toEqual({ a: 1, b: [2, 3] });
	});
	it("handles prose + fenced JSON together", () => {
		expect(parseJson('Sure!\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
	});
});

describe("studio flatten", () => {
	it("builds root + branches + children with parent pointers", () => {
		const nodes = flatten({
			root: "Networking",
			nodes: [
				{
					title: "Routing",
					summary: "how packets find paths",
					children: [{ title: "Distance Vector", summary: "Bellman-Ford" }],
				},
				{ title: "Switching", summary: "L2 forwarding" },
			],
		});
		expect(nodes[0]).toEqual({ id: "n0", title: "Networking", summary: "", parent: null });
		// root + 2 branches + 1 child = 4
		expect(nodes.length).toBe(4);
		const routing = nodes.find((n) => n.title === "Routing")!;
		expect(routing.parent).toBe("n0");
		const dv = nodes.find((n) => n.title === "Distance Vector")!;
		expect(dv.parent).toBe(routing.id);
	});

	it("skips nodes without a title", () => {
		const nodes = flatten({ root: "X", nodes: [{ summary: "no title" }, { title: "Ok" }] });
		expect(nodes.map((n) => n.title)).toEqual(["X", "Ok"]);
	});
});

describe("studio parseStudySet", () => {
	it("keeps valid flashcards and mcqs", () => {
		const items = parseStudySet({
			flashcards: [{ q: "What is TCP?", a: "A reliable transport protocol" }],
			quiz: [{ q: "Which layer?", choices: ["A", "B", "C", "D"], answer: "B" }],
		});
		expect(items.length).toBe(2);
		expect(items[0]).toEqual({
			kind: "flashcard",
			question: "What is TCP?",
			answer: "A reliable transport protocol",
			choices: null,
		});
		expect(items[1].kind).toBe("mcq");
		expect(items[1].choices).toEqual(["A", "B", "C", "D"]);
	});
	it("drops flashcards missing q or a", () => {
		expect(parseStudySet({ flashcards: [{ q: "x" }, { a: "y" }] })).toEqual([]);
	});
	it("drops mcqs without exactly 4 choices or answer not among them", () => {
		expect(parseStudySet({ quiz: [{ q: "x", choices: ["A", "B", "C"], answer: "A" }] })).toEqual(
			[],
		);
		expect(
			parseStudySet({ quiz: [{ q: "x", choices: ["A", "B", "C", "D"], answer: "Z" }] }),
		).toEqual([]);
	});
});

describe("studio generate route", () => {
	it("400 when source is missing", async () => {
		const res = await api("/api/studio/c/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});
	it("400 when the source is not in the canvas", async () => {
		const res = await api("/api/studio/empty-canvas/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ source: "nope.pdf" }),
		});
		expect(res.status).toBe(400);
	});
	it("review list returns items array for an empty canvas", async () => {
		const res = await api("/api/studio/empty-canvas/review");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ items: [] });
	});
});

describe("studio mindmap route", () => {
	it("400 when source is missing", async () => {
		const res = await api("/api/studio/c/mindmap", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("400 when the source is not in the canvas", async () => {
		const res = await api("/api/studio/empty-canvas/mindmap", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ source: "nope.pdf" }),
		});
		expect(res.status).toBe(400);
	});
});
