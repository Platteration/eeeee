import Foundation
import CoreGraphics

@main
struct JSONChecks {
    @MainActor
    static func main() throws {
        // This fixture uses the browser's actual wire format.
        let web = Data(#"{"name":"North lawn","pointA":[100,400],"pointB":[300,400],"abDistance":10,"unit":"feet","points":[{"id":"8F3B0C1E-1111-4222-8333-444455556666","position":[200,300],"label":"9223372036854775807"}]}"#.utf8)
        let doc = try PlotJSON.decode(web)
        precondition(doc.name == "North lawn" && doc.unit == .feet && doc.points.count == 1)
        var review = doc
        review.points[0].note = "Remeasure near steps"
        review.points[0].needsRemeasure = true
        review.baselineNote = "Check tape sag"
        review.baselineNeedsRemeasure = true
        review.outlineDirection = "clockwise"
        let reviewedRoundTrip = try PlotJSON.decode(PlotJSON.encode(review))
        precondition(reviewedRoundTrip == review)
        let roundTrip = try PlotJSON.decode(PlotJSON.encode(doc))
        precondition(roundTrip == doc)
        let legacy = try PlotJSON.decode(PlotJSON.encode(.default))
        precondition(legacy.name == nil)
        for bad in [Data("not json".utf8), Data(repeating: 0, count: PlotJSON.maximumBytes + 1)] {
            do { _ = try PlotJSON.decode(bad); preconditionFailure("Invalid file accepted") }
            catch PlotJSON.Invalid.document {}
        }
        var duplicate = doc
        duplicate.points.append(doc.points[0])
        do { _ = try PlotJSON.encode(duplicate); preconditionFailure("Duplicate IDs accepted") }
        catch PlotJSON.Invalid.document {}
        var negative = doc
        negative.abDistance = -1
        do { _ = try PlotJSON.encode(negative); preconditionFailure("Negative distance accepted") }
        catch PlotJSON.Invalid.document {}

        var extreme = doc
        extreme.points[0].position.x = CGFloat.greatestFiniteMagnitude
        do { _ = try PlotJSON.encode(extreme); preconditionFailure("Overflowing geometry accepted") }
        catch PlotJSON.Invalid.document {}

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("plot.json")
        let model = PlotViewModel(saveURL: url)
        model.setName("Original")
        let original = model.doc
        model.importMeasurements(doc)
        model.undo()
        precondition(model.doc == original)
        model.redo()
        precondition(model.doc == doc)
        model.addPoint(at: .zero) // A maximum integer label must never overflow.
        precondition(model.doc.points.last?.label == "1")
        let reopened = PlotViewModel(saveURL: url)
        precondition(reopened.doc.name == "North lawn" && reopened.doc.points.count == 2)
        let corruptURL = directory.appendingPathComponent("unreadable.json")
        let corrupt = Data("{broken previous plot".utf8)
        try corrupt.write(to: corruptURL)
        let recovery = PlotViewModel(saveURL: corruptURL)
        precondition(recovery.recoveryRequired && recovery.saveError != nil)
        recovery.addPoint(at: CGPoint(x: 120, y: 130))
        recovery.retrySaving()
        let untouched = try Data(contentsOf: corruptURL)
        precondition(untouched == corrupt)
        recovery.preserveRecoveryAndSave()
        precondition(!recovery.recoveryRequired && recovery.saveError == nil)
        let backup = directory.appendingPathComponent(recovery.recoveryFileName!)
        let recoveredBytes = try Data(contentsOf: backup)
        precondition(recoveredBytes == corrupt)
        let current = try PlotJSON.decode(Data(contentsOf: corruptURL))
        precondition(current == recovery.doc)

        // If no recovery copy can be read, saving must remain blocked.
        let unreadable = directory.appendingPathComponent("directory-not-file")
        try FileManager.default.createDirectory(at: unreadable, withIntermediateDirectories: true)
        let blocked = PlotViewModel(saveURL: unreadable)
        blocked.addPoint(at: .zero)
        blocked.preserveRecoveryAndSave()
        precondition(blocked.recoveryRequired && blocked.saveError != nil)
        let unchangedDistance = model.doc.abDistance
        model.setDistance(-1)
        precondition(model.doc.abDistance == unchangedDistance)
        print("JSON exchange, validation, names, import history, and label checks passed")
    }
}
