// src/parse/text.ts
function parseText(text) {
  const out = [];
  for (const part of text.split(/\n{2,}/)) {
    const t = part.trim();
    if (!t) continue;
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ type: "heading", page: 1, readingOrder: 0, method: "native", confidence: 1, level: h[1].length, text: h[2].trim() });
    } else {
      out.push({ type: "paragraph", page: 1, readingOrder: 0, method: "native", confidence: 1, text: t });
    }
  }
  return out;
}
function parseHtml(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? [{ type: "paragraph", page: 1, readingOrder: 0, method: "native", confidence: 1, text }] : [];
}

// src/table.ts
function linesToTable(lines) {
  const items = lines.filter((l) => l.text.trim());
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = [];
  for (const l of sorted) {
    const row = rows[rows.length - 1];
    const cy = (l.bbox.y0 + l.bbox.y1) / 2;
    const band = row ? Math.max(...row.map((r) => r.bbox.y1)) : 0;
    if (row && cy <= band) row.push(l);
    else rows.push([l]);
  }
  return rows.map(
    (row) => [...row].sort((a, b) => a.bbox.x0 - b.bbox.x0).map((l) => l.text.trim())
  );
}

// src/parse/pdf.ts
function toBBox(b) {
  if (!b) return void 0;
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}
function blockText(blk) {
  return (blk.lines ?? []).map((l) => l.text ?? (l.spans ?? []).map((s) => s.text ?? "").join("")).join("\n").trim();
}
var PAGE_CHAR_THRESHOLD = 100;
var RENDER_SCALE = 2;
var BLOCK_TYPE = {
  title: "heading",
  text: "paragraph",
  figure: "figure",
  formula: "formula",
  table: "table"
};
function joinLines(lines) {
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const text = sorted.map((l) => l.text.trim()).filter(Boolean).join("\n").trim();
  const conf = sorted.length ? sorted.reduce((s, l) => s + l.confidence, 0) / sorted.length : 0;
  return { text, conf };
}
var byYX = (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0;
function readingOrder(regions) {
  if (regions.length < 3) return [...regions].sort(byYX);
  const straddles = regions.some((r) => r.bbox.x0 < 0.45 && r.bbox.x1 > 0.55);
  if (straddles) return [...regions].sort(byYX);
  const center = (r) => (r.bbox.x0 + r.bbox.x1) / 2;
  const left = regions.filter((r) => center(r) < 0.5).sort(byYX);
  const right = regions.filter((r) => center(r) >= 0.5).sort(byYX);
  return [...left, ...right];
}
async function cropRegion(png, r, imgW, imgH) {
  const left = Math.max(0, Math.floor(r.x0 * imgW));
  const top = Math.max(0, Math.floor(r.y0 * imgH));
  const w = Math.min(imgW - left, Math.ceil((r.x1 - r.x0) * imgW));
  const h = Math.min(imgH - top, Math.ceil((r.y1 - r.y0) * imgH));
  if (w < 4 || h < 4) return null;
  const { default: sharp } = await import("sharp");
  const out = await sharp(png).extract({ left, top, width: w, height: h }).png().toBuffer();
  return { png: new Uint8Array(out), w, h };
}
async function parsePdf(bytes, range, deps = {}) {
  const { ocr, layout, formula, onProgress } = deps;
  const { default: mupdf } = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const [start, end] = range;
  const blocks = [];
  const dims = /* @__PURE__ */ new Map();
  for (let i = start; i < end; i++) {
    const pageNum = i + 1;
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const pageW = x1 - x0;
    const pageH = y1 - y0;
    dims.set(pageNum, { width: pageW, height: pageH });
    const st = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
    const native = [];
    for (const blk of st.blocks ?? []) {
      const text = blockText(blk);
      if (!text) continue;
      native.push({ type: "paragraph", page: pageNum, readingOrder: 0, method: "native", confidence: 1, text, bbox: toBBox(blk.bbox) });
    }
    const nativeChars = native.reduce((n, b) => n + (b.text?.length ?? 0), 0);
    if (ocr && nativeChars < PAGE_CHAR_THRESHOLD) {
      const pixmap = page.toPixmap(mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
      const pagePng = pixmap.asPNG();
      const imgW = pixmap.getWidth();
      const imgH = pixmap.getHeight();
      const before = blocks.length;
      const detected = layout ? await layout(pagePng).catch(() => []) : [];
      for (const reg of readingOrder(detected)) {
        const crop = await cropRegion(pagePng, reg.bbox, imgW, imgH);
        if (!crop) continue;
        const lines = await ocr(crop.png, { width: crop.w, height: crop.h });
        const { text, conf } = joinLines(lines);
        const bbox = { x0: reg.bbox.x0 * pageW, y0: reg.bbox.y0 * pageH, x1: reg.bbox.x1 * pageW, y1: reg.bbox.y1 * pageH };
        const base = { page: pageNum, readingOrder: 0, method: "ocr", confidence: conf || reg.confidence, bbox };
        if (reg.type === "table") {
          const rows = linesToTable(lines);
          if (rows.length) {
            blocks.push({ ...base, type: "table", rows });
            continue;
          }
        }
        if (reg.type === "formula") {
          const latex = formula ? await formula(crop.png).catch(() => null) : null;
          if (latex || text) {
            blocks.push({ ...base, type: "formula", latex: latex ?? void 0, text: latex ? void 0 : text });
            continue;
          }
        }
        if (text) blocks.push({ ...base, type: BLOCK_TYPE[reg.type], text });
      }
      if (blocks.length === before) {
        const lines = await ocr(pagePng, { width: imgW, height: imgH });
        const { text, conf } = joinLines(lines);
        if (text) {
          blocks.push({ type: "paragraph", page: pageNum, readingOrder: 0, method: "ocr", confidence: conf, text });
        } else {
          blocks.push(...native);
        }
      }
    } else {
      blocks.push(...native);
    }
    onProgress?.({ page: pageNum - start, total: end - start });
  }
  return { blocks, dims };
}
async function pdfPageCount(bytes) {
  const { default: mupdf } = await import("mupdf");
  return mupdf.Document.openDocument(bytes, "application/pdf").countPages();
}

// src/parse/office.ts
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
var para = (text) => ({
  type: "paragraph",
  page: 1,
  readingOrder: 0,
  method: "native",
  confidence: 1,
  text
});
function textToBlocks(text) {
  return text.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean).map(para);
}
async function parseDocx(bytes) {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return textToBlocks(value);
}
async function parsePptx(bytes) {
  const { parseOfficeAsync } = await import("officeparser");
  const text = await parseOfficeAsync(Buffer.from(bytes));
  return textToBlocks(text);
}
async function parseCsv(bytes) {
  const { csvParseRows } = await import("d3-dsv");
  const rows = csvParseRows(new TextDecoder().decode(bytes));
  return rows.length ? [{ type: "table", page: 1, readingOrder: 0, method: "native", confidence: 1, rows }] : [];
}
async function parseEpub(bytes) {
  const { EPubLoader } = await import("@langchain/community/document_loaders/fs/epub");
  const p = join(tmpdir(), `mosaic_${randomBytes(8).toString("hex")}.epub`);
  await writeFile(p, bytes);
  try {
    const docs = await new EPubLoader(p).load();
    return textToBlocks(docs.map((d) => d.pageContent).join("\n\n"));
  } finally {
    await unlink(p).catch(() => {
    });
  }
}

// src/ocr/native.ts
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile as writeFile2, unlink as unlink2, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join2, dirname } from "path";
import { randomBytes as randomBytes2 } from "crypto";
import { fileURLToPath } from "url";
var run = promisify(execFile);
async function withTempPng(png, fn) {
  const p = join2(tmpdir2(), `mosaic_ocr_${randomBytes2(8).toString("hex")}.png`);
  await writeFile2(p, png);
  try {
    return await fn(p);
  } finally {
    await unlink2(p).catch(() => {
    });
  }
}
function swiftSource() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../native/ocr.swift", "../../native/ocr.swift"]) {
    const p = join2(here, rel);
    if (existsSync(p)) return p;
  }
  return null;
}
var visionBin;
async function findVision(modelDir) {
  if (visionBin !== void 0) return visionBin;
  if (process.platform !== "darwin") return visionBin = null;
  const binDir = join2(modelDir ?? tmpdir2(), "bin");
  const bin = join2(binDir, "mosaic-ocr");
  if (existsSync(bin)) return visionBin = bin;
  const src = swiftSource();
  if (!src) return visionBin = null;
  try {
    await mkdir(binDir, { recursive: true });
    await run("swiftc", ["-O", src, "-o", bin]);
    if (existsSync(bin)) return visionBin = bin;
  } catch {
  }
  return visionBin = null;
}
async function ocrVision(png, modelDir) {
  const bin = await findVision(modelDir);
  if (!bin) return [];
  return withTempPng(png, async (p) => {
    const { stdout } = await run(bin, [p], { maxBuffer: 64 * 1024 * 1024 });
    const lines = [];
    for (const row of stdout.split("\n")) {
      const s = row.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s);
        lines.push({
          text: o.t,
          bbox: { x0: o.x, y0: 1 - (o.y + o.h), x1: o.x + o.w, y1: 1 - o.y },
          confidence: o.c
        });
      } catch {
      }
    }
    return lines;
  });
}
var TESSERACT_BINS = ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "tesseract"];
var tesseractBin;
async function findTesseract() {
  if (tesseractBin !== void 0) return tesseractBin;
  for (const bin of TESSERACT_BINS) {
    try {
      await run(bin, ["--version"]);
      return tesseractBin = bin;
    } catch {
    }
  }
  return tesseractBin = null;
}
function parseTsv(tsv, imgW, imgH) {
  const byLine = /* @__PURE__ */ new Map();
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("	");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c[11]?.trim();
    if (!text) continue;
    const [left, top, w, h, conf] = [+c[6], +c[7], +c[8], +c[9], +c[10]];
    const key = `${c[2]}:${c[3]}:${c[4]}`;
    const e = byLine.get(key) ?? { words: [], l: Infinity, t: Infinity, r: 0, b: 0, conf: [] };
    e.words.push(text);
    e.l = Math.min(e.l, left);
    e.t = Math.min(e.t, top);
    e.r = Math.max(e.r, left + w);
    e.b = Math.max(e.b, top + h);
    if (conf >= 0) e.conf.push(conf);
    byLine.set(key, e);
  }
  return [...byLine.values()].map((e) => ({
    text: e.words.join(" "),
    bbox: { x0: e.l / imgW, y0: e.t / imgH, x1: e.r / imgW, y1: e.b / imgH },
    confidence: e.conf.length ? e.conf.reduce((a, b) => a + b, 0) / e.conf.length / 100 : 0.5
  }));
}
async function ocrTesseract(png, imgW, imgH) {
  const bin = await findTesseract();
  if (!bin) return [];
  return withTempPng(png, async (p) => {
    const { stdout } = await run(bin, [p, "stdout", "--psm", "3", "--oem", "1", "tsv"], {
      maxBuffer: 64 * 1024 * 1024
    });
    return parseTsv(stdout, imgW, imgH);
  });
}

// src/ocr/ppocr.ts
import { writeFile as writeFile3, unlink as unlink3 } from "fs/promises";
import { tmpdir as tmpdir3 } from "os";
import { join as join3 } from "path";
import { randomBytes as randomBytes3 } from "crypto";
var instance;
function load() {
  if (!instance) {
    instance = import("@gutenye/ocr-node").then((m) => m.default.create());
  }
  return instance;
}
async function ocrPaddle(png, _modelDir) {
  const ocr = await load();
  const { default: sharp } = await import("sharp");
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const p = join3(tmpdir3(), `mosaic_ppocr_${randomBytes3(8).toString("hex")}.png`);
  await writeFile3(p, png);
  try {
    const lines = await ocr.detect(p);
    return lines.filter((l) => l.text?.trim()).map((l) => {
      const xs = (l.box ?? []).map((pt) => pt[0]);
      const ys = (l.box ?? []).map((pt) => pt[1]);
      const x0 = xs.length ? Math.min(...xs) : 0;
      const y0 = ys.length ? Math.min(...ys) : 0;
      const x1 = xs.length ? Math.max(...xs) : w;
      const y1 = ys.length ? Math.max(...ys) : h;
      return {
        text: l.text.trim(),
        bbox: { x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h },
        confidence: l.mean ?? 0.8
      };
    });
  } finally {
    await unlink3(p).catch(() => {
    });
  }
}

// src/ocr/index.ts
var MIN_CHARS = 8;
function joinChars(lines) {
  return lines.reduce((n, l) => n + l.text.trim().length, 0);
}
function engineOrder(png, opts) {
  const vision = () => ocrVision(png, opts.modelDir);
  const paddle = () => ocrPaddle(png, opts.modelDir);
  const tess = () => ocrTesseract(png, opts.imgWidth, opts.imgHeight);
  return process.platform === "darwin" ? [vision, tess, paddle] : [paddle, tess, vision];
}
async function ocrImage(png, opts) {
  let best = [];
  for (const engine of engineOrder(png, opts)) {
    const lines = await engine().catch(() => null) ?? [];
    if (joinChars(lines) >= MIN_CHARS) return lines;
    if (joinChars(lines) > joinChars(best)) best = lines;
  }
  if (opts.cloudOcrImage) {
    const text = await opts.cloudOcrImage(png).catch(() => "");
    if (text.trim().length >= MIN_CHARS) {
      return [{ text: text.trim(), bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: 0.7 }];
    }
  }
  return best;
}

// src/ocr/onnx.ts
import { mkdir as mkdir2 } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import { createWriteStream } from "fs";
import { join as join4 } from "path";
import { tmpdir as tmpdir4 } from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
function modelsRoot(modelDir) {
  return join4(modelDir ?? join4(tmpdir4(), "mosaic-models"), "mosaic");
}
async function ensureModel(modelDir, sub, file, url) {
  const dir = join4(modelsRoot(modelDir), sub);
  const dest = join4(dir, file);
  if (existsSync2(dest)) return dest;
  await mkdir2(dir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`mosaic: model download failed ${res.status} ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const { rename } = await import("fs/promises");
  await rename(tmp, dest);
  return dest;
}
var sessions = /* @__PURE__ */ new Map();
async function session(path) {
  let s = sessions.get(path);
  if (!s) {
    s = import("onnxruntime-node").then((ort) => ort.InferenceSession.create(path));
    sessions.set(path, s);
  }
  return s;
}

// src/ocr/layout.ts
var MODEL_URL = "https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx";
var IMGSZ = 1024;
var CONF = 0.25;
var CLASSES = [
  "title",
  "plain text",
  "abandon",
  "figure",
  "figure_caption",
  "table",
  "table_caption",
  "table_footnote",
  "isolate_formula",
  "formula_caption"
];
function mapType(name) {
  switch (name) {
    case "title":
      return "title";
    case "figure":
      return "figure";
    case "table":
      return "table";
    case "isolate_formula":
      return "formula";
    case "abandon":
      return null;
    // skip page furniture
    default:
      return "text";
  }
}
async function preprocess(png) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(png).metadata();
  const w0 = meta.width ?? 1;
  const h0 = meta.height ?? 1;
  const r = Math.min(IMGSZ / w0, IMGSZ / h0);
  const rw = Math.round(w0 * r);
  const rh = Math.round(h0 * r);
  const padX = Math.floor((IMGSZ - rw) / 2);
  const padY = Math.floor((IMGSZ - rh) / 2);
  const { data } = await sharp(png).removeAlpha().resize(IMGSZ, IMGSZ, { fit: "contain", background: { r: 114, g: 114, b: 114 } }).raw().toBuffer({ resolveWithObject: true });
  const n = IMGSZ * IMGSZ;
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const rr = data[i * 3] / 255;
    const gg = data[i * 3 + 1] / 255;
    const bb = data[i * 3 + 2] / 255;
    t[i] = bb;
    t[n + i] = gg;
    t[2 * n + i] = rr;
  }
  return { tensor: t, w0, h0, r, padX, padY };
}
async function detectLayout(png, modelDir) {
  const path = await ensureModel(modelDir, "doclayout", "doclayout_yolo_docstructbench_imgsz1024.onnx", MODEL_URL);
  const sess = await session(path);
  const ort = await import("onnxruntime-node");
  const { tensor, w0, h0, r, padX, padY } = await preprocess(png);
  const input = new ort.Tensor("float32", tensor, [1, 3, IMGSZ, IMGSZ]);
  const out = await sess.run({ [sess.inputNames[0]]: input });
  const data = out[sess.outputNames[0]].data;
  const regions = [];
  for (let i = 0; i < data.length; i += 6) {
    const conf = data[i + 4];
    if (conf < CONF) continue;
    const type = mapType(CLASSES[Math.round(data[i + 5])] ?? "");
    if (!type) continue;
    const x0 = (data[i] - padX) / r / w0;
    const y0 = (data[i + 1] - padY) / r / h0;
    const x1 = (data[i + 2] - padX) / r / w0;
    const y1 = (data[i + 3] - padY) / r / h0;
    regions.push({
      type,
      confidence: conf,
      bbox: {
        x0: Math.max(0, Math.min(1, x0)),
        y0: Math.max(0, Math.min(1, y0)),
        x1: Math.max(0, Math.min(1, x1)),
        y1: Math.max(0, Math.min(1, y1))
      }
    });
  }
  return suppressNested(regions);
}
var area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function inter(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
function suppressNested(regions) {
  const sorted = [...regions].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const r of sorted) {
    const ra = area(r.bbox) || 1e-9;
    const overlaps = kept.some((k) => {
      const i = inter(r.bbox, k.bbox);
      return i / ra > 0.6 || i / (area(k.bbox) || 1e-9) > 0.6;
    });
    if (!overlaps) kept.push(r);
  }
  return kept;
}

// src/ast.ts
function blocksInOrder(doc) {
  return doc.pages.flatMap((p) => p.blocks).sort((a, b) => a.readingOrder - b.readingOrder);
}
function plainText(doc) {
  return blocksInOrder(doc).map((b) => b.latex ?? b.text ?? "").filter(Boolean).join("\n\n").trim();
}

// src/markdown.ts
function tableToMarkdown(rows) {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => {
    const cells = [...r];
    while (cells.length < width) cells.push("");
    return cells.map((c) => c.replace(/\|/g, "\\|").replace(/\n/g, " ").trim());
  };
  const header = pad(rows[0]);
  const sep = new Array(width).fill("---");
  const body = rows.slice(1).map(pad);
  return [header, sep, ...body].map((r) => `| ${r.join(" | ")} |`).join("\n");
}
function blockToMarkdown(b) {
  switch (b.type) {
    case "heading": {
      const level = Math.min(Math.max(b.level ?? 1, 1), 6);
      return `${"#".repeat(level)} ${b.text ?? ""}`.trim();
    }
    case "formula":
      return b.latex ? `$$
${b.latex.trim()}
$$` : b.text ?? "";
    case "table":
      return b.rows ? tableToMarkdown(b.rows) : b.text ?? "";
    case "figure": {
      const cap = (b.text ?? "").trim();
      return cap ? `> _Figure:_ ${cap}` : "";
    }
    case "list":
    case "paragraph":
    default:
      return (b.text ?? "").trim();
  }
}
function toMarkdown(doc) {
  return blocksInOrder(doc).map(blockToMarkdown).filter((s) => s.length > 0).join("\n\n").trim();
}
function toMarkdownPages(doc) {
  return doc.pages.map((p) => ({
    page: p.number,
    text: [...p.blocks].sort((a, b) => a.readingOrder - b.readingOrder).map(blockToMarkdown).filter((s) => s.length > 0).join("\n\n").trim()
  })).filter((p) => p.text.length > 0);
}

// src/index.ts
var MIME_BY_EXT = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  epub: "application/epub+zip",
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp"
};
function guessMime(filename) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "text/plain";
}
function resolveRange(total, pages, maxPages) {
  let start = 0;
  let end = total;
  if (pages) {
    const m = pages.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (m) {
      start = Math.max(0, parseInt(m[1], 10) - 1);
      end = m[2] ? parseInt(m[2], 10) : start + 1;
    }
  }
  end = Math.min(end, total);
  if (maxPages != null) end = Math.min(end, start + maxPages);
  return [start, Math.max(start, end)];
}
function assemble(filename, mime, blocks, dims) {
  const byPage = /* @__PURE__ */ new Map();
  for (const b of blocks) {
    const list = byPage.get(b.page) ?? [];
    list.push(b);
    byPage.set(b.page, list);
  }
  let order = 0;
  const pages = [...byPage.keys()].sort((a, b) => a - b).map((n) => {
    const blks = byPage.get(n);
    for (const b of blks) b.readingOrder = order++;
    const d = dims?.get(n);
    return { number: n, blocks: blks, width: d?.width, height: d?.height };
  });
  return { filename, mime, pages };
}
async function extract(bytes, opts = {}) {
  const filename = opts.filename ?? "document";
  const mime = opts.mime ?? guessMime(filename);
  const lower = filename.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const total = await pdfPageCount(bytes);
    const range = resolveRange(total, opts.pages, opts.maxPages);
    const ocr = (png, img) => ocrImage(png, {
      modelDir: opts.modelDir,
      imgWidth: img.width,
      imgHeight: img.height,
      cloudOcrImage: opts.ocr?.cloudOcrImage
    });
    const layout = process.platform === "darwin" ? void 0 : (png) => detectLayout(png, opts.modelDir);
    const { blocks, dims } = await parsePdf(bytes, range, { ocr, layout, onProgress: opts.onProgress });
    return assemble(filename, mime, blocks, dims);
  }
  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
    return assemble(filename, mime, await parseDocx(bytes));
  }
  if (mime.includes("presentationml") || lower.endsWith(".pptx")) {
    return assemble(filename, mime, await parsePptx(bytes));
  }
  if (mime === "text/csv" || lower.endsWith(".csv")) {
    return assemble(filename, mime, await parseCsv(bytes));
  }
  if (mime === "application/epub+zip" || lower.endsWith(".epub")) {
    return assemble(filename, mime, await parseEpub(bytes));
  }
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(lower)) {
    const blocks = await ocrImageFile(bytes, mime, opts);
    return assemble(filename, mime, blocks);
  }
  const text = new TextDecoder().decode(bytes);
  if (mime === "text/html" || /\.(html?|htm)$/i.test(lower)) {
    return assemble(filename, mime, parseHtml(text));
  }
  return assemble(filename, "text/plain", parseText(text));
}
async function ocrImageFile(bytes, mime, opts) {
  const { default: mupdf } = await import("mupdf");
  let png = bytes;
  let imgW = 0;
  let imgH = 0;
  try {
    const doc = mupdf.Document.openDocument(bytes, mime || "image/png");
    const pixmap = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    png = pixmap.asPNG();
    imgW = pixmap.getWidth();
    imgH = pixmap.getHeight();
  } catch {
  }
  const lines = await ocrImage(png, {
    modelDir: opts.modelDir,
    imgWidth: imgW || 1,
    imgHeight: imgH || 1,
    cloudOcrImage: opts.ocr?.cloudOcrImage
  });
  const text = lines.map((l) => l.text.trim()).filter(Boolean).join("\n").trim();
  return text ? [{ type: "paragraph", page: 1, readingOrder: 0, method: "ocr", confidence: 1, text }] : [];
}

export {
  blocksInOrder,
  plainText,
  toMarkdown,
  toMarkdownPages,
  extract
};
