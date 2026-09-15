import Foundation
import Vision
import ImageIO

enum MeasurementOCR {
    enum ScanError: LocalizedError {
        case unreadableImage, noText
        var errorDescription: String? {
            switch self {
            case .unreadableImage: return "This image could not be opened. Try another photo."
            case .noText: return "No text was found. Try a clearer, well-lit photo, or enter the rows manually."
            }
        }
    }

    static func thumbnail(_ data: Data) throws -> CGImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2600
              ] as CFDictionary) else { throw ScanError.unreadableImage }
        return image
    }

    static func recognize(_ data: Data) throws -> String {
        let image = try thumbnail(data)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false // Never "correct" measurement digits as prose.
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let observations = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
        // Vision may recognize each table cell separately. Group by vertical
        // overlap and sort left-to-right before producing editable text rows.
        var lines: [(y: CGFloat, height: CGFloat, cells: [(x: CGFloat, text: String)])] = []
        for observation in observations {
            guard let text = observation.topCandidates(1).first?.string else { continue }
            let box = observation.boundingBox
            if let index = lines.firstIndex(where: { abs($0.y - box.midY) < min($0.height, box.height) * 0.5 }) {
                lines[index].cells.append((box.minX, text))
            } else {
                lines.append((box.midY, box.height, [(box.minX, text)]))
            }
        }
        let text = lines.map { $0.cells.sorted { $0.x < $1.x }.map(\.text).joined(separator: " ") }.joined(separator: "\n")
        guard !text.isEmpty else { throw ScanError.noText }
        return text
    }
}
