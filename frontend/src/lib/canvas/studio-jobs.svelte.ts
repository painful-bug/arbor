// Studio jobs (mind map / study) live at module scope, NOT inside FilePanel — so
// closing the file preview never cancels an in-flight generation. A job runs to
// completion: success dispatches the canvas event; failure raises a toast. The UI
// reads `runningJobs` for the "Mapping…/Studying…" label wherever the file appears.
import { studioGenerate, studioMindmap } from "$lib/ai/client";
import { currentCanvasId } from "./store.svelte";

// key = `${kind}:${fileId}` → true while running. Reactive so buttons disable.
export const runningJobs = $state<Record<string, boolean>>({});

// Transient error banners, surfaced by Canvas (always mounted). Auto-dismiss.
export const studioToasts = $state<{ id: number; message: string }[]>([]);
let toastSeq = 0;

export function isJobRunning(kind: "mindmap" | "study", fileId: string): boolean {
	return runningJobs[`${kind}:${fileId}`] === true;
}

function pushToast(message: string): void {
	const id = ++toastSeq;
	studioToasts.push({ id, message });
	setTimeout(() => {
		const i = studioToasts.findIndex((t) => t.id === id);
		if (i !== -1) studioToasts.splice(i, 1);
	}, 5000);
}

export function dismissToast(id: number): void {
	const i = studioToasts.findIndex((t) => t.id === id);
	if (i !== -1) studioToasts.splice(i, 1);
}

async function run(
	kind: "mindmap" | "study",
	fileId: string,
	work: () => Promise<void>,
): Promise<void> {
	const key = `${kind}:${fileId}`;
	if (runningJobs[key]) return; // already generating for this file
	runningJobs[key] = true;
	try {
		await work();
	} catch (err) {
		pushToast(
			err instanceof Error ? err.message : `${kind === "mindmap" ? "Mind map" : "Study"} failed`,
		);
	} finally {
		delete runningJobs[key];
	}
}

export function runMindmap(fileId: string, filename: string): void {
	void run("mindmap", fileId, async () => {
		const nodes = await studioMindmap(currentCanvasId() || "default", filename);
		window.dispatchEvent(new CustomEvent("arbor:mindmap", { detail: { parentId: fileId, nodes } }));
	});
}

export function runStudy(fileId: string, filename: string): void {
	void run("study", fileId, async () => {
		const items = await studioGenerate(currentCanvasId() || "default", filename);
		window.dispatchEvent(new CustomEvent("arbor:study", { detail: { items } }));
	});
}
