import Foundation

/// The same portable JSON document used by the browser editor.
enum PlotJSON {
    static let maximumBytes = 5 * 1024 * 1024

    enum Invalid: LocalizedError {
        case document(String)
        var errorDescription: String? {
            if case .document(let message) = self { return message }
            return nil
        }
    }

    static func decode(_ data: Data) throws -> PlotDocument {
        guard data.count <= maximumBytes else {
            throw Invalid.document("Choose a plot JSON file smaller than 5 MB.")
        }
        let document: PlotDocument
        do { document = try JSONDecoder().decode(PlotDocument.self, from: data) }
        catch { throw Invalid.document("This is not an ABPlot JSON file. Export JSON from the website or app and try again.") }
        try validate(document)
        return document
    }

    static func encode(_ document: PlotDocument) throws -> Data {
        try validate(document)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(document)
        guard data.count <= maximumBytes else {
            throw Invalid.document("This plot exceeds the 5 MB file limit.")
        }
        return data
    }

    private static func validate(_ document: PlotDocument) throws {
        guard document.abDistance.isFinite, document.abDistance >= 0,
              document.abDistanceMeters.isFinite else {
            throw Invalid.document("The A–B distance must be a finite, non-negative number.")
        }
        let positions = [document.pointA, document.pointB] + document.points.map(\.position)
        guard positions.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else {
            throw Invalid.document("Every point must have finite coordinates.")
        }
        guard Set(document.points.map(\.id)).count == document.points.count else {
            throw Invalid.document("Some points have duplicate IDs. Export this plot again from the website.")
        }
    }
}
