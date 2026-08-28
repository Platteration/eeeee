import Combine
import Foundation
import simd

enum PlacementPhase: Equatable {
    case searchingForPlane
    case waitingForA
    case waitingForB(worldA: SIMD3<Float>)
    case placed(worldA: SIMD3<Float>, yaw: Float, tappedSpan: Float)
}

@MainActor
final class ARPlotSession: ObservableObject {
    @Published var phase: PlacementPhase = .searchingForPlane
    @Published var hint: String?

    /// Declared A–B distance in meters, set by the AR screen for HUD text.
    var declaredSpanMeters: Double = 0

    /// Set by the AR coordinator; the Reset button calls it.
    var resetHandler: (() -> Void)?

    var instruction: String {
        switch phase {
        case .searchingForPlane:
            return "Move your phone to scan a flat surface"
        case .waitingForA:
            return "Tap the real-world location of point A"
        case .waitingForB:
            return "Now tap the real-world location of point B"
        case .placed(_, _, let tappedSpan):
            let declared = declaredSpanMeters
            guard declared > 0 else { return "Placed" }
            let deltaPercent = (Double(tappedSpan) - declared) / declared * 100
            return String(
                format: "Placed · tapped span %.2f m vs declared %.2f m (%+.0f%%)",
                tappedSpan, declared, deltaPercent
            )
        }
    }

    func showHint(_ message: String) {
        hint = message
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            if self?.hint == message {
                self?.hint = nil
            }
        }
    }
}
