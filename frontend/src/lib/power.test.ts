import { afterEach, describe, expect, it, vi } from "vitest";
import { initPower, power } from "./power.svelte";

// No jsdom dependency: stub the minimal `document` surface initPower touches
// (EventTarget for visibilitychange, `hidden`, and body.toggleAttribute).
function fakeDocument(hidden: boolean) {
	const target = new EventTarget();
	const attrs = new Set<string>();
	return Object.assign(target, {
		hidden,
		body: {
			toggleAttribute: (name: string, force: boolean) => {
				if (force) attrs.add(name);
				else attrs.delete(name);
			},
			hasAttribute: (name: string) => attrs.has(name),
		},
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("initPower", () => {
	it("reflects the initial document.hidden state", () => {
		const doc = fakeDocument(true);
		vi.stubGlobal("document", doc);
		initPower();
		expect(power.visible).toBe(false);
		expect(doc.body.hasAttribute("data-hidden")).toBe(true);
	});

	it("toggles on visibilitychange", () => {
		const doc = fakeDocument(false);
		vi.stubGlobal("document", doc);
		initPower();
		expect(power.visible).toBe(true);

		doc.hidden = true;
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(power.visible).toBe(false);
		expect(doc.body.hasAttribute("data-hidden")).toBe(true);

		doc.hidden = false;
		doc.dispatchEvent(new Event("visibilitychange"));
		expect(power.visible).toBe(true);
		expect(doc.body.hasAttribute("data-hidden")).toBe(false);
	});
});
