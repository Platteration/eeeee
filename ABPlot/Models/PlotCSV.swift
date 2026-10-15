import Foundation

enum PlotCSV {
    enum ExportError: LocalizedError {
        case invalidDistance, invalidGeometry

        var errorDescription: String? {
            switch self {
            case .invalidDistance:
                return "Enter a positive, finite A–B distance before exporting."
            case .invalidGeometry:
                return "Separate A and B and make sure all points have valid coordinates before exporting."
            }
        }
    }

    /// Coordinates use the declared unit, with A at the origin and B on +X.
    /// Positive perpendicular values are on the canvas-down side of A→B.
    static func string(for document: PlotDocument) throws -> String {
        guard document.abDistance.isFinite, document.abDistance > 0 else {
            throw ExportError.invalidDistance
        }
        let locations = [("A", document.pointA), ("B", document.pointB)]
            + document.points.map { ($0.label, $0.position) }
        guard locations.allSatisfy({ $0.1.x.isFinite && $0.1.y.isFinite }) else {
            throw ExportError.invalidGeometry
        }
        var rows = ["label,along_ab,perpendicular_screen_down,distance_from_a,distance_from_b,unit"]
        for (label, position) in locations {
            guard let coordinate = PlotMath.abCoordinates(
                of: position, a: document.pointA, b: document.pointB
            ) else { throw ExportError.invalidGeometry }
            let along = coordinate.s * document.abDistance
            let perpendicular = coordinate.t * document.abDistance
            let values = [along, perpendicular, hypot(along, perpendicular),
                          hypot(along - document.abDistance, perpendicular)]
            guard values.allSatisfy(\.isFinite) else { throw ExportError.invalidGeometry }
            // Double's string representation is locale-independent and retains
            // small measurements without rounding them to zero.
            let numbers = values.map { $0 == 0 ? "0" : String($0) }
            rows.append(([quoted(label)] + numbers + [quoted(document.unit.symbol)]).joined(separator: ","))
        }
        return rows.joined(separator: "\r\n") + "\r\n"
    }

    private static func quoted(_ text: String) -> String {
        "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
