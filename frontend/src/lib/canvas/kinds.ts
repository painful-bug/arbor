// File-kind type guards, consolidating literal comparisons repeated across
// FileCard / FilePanel / Canvas. Accepts anything with an optional `kind`.
type Kinded = { kind?: string } | null | undefined;

/** PDF file card. */
export const isPdfFile = (f: Kinded): boolean => f?.kind === "pdf";
/** Image file card. */
export const isImageFile = (f: Kinded): boolean => f?.kind === "image";
/** Word document card. */
export const isDocxFile = (f: Kinded): boolean => f?.kind === "docx";
/** Markdown file card. */
export const isMarkdownFile = (f: Kinded): boolean => f?.kind === "markdown";
/** Plain-text file card. */
export const isTextFile = (f: Kinded): boolean => f?.kind === "text";
/** File whose content is editable in-app (text-based formats). */
export const isEditableFile = (f: Kinded): boolean =>
	isMarkdownFile(f) || isTextFile(f) || isDocxFile(f);
