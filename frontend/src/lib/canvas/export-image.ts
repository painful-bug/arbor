// Canvas → PNG / PDF export. Rasterizes the xyflow viewport at a framing that
// fits all nodes (standard xyflow "download image" recipe), then either saves the
// PNG directly or embeds it in a single-page PDF via jsPDF.
import { getNodesBounds, getViewportForBounds } from "@xyflow/svelte";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { flow } from "./store.svelte";

const MAX = 4096; // cap output edge so huge boards don't blow up memory
const PAD = 0.1; // 10% breathing room around the bounding box

function triggerDownload(url: string, filename: string) {
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
}

// Render the current canvas nodes to a PNG data URL at a fitted framing.
async function renderPng(): Promise<{ dataUrl: string; width: number; height: number } | null> {
	const nodes = flow.nodes;
	if (nodes.length === 0) return null;
	const el = document.querySelector<HTMLElement>(".svelte-flow__viewport");
	if (!el) return null;

	const bounds = getNodesBounds(nodes);
	const aspect = bounds.width / bounds.height;
	let width = Math.min(bounds.width, MAX);
	let height = width / aspect;
	if (height > MAX) {
		height = MAX;
		width = height * aspect;
	}

	const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.2, 2, PAD);
	const dataUrl = await toPng(el, {
		backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
		width,
		height,
		style: {
			width: `${width}px`,
			height: `${height}px`,
			transform: `translate(${x}px, ${y}px) scale(${zoom})`,
		},
	});
	return { dataUrl, width, height };
}

/** Export the current canvas as a PNG or a single-page PDF; saves to ~/Downloads. */
export async function exportCanvasImage(format: "png" | "pdf", filename: string): Promise<void> {
	const rendered = await renderPng();
	if (!rendered) return;
	const { dataUrl, width, height } = rendered;

	if (format === "png") {
		triggerDownload(dataUrl, `${filename}.png`);
		return;
	}

	const pdf = new jsPDF({
		orientation: width >= height ? "landscape" : "portrait",
		unit: "px",
		format: [width, height],
	});
	pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
	pdf.save(`${filename}.pdf`);
}
