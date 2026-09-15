import Foundation
import CoreGraphics

enum MeasurementImport {
    enum Mode: String, CaseIterable, Identifiable {
        case distances = "Distances from A/B"
        case offsets = "Baseline offsets"
        var id: String { rawValue }
    }

    struct Row: Identifiable, Equatable {
        let line: Int
        let label: String
        let first: Double
        let second: Double
        var id: Int { line }
    }

    struct Parsed {
        var rows: [Row] = []
        var errors: [String] = []
    }

    enum ImportError: LocalizedError {
        case invalid(String)
        var errorDescription: String? {
            if case .invalid(let message) = self { return message }
            return nil
        }
    }

    /// Each nonblank line must be an explicit label + two numbers. Never
    /// silently repair digits or discard unrecognized lines from an OCR scan.
    static func parse(_ text: String) -> Parsed {
        var result = Parsed()
        guard text.count <= 100_000 else {
            result.errors = ["The text is too long. Import a table of up to 500 points."]
            return result
        }
        var labels = Set<String>()
        for (index, raw) in text.components(separatedBy: .newlines).enumerated() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            guard result.rows.count < 500 else {
                result.errors.append("Import up to 500 points at a time.")
                break
            }
            let fields: [String]
            if line.contains(";") {
                fields = line.components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }
            } else {
                let spaced = line.split(whereSeparator: { $0.isWhitespace }).map(String.init)
                if spaced.count == 3, number(spaced[1]) != nil, number(spaced[2]) != nil {
                    fields = spaced
                } else {
                    fields = line.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                }
            }
            guard fields.count == 3,
                  let first = number(fields[1]), let second = number(fields[2]),
                  !fields[0].isEmpty, fields[0].count <= 40 else {
                result.errors.append("Line \(index + 1): use a label followed by two numbers. Remove headings and notes.")
                continue
            }
            let label = fields[0]
            if let numericLabel = Int(label), numericLabel > 999_999 {
                result.errors.append("Line \(index + 1): use a numeric label below 1,000,000 or a name such as P1.")
                continue
            }
            guard !["A", "B"].contains(label.uppercased()), labels.insert(label.lowercased()).inserted else {
                result.errors.append("Line \(index + 1): labels must be unique and cannot be A or B.")
                continue
            }
            result.rows.append(Row(line: index + 1, label: label, first: first, second: second))
        }
        return result
    }

    static func number(_ text: String) -> Double? {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value.isFinite else { return nil }
        return value
    }

    /// Returns normalized canvas coordinates: A=(0,0), B=(1,0).
    static func coordinates(for row: Row, baseline: Double, mode: Mode, below: Bool) throws -> CGPoint {
        guard baseline.isFinite, baseline > 0, row.first.isFinite, row.second.isFinite else {
            throw ImportError.invalid("Enter a positive baseline and finite measurements.")
        }
        let s: Double
        let t: Double
        switch mode {
        case .offsets:
            s = row.first / baseline
            t = row.second / baseline
        case .distances:
            guard row.first >= 0, row.second >= 0 else {
                throw ImportError.invalid("\(row.label): distances cannot be negative.")
            }
            let a = row.first / baseline
            let b = row.second / baseline
            guard a.isFinite, b.isFinite, a + b >= 1 - 1e-12, abs(a - b) <= 1 + 1e-12 else {
                throw ImportError.invalid("\(row.label): these distances cannot meet with the chosen A–B baseline.")
            }
            s = (a * a - b * b + 1) / 2
            let heightSquared = a * a - s * s
            guard heightSquared >= -1e-10 else {
                throw ImportError.invalid("\(row.label): check the two distances and baseline.")
            }
            t = sqrt(max(0, heightSquared)) * (below ? 1 : -1)
        }
        guard s.isFinite, t.isFinite, abs(s) <= 1e6, abs(t) <= 1e6 else {
            throw ImportError.invalid("\(row.label): measurements are too large relative to the baseline.")
        }
        return CGPoint(x: s, y: t)
    }

    static func document(text: String, baseline: Double, unit: LengthUnit, mode: Mode,
                         belowLabels: Set<String>, canvasSize: CGSize) throws -> PlotDocument {
        let parsed = parse(text)
        guard parsed.errors.isEmpty, !parsed.rows.isEmpty else {
            throw ImportError.invalid(parsed.errors.first ?? "Add at least one measurement row.")
        }
        guard baseline.isFinite, baseline > 0, Float(baseline * unit.toMeters).isFinite,
              Float(baseline * unit.toMeters) > 0 else {
            throw ImportError.invalid("Enter a positive A–B distance in the selected unit.")
        }
        let points = try parsed.rows.map { row in
            PlotPoint(id: UUID(), position: try coordinates(for: row, baseline: baseline, mode: mode,
                                                          below: belowLabels.contains(row.label)), label: row.label)
        }
        // Fit the normalized geometry with one transform, never clamping points
        // individually (that would change the imported measurements).
        let all = [CGPoint.zero, CGPoint(x: 1, y: 0)] + points.map(\.position)
        let minX = all.map(\.x).min()!, maxX = all.map(\.x).max()!
        let minY = all.map(\.y).min()!, maxY = all.map(\.y).max()!
        let width = canvasSize.width.isFinite ? max(120, canvasSize.width) : 320
        let height = canvasSize.height.isFinite ? max(120, canvasSize.height) : 400
        let scale = min((width - 56) / (maxX - minX), (height - 56) / max(maxY - minY, 1e-9))
        guard scale > PlotMath.minCanvasABDistance else {
            throw ImportError.invalid("The points are too spread out to fit a usable A–B baseline. Check the measurements.")
        }
        func fitted(_ p: CGPoint) -> CGPoint {
            CGPoint(x: (p.x - (minX + maxX) / 2) * scale + width / 2,
                    y: (p.y - (minY + maxY) / 2) * scale + height / 2)
        }
        return PlotDocument(pointA: fitted(.zero), pointB: fitted(CGPoint(x: 1, y: 0)),
                            abDistance: baseline, unit: unit,
                            points: points.map { PlotPoint(id: $0.id, position: fitted($0.position), label: $0.label) })
    }
}
