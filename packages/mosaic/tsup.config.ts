import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	target: "node18",
	// mupdf + transformers + langchain are heavy native/optional-dep packages — keep
	// them external so consumers resolve them, not bundled into mosaic's dist.
	external: ["mupdf", "@huggingface/transformers", "@langchain/community", "mammoth", "officeparser", "d3-dsv", "onnxruntime-node", "sharp", "@gutenye/ocr-node"],
});
