import AppKit
import Foundation
import Vision

struct Line: Encodable {
    let text: String
    let confidence: Float
}

struct Payload: Encodable {
    let provider: String
    let text: String
    let lines: [Line]
}

enum OcrError: Error {
    case missingPath
    case loadFailed
}

func loadCGImage(from filePath: String) throws -> CGImage {
    let url = URL(fileURLWithPath: filePath)
    guard let nsImage = NSImage(contentsOf: url) else {
        throw OcrError.loadFailed
    }
    var rect = NSRect(origin: .zero, size: nsImage.size)
    guard let cgImage = nsImage.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        throw OcrError.loadFailed
    }
    return cgImage
}

func run(filePath: String) throws -> Payload {
    let cgImage = try loadCGImage(from: filePath)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US", "zh-Hant"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    let observations = request.results ?? []
    let lines: [Line] = observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return Line(text: candidate.string, confidence: candidate.confidence)
    }

    let text = lines.map(\.text).joined(separator: "\n")
    return Payload(provider: "macos_vision", text: text, lines: lines)
}

do {
    guard CommandLine.arguments.count >= 2 else {
        throw OcrError.missingPath
    }
    let payload = try run(filePath: CommandLine.arguments[1])
    let data = try JSONEncoder().encode(payload)
    FileHandle.standardOutput.write(data)
} catch {
    let message = String(describing: error)
    struct ErrorPayload: Encodable {
        let error: String
        let message: String
    }
    let payload = ErrorPayload(error: "ocr_failed", message: message)
    if let data = try? JSONEncoder().encode(payload) {
        FileHandle.standardError.write(data)
    }
    exit(1)
}
