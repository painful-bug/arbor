import { describe, expect, it } from "vitest";
import { align, type Box, distribute } from "./align";

const boxes: Box[] = [
	{ id: "a", x: 0, y: 0, w: 100, h: 50 },
	{ id: "b", x: 200, y: 80, w: 60, h: 30 },
	{ id: "c", x: 50, y: -40, w: 40, h: 20 },
];

describe("align", () => {
	it("left aligns to the min x", () => {
		const out = align(boxes, "left");
		expect(out.a.x).toBe(0);
		expect(out.b.x).toBe(0);
		expect(out.c.x).toBe(0);
	});
	it("right aligns to the max right edge", () => {
		const out = align(boxes, "right");
		// max right edge = 200 + 60 = 260
		expect(out.a.x).toBe(260 - 100);
		expect(out.b.x).toBe(260 - 60);
		expect(out.c.x).toBe(260 - 40);
	});
	it("top aligns to the min y", () => {
		const out = align(boxes, "top");
		expect(out.a.y).toBe(-40);
		expect(out.b.y).toBe(-40);
		expect(out.c.y).toBe(-40);
	});
	it("bottom aligns to the max bottom edge", () => {
		const out = align(boxes, "bottom");
		// max bottom = 80 + 30 = 110
		expect(out.a.y).toBe(110 - 50);
		expect(out.c.y).toBe(110 - 20);
	});
	it("center-h aligns horizontal centers to the average", () => {
		const out = align(boxes, "center-h");
		const avgCx = (0 + 50 + (200 + 30) + (50 + 20)) / 3;
		expect(out.a.x).toBeCloseTo(avgCx - 50);
	});
	it("is a no-op below 2 boxes", () => {
		expect(align([boxes[0]], "left")).toEqual({});
	});
	it("leaves the cross-axis coordinate untouched", () => {
		const out = align(boxes, "left");
		expect(out.b.y).toBe(80);
	});
});

describe("distribute", () => {
	it("is a no-op below 3 boxes", () => {
		expect(distribute(boxes.slice(0, 2), "h")).toEqual({});
	});
	it("spaces boxes with equal edge-to-edge gaps, anchoring first/last", () => {
		const three: Box[] = [
			{ id: "a", x: 0, y: 0, w: 10, h: 10 },
			{ id: "b", x: 999, y: 0, w: 10, h: 10 }, // position ignored except for sort/anchor
			{ id: "c", x: 100, y: 0, w: 10, h: 10 },
		];
		const out = distribute(three, "h");
		// sorted by x: a(0), c(100), b(999) — span = (999+10) - 0 = 1009, totalW = 30, gap = (1009-30)/2 = 489.5
		expect(out.a.x).toBe(0);
		expect(out.c.x).toBeCloseTo(0 + 10 + 489.5);
		expect(out.b.x).toBeCloseTo(999); // last stays at its own anchored position
	});
	it("preserves the cross-axis coordinate", () => {
		const three: Box[] = [
			{ id: "a", x: 0, y: 5, w: 10, h: 10 },
			{ id: "b", x: 50, y: 15, w: 10, h: 10 },
			{ id: "c", x: 100, y: 25, w: 10, h: 10 },
		];
		const out = distribute(three, "h");
		expect(out.a.y).toBe(5);
		expect(out.b.y).toBe(15);
		expect(out.c.y).toBe(25);
	});
	it("distributes vertically", () => {
		const three: Box[] = [
			{ id: "a", x: 0, y: 0, w: 10, h: 10 },
			{ id: "b", x: 0, y: 100, w: 10, h: 10 },
			{ id: "c", x: 0, y: 50, w: 10, h: 10 },
		];
		const out = distribute(three, "v");
		expect(out.a.y).toBe(0);
		expect(out.b.y).toBeCloseTo(100);
	});
});
