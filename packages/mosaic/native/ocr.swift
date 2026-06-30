// mosaic OCR — Apple Vision framework text recognition with bounding boxes.
// Usage: mosaic-ocr <image-path>
// Prints one JSON object per recognized line to stdout (NDJSON):
//   {"t":"text","x":0.1,"y":0.2,"w":0.3,"h":0.04,"c":0.98}
// bbox is normalized 0..1 in Vision's coordinate space (origin bottom-left).
// Exit 0 on success, 1 on error.
import Foundation
import Vision

#if canImport(AppKit)
import AppKit
#endif

guard CommandLine.arguments.count > 1 else {
    fputs("usage: mosaic-ocr <image-path>\n", stderr)
    exit(1)
}
let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let tiffData = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    fputs("error: cannot load image at \(path)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

func jsonString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    let arr = String(data: data, encoding: .utf8)!
    return String(arr.dropFirst().dropLast()) // strip the [ ]
}

guard let observations = request.results else { exit(0) }
for observation in observations {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let b = observation.boundingBox // normalized, origin bottom-left
    let line = "{\"t\":\(jsonString(candidate.string)),\"x\":\(b.minX),\"y\":\(b.minY),\"w\":\(b.width),\"h\":\(b.height),\"c\":\(candidate.confidence)}"
    print(line)
}
