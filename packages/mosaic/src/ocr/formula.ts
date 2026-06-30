// Formula region → LaTeX. This is a seam, not a model.
//
// ponytail: there is no turnkey Node package for RapidLaTeX-OCR / TexTeller — the
// real thing is an autoregressive ViT-encoder→transformer-decoder with a custom
// tokenizer (Python `rapid_latex_ocr`), which would be ~300 fragile lines to port.
// On the quality-gated macOS/Vision path layout is skipped, so formula regions are
// never even produced there; off-macOS the printed-doc ONNX stack garbles the
// handwritten test asset. So the decoder is left unbuilt (plan Phase 6 swap).
//
// Inject a `FormulaOcr` to wire a real model in. Without one, parse/pdf keeps the
// region's OCR text as a `formula` block so equations stay searchable.

export type FormulaOcr = (png: Uint8Array) => Promise<string | null>;
