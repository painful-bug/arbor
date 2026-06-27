// MIME/extension → plain text. Images return "" (handled separately as vision blobs).
// HTML and DOCX output goes through a tag-strip pass so the model sees clean prose.

export async function loadText(filename: string, mime: string, bytes: Uint8Array): Promise<string> {
	if (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
		const { default: pdfParse } = await import("pdf-parse");
		const data = await pdfParse(Buffer.from(bytes));
		return data.text;
	}

	if (mime.includes("officedocument.wordprocessing") || filename.toLowerCase().endsWith(".docx")) {
		const mammoth = await import("mammoth");
		const fn = (mammoth as any).default?.convertToHtml ?? (mammoth as any).convertToHtml;
		const { value } = await fn({ buffer: Buffer.from(bytes) });
		return stripTags(value);
	}

	const text = new TextDecoder().decode(bytes);

	if (mime === "text/html" || /\.(html?|htm)$/i.test(filename)) {
		return stripTags(text);
	}

	if (mime.startsWith("image/")) return ""; // vision-only; not text-indexed

	return text;
}

function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
