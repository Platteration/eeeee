import Foundation
import CoreGraphics

@main
struct ImportChecks {
    @MainActor
    static func main() throws {
        let parsed = MeasurementImport.parse("P1 3.0 4.0\nP2;4,0;3,0\nP3,5,0")
        precondition(parsed.errors.isEmpty && parsed.rows.count == 3)
        precondition(parsed.rows[1].first == 4)
        precondition(MeasurementImport.parse("P1, 3.0, 4.0").errors.isEmpty)
        precondition(MeasurementImport.parse("P1 3,0 4,0").errors.isEmpty)
        precondition(!MeasurementImport.parse("Heading A B\nP1 O.5 4\nP2 2 3 extra").errors.isEmpty)
        precondition(!MeasurementImport.parse("P1 2 3\np1 3 2").errors.isEmpty)
        precondition(!MeasurementImport.parse("A 2 3").errors.isEmpty)
        precondition(!MeasurementImport.parse("9223372036854775807 2 3").errors.isEmpty)
        precondition(MeasurementImport.number("nan") == nil && MeasurementImport.number("inf") == nil)
        precondition(MeasurementImport.number("−1,25") == -1.25)
        let row = parsed.rows[0]
        let above = try MeasurementImport.coordinates(for: row, baseline: 5, mode: .distances, below: false)
        let below = try MeasurementImport.coordinates(for: row, baseline: 5, mode: .distances, below: true)
        precondition(abs(above.x - 0.36) < 1e-10 && abs(above.y + 0.48) < 1e-10)
        precondition(above.x == below.x && above.y == -below.y)
        let impossible = MeasurementImport.Row(line: 1, label: "Bad", first: 1, second: 1)
        do {
            _ = try MeasurementImport.coordinates(for: impossible, baseline: 5, mode: .distances, below: false)
            preconditionFailure("Impossible triangle accepted")
        } catch MeasurementImport.ImportError.invalid {}
        let internalImpossible = MeasurementImport.Row(line: 1, label: "Bad", first: 8, second: 1)
        do {
            _ = try MeasurementImport.coordinates(for: internalImpossible, baseline: 5, mode: .distances, below: false)
            preconditionFailure("Nested circles accepted")
        } catch MeasurementImport.ImportError.invalid {}
        let tangent = MeasurementImport.Row(line: 1, label: "T", first: 2, second: 3)
        let onLine = try MeasurementImport.coordinates(for: tangent, baseline: 5, mode: .distances, below: false)
        precondition(abs(onLine.x - 0.4) < 1e-10 && abs(onLine.y) < 1e-7)
        let offset = MeasurementImport.Row(line: 1, label: "X", first: -2, second: 3)
        let xy = try MeasurementImport.coordinates(for: offset, baseline: 5, mode: .offsets, below: false)
        precondition(xy == CGPoint(x: -0.4, y: 0.6))

        let imported = try MeasurementImport.document(text: "1 3 4\n2 4 3", baseline: 5, unit: .feet,
                                                      mode: .distances, belowLabels: ["2"],
                                                      canvasSize: CGSize(width: 320, height: 500))
        precondition(imported.unit == .feet && imported.abDistance == 5)
        for (index, point) in imported.points.enumerated() {
            let distances = PlotMath.referenceDistances(of: point.position, in: imported)!
            precondition(abs(distances.a - (index == 0 ? 3 : 4)) < 1e-10)
            precondition(abs(distances.b - (index == 0 ? 4 : 3)) < 1e-10)
            let coordinates = PlotMath.abCoordinates(of: point.position, a: imported.pointA, b: imported.pointB)!
            precondition(index == 0 ? coordinates.t < 0 : coordinates.t > 0)
        }
        for text in ["", "P1 1 2\nNotes", "A 1 2"] {
            do {
                _ = try MeasurementImport.document(text: text, baseline: 5, unit: .meters, mode: .offsets,
                                                   belowLabels: [], canvasSize: .zero)
                preconditionFailure("Invalid text accepted")
            } catch MeasurementImport.ImportError.invalid {}
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ABPlot-import-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let model = PlotViewModel(saveURL: url)
        model.addPoint(at: CGPoint(x: 123, y: 234))
        let original = model.doc
        model.importMeasurements(imported)
        precondition(model.doc == imported && model.selectedPointID == nil)
        precondition(PlotViewModel(saveURL: url).doc == imported)
        model.undo()
        precondition(model.doc == original)
        model.redo()
        precondition(model.doc == imported)
        model.addPoint(at: .zero)
        precondition(model.doc.points.last?.label == "3")

        // Scanning measurements replaces the geometry only: the plot's name and
        // the review metadata saved from the web editor must survive.
        let namedURL = FileManager.default.temporaryDirectory.appendingPathComponent("ABPlot-import-named-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: namedURL) }
        let named = PlotViewModel(saveURL: namedURL)
        var reviewed = named.doc
        reviewed.name = "North pool"
        reviewed.baselineNote = "Tape sagged at B"
        reviewed.baselineNeedsRemeasure = true
        reviewed.outlineDirection = "clockwise"
        named.importMeasurements(reviewed)
        named.replaceMeasurements(with: imported)
        precondition(named.doc.name == "North pool" && named.doc.baselineNote == "Tape sagged at B")
        precondition(named.doc.baselineNeedsRemeasure == true && named.doc.outlineDirection == "clockwise")
        precondition(named.doc.points == imported.points && named.doc.unit == imported.unit)
        precondition(named.doc.abDistance == imported.abDistance && named.doc.pointA == imported.pointA && named.doc.pointB == imported.pointB)
        precondition(PlotViewModel(saveURL: namedURL).doc.name == "North pool")
        named.undo()
        precondition(named.doc == reviewed)
        print("Import checks passed: parsing, triangle geometry, mirrored sides, offsets, validation, persistence, kept metadata, and undo")
    }
}
