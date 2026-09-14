import Foundation
import CoreGraphics

/// Run against the production model on macOS without an iPhone or signing team.
@main
struct HistoryChecks {
    @MainActor
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ABPlot-history-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("plot.json")
        let model = PlotViewModel(saveURL: url)
        let initial = model.doc
        precondition(!model.canUndo && !model.canRedo)

        model.addPoint(at: CGPoint(x: 150, y: 200))
        let first = model.doc
        let id = first.points[0].id
        model.undo()
        precondition(model.doc == initial && model.canRedo)
        model.redo()
        precondition(model.doc == first && !model.canRedo)

        // Many drag updates must undo in a single step.
        model.movePoint(id: id, to: CGPoint(x: 170, y: 210))
        model.movePoint(id: id, to: CGPoint(x: 190, y: 220))
        model.endDrag()
        let moved = model.doc
        model.undo()
        precondition(model.doc == first)
        model.redo()
        precondition(model.doc == moved)

        // A gesture with no change must preserve the redo stack.
        model.undo()
        model.movePoint(id: id, to: first.points[0].position)
        model.endDrag()
        precondition(model.canRedo)
        model.redo()

        model.moveA(to: CGPoint(x: 20, y: 30))
        model.moveA(to: CGPoint(x: 40, y: 50))
        model.endDrag()
        model.undo()
        precondition(model.doc == moved)
        model.moveB(to: CGPoint(x: 80, y: 90))
        model.endDrag()
        precondition(!model.canRedo)
        model.undo()
        precondition(model.doc == moved)

        model.selectedPointID = id
        model.deleteSelectedPoint()
        precondition(model.doc.points.isEmpty)
        model.undo()
        precondition(model.doc == moved && model.selectedPointID == nil)

        model.clearAllPoints()
        model.undo()
        precondition(model.doc == moved)
        model.addPoint(at: .zero)
        precondition(model.doc.points.map(\.label) == ["1", "2"])
        precondition(!model.canRedo)

        let beforeUnits = model.doc
        model.setUnit(.feet)
        precondition(abs(model.doc.abDistanceMeters - beforeUnits.abDistanceMeters) < 1e-10)
        model.undo()
        precondition(model.doc == beforeUnits)
        model.redo()
        precondition(model.doc.unit == .feet)
        model.setDistance(12)
        model.undo()
        precondition(abs(model.doc.abDistanceMeters - beforeUnits.abDistanceMeters) < 1e-10)
        model.setDistance(.infinity)
        precondition(model.canRedo)

        // Restoring history must update autosave; relaunch starts fresh history.
        let reloaded = PlotViewModel(saveURL: url)
        precondition(reloaded.doc == model.doc)
        precondition(!reloaded.canUndo && !reloaded.canRedo)

        let bounded = PlotViewModel(saveURL: directory.appendingPathComponent("bounded.json"))
        for value in 3...107 { bounded.setDistance(Double(value)) }
        var undoCount = 0
        while bounded.canUndo { bounded.undo(); undoCount += 1 }
        precondition(undoCount == 100 && bounded.doc.abDistance == 7)
        var redoCount = 0
        while bounded.canRedo { bounded.redo(); redoCount += 1 }
        precondition(redoCount == 100 && bounded.doc.abDistance == 107)

        let fitting = PlotViewModel(saveURL: directory.appendingPathComponent("fit.json"))
        fitting.moveA(to: CGPoint(x: -400, y: 800))
        fitting.moveB(to: CGPoint(x: 100, y: 1200))
        fitting.endDrag()
        fitting.addPoint(at: CGPoint(x: 1200, y: -300))
        fitting.addPoint(at: CGPoint(x: -600, y: 1500))
        let beforeFit = fitting.doc
        let coordinates = beforeFit.points.map {
            PlotMath.abCoordinates(of: $0.position, a: beforeFit.pointA, b: beforeFit.pointB)!
        }
        fitting.fitPlot(in: CGSize(width: 320, height: 240))
        let afterFit = fitting.doc
        for point in [afterFit.pointA, afterFit.pointB] + afterFit.points.map(\.position) {
            precondition(point.x >= 28 - 1e-10 && point.x <= 292 + 1e-10)
            precondition(point.y >= 28 - 1e-10 && point.y <= 212 + 1e-10)
        }
        precondition(afterFit.abDistanceMeters == beforeFit.abDistanceMeters)
        precondition(afterFit.points.map(\.id) == beforeFit.points.map(\.id))
        for (index, point) in afterFit.points.enumerated() {
            let result = PlotMath.abCoordinates(of: point.position, a: afterFit.pointA, b: afterFit.pointB)!
            precondition(abs(result.s - coordinates[index].s) < 1e-10)
            precondition(abs(result.t - coordinates[index].t) < 1e-10)
        }
        // A repeated fit must not consume an undo step.
        fitting.fitPlot(in: CGSize(width: 320, height: 240))
        fitting.undo()
        precondition(fitting.doc == beforeFit)
        fitting.redo()
        precondition(fitting.doc == afterFit)
        precondition(PlotViewModel(saveURL: directory.appendingPathComponent("fit.json")).doc == afterFit)
        fitting.fitPlot(in: .zero)
        fitting.fitPlot(in: CGSize(width: 40, height: 40))
        precondition(fitting.doc == afterFit)

        // Horizontal, vertical, and coincident plots must remain finite.
        let degenerate = PlotViewModel(saveURL: directory.appendingPathComponent("line.json"))
        degenerate.fitPlot(in: CGSize(width: 320, height: 240))
        precondition(degenerate.doc.pointA.y == 120 && degenerate.doc.pointB.y == 120)
        degenerate.moveA(to: CGPoint(x: 0, y: -500))
        degenerate.moveB(to: CGPoint(x: 0, y: 500))
        degenerate.endDrag()
        degenerate.fitPlot(in: CGSize(width: 320, height: 240))
        precondition(degenerate.doc.pointA.x == 160 && degenerate.doc.pointB.x == 160)
        degenerate.moveA(to: .zero)
        degenerate.moveB(to: .zero)
        degenerate.endDrag()
        degenerate.fitPlot(in: CGSize(width: 320, height: 240))
        precondition(degenerate.doc.pointA == CGPoint(x: 160, y: 120))
        precondition(degenerate.doc.pointB == degenerate.doc.pointA)
        var exported = PlotDocument(
            pointA: CGPoint(x: 100, y: 300), pointB: CGPoint(x: 300, y: 300),
            abDistance: 4, unit: .meters,
            points: [PlotPoint(id: UUID(), position: CGPoint(x: 200, y: 200), label: "1")]
        )
        let csv = try PlotCSV.string(for: exported)
        let rows = csv.components(separatedBy: "\r\n")
        precondition(rows.count == 5 && rows.last == "")
        precondition(rows[1] == "\"A\",0,0,0,4.0,\"m\"")
        precondition(rows[2] == "\"B\",4.0,0,4.0,0,\"m\"")
        let pointColumns = rows[3].components(separatedBy: ",")
        precondition(pointColumns[1] == "2.0" && pointColumns[2] == "-2.0")
        precondition(abs(Double(pointColumns[3])! - sqrt(8)) < 1e-10)
        precondition(abs(Double(pointColumns[4])! - sqrt(8)) < 1e-10)
        exported.unit = .feet
        exported.abDistance = 4 / LengthUnit.feet.toMeters
        let feetColumns = try PlotCSV.string(for: exported).components(separatedBy: "\r\n")[3]
            .components(separatedBy: ",")
        precondition(abs(Double(feetColumns[1])! * LengthUnit.feet.toMeters - 2) < 1e-10)
        precondition(feetColumns[5] == "\"ft\"")
        exported.points[0].label = "Point, \"north\"\nline"
        let escapedCSV = try PlotCSV.string(for: exported)
        precondition(escapedCSV.contains("\"Point, \"\"north\"\"\nline\""))

        // Invalid geometry or distance must fail rather than export NaN values.
        exported.abDistance = 0
        do {
            _ = try PlotCSV.string(for: exported)
            preconditionFailure("Zero distance was exported")
        } catch PlotCSV.ExportError.invalidDistance {}
        exported.abDistance = 4
        exported.pointB = exported.pointA
        do {
            _ = try PlotCSV.string(for: exported)
            preconditionFailure("Coincident baseline was exported")
        } catch PlotCSV.ExportError.invalidGeometry {}
        exported.pointB = CGPoint(x: 300, y: 300)
        exported.points[0].position.x = .infinity
        do {
            _ = try PlotCSV.string(for: exported)
            preconditionFailure("Non-finite coordinate was exported")
        } catch PlotCSV.ExportError.invalidGeometry {}
        print("Editor checks passed: history, fit geometry, CSV coordinates, units, escaping, and invalid export inputs")
    }
}
