import CoreGraphics
import Foundation

enum LengthUnit: String, Codable, CaseIterable, Identifiable {
    case meters
    case feet

    var id: String { rawValue }

    var toMeters: Double {
        switch self {
        case .meters: return 1.0
        case .feet: return 0.3048
        }
    }

    var symbol: String {
        switch self {
        case .meters: return "m"
        case .feet: return "ft"
        }
    }
}

struct PlotPoint: Identifiable, Codable, Equatable {
    let id: UUID
    var position: CGPoint
    var label: String
}

struct PlotDocument: Codable, Equatable {
    /// Reference points in canvas coordinates (SwiftUI points, y grows down).
    var pointA: CGPoint
    var pointB: CGPoint
    /// Real-world distance between A and B, expressed in `unit`.
    var abDistance: Double
    var unit: LengthUnit
    var points: [PlotPoint]

    var abDistanceMeters: Double { abDistance * unit.toMeters }

    static let `default` = PlotDocument(
        pointA: CGPoint(x: 100, y: 400),
        pointB: CGPoint(x: 300, y: 400),
        abDistance: 2.0,
        unit: .meters,
        points: []
    )
}
