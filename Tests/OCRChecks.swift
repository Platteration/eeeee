import AppKit
import Foundation

@main
struct OCRChecks {
    static func main() throws {
        let image = NSImage(size: NSSize(width: 1400, height: 500))
        image.lockFocusFlipped(true)
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: 1400, height: 500).fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 60, weight: .regular),
            .foregroundColor: NSColor.black
        ]
        ("1     3.00     4.00" as NSString).draw(at: NSPoint(x: 80, y: 80), withAttributes: attributes)
        ("2     4.00     3.00" as NSString).draw(at: NSPoint(x: 80, y: 240), withAttributes: attributes)
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let data = bitmap.representation(using: .png, properties: [:])!
        let recognized = try MeasurementOCR.recognize(data)
        print("Recognized synthetic table:\n\(recognized)")
        let rows = MeasurementImport.parse(recognized)
        precondition(rows.errors.isEmpty && rows.rows.count == 2)
        precondition(rows.rows[0].first == 3 && rows.rows[0].second == 4)
        precondition(rows.rows[1].first == 4 && rows.rows[1].second == 3)
        do {
            _ = try MeasurementOCR.recognize(Data("invalid image".utf8))
            preconditionFailure("Invalid image accepted")
        } catch MeasurementOCR.ScanError.unreadableImage {}
        print("OCR smoke check passed using Apple Vision on a generated measurement table")
    }
}
