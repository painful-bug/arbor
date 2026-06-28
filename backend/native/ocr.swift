// Loom OCR — Apple Vision framework text recognition.
// Usage: loom-ocr <image-path>
// Prints recognized text lines to stdout. Exit 0 on success, 1 on error.
import Foundation
import Vision

#if canImport(AppKit)
import AppKit
#endif

guard CommandLine.arguments.count > 1 else {
    fputs("usage: loom-ocr <image-path>\n", stderr)
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

guard let observations = request.results else { exit(0) }
for observation in observations {
    if let candidate = observation.topCandidates(1).first {
        print(candidate.string)
    }
}
