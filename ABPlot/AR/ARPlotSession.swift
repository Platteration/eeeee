import Combine
import Foundation
import simd

enum PlacementPhase: Equatable {
    case searchingForPlane
    case waitingForA
    case waitingForB(worldA: SIMD3<Float>)
    case placed(worldA: SIMD3<Float>, yaw: Float, tappedSpan: Float)
}

/// Placement actions the AR coordinator performs on behalf of the HUD.
@MainActor
protocol ARPlotControlling: AnyObject {
    /// Commit whatever the aiming reticle is currently pointing at.
    func commitReticle()
    /// Keep A, re-aim B.
    func adjustB()
    /// Clear the placement entirely.
    func reset()
    /// Rotate the placed plot about A by an offset from its committed heading.
    func setYawOffset(_ radians: Float)
}

@MainActor
final class ARPlotSession: ObservableObject {
    @Published var phase: PlacementPhase = .searchingForPlane
    @Published var hint: String?

    /// Horizontal distance from the placed A to the current reticle, in meters,
    /// while aiming B. Quantized to centimeters by the coordinator so this only
    /// republishes when the readout would actually change.
    @Published var reticleDistanceFromA: Float?

    /// Whether the reticle currently has a surface under it.
    @Published var reticleIsTracking: Bool = false

    /// Rotation applied to the placed plot, in degrees from the heading you
    /// committed. Drives both the fine-rotation slider and the ±1° buttons.
    @Published private(set) var yawOffsetDegrees: Double = 0

    /// Declared A–B distance in meters, set by the AR screen for HUD text.
    @Published var declaredSpanMeters: Double = 0
    @Published var displayUnit: LengthUnit = .meters

    /// The AR coordinator. Weak: the coordinator owns the AR view, not this.
    weak var controller: (any ARPlotControlling)?

    var isPlaced: Bool {
        if case .placed = phase { return true }
        return false
    }

    /// True once a surface is available and we're aiming at A or B. Excludes the
    /// scanning phase so the HUD doesn't draw over the coaching overlay.
    var isAiming: Bool {
        switch phase {
        case .waitingForA, .waitingForB: return true
        case .searchingForPlane, .placed: return false
        }
    }

    var placeButtonTitle: String {
        if case .waitingForB = phase { return "Place B" }
        return "Place A"
    }

    var instruction: String {
        switch phase {
        case .searchingForPlane:
            return "Move your phone to scan a flat surface"
        case .waitingForA:
            return "Aim the crosshair at point A, then tap Place"
        case .waitingForB:
            return "Aim at point B — land on the ring for true scale"
        case .placed(_, _, let tappedSpan):
            guard declaredSpanMeters > 0 else { return "Placed" }
            let deltaPercent = (Double(tappedSpan) - declaredSpanMeters) / declaredSpanMeters * 100
            return "Placed · your span \(formattedDistance(Double(tappedSpan))) vs declared \(formattedDistance(declaredSpanMeters)) (\(String(format: "%+.0f%%", deltaPercent)))"
        }
    }

    /// Live distance readout shown while aiming B.
    var liveMeasurement: String? {
        guard case .waitingForB = phase, let distance = reticleDistanceFromA else { return nil }
        guard declaredSpanMeters > 0 else { return formattedDistance(Double(distance)) }
        let deltaPercent = (Double(distance) - declaredSpanMeters) / declaredSpanMeters * 100
        return "\(formattedDistance(Double(distance))) · declared \(formattedDistance(declaredSpanMeters)) (\(String(format: "%+.0f%%", deltaPercent)))"
    }

    private func formattedDistance(_ meters: Double) -> String {
        String(format: "%.2f %@", meters / displayUnit.toMeters, displayUnit.symbol)
    }

    /// Rotate the placed plot to `degrees` away from its committed heading.
    /// Named distinctly from the controller's radian-based `setYawOffset` so the
    /// two are never confused at a call site.
    func setRotation(degrees: Double) {
        guard degrees.isFinite else { return }
        let clamped = min(max(degrees, -180), 180)
        yawOffsetDegrees = clamped
        controller?.setYawOffset(Float(clamped) * .pi / 180)
    }

    /// Called by the coordinator when a fresh placement resets the heading.
    func clearYawOffset() {
        yawOffsetDegrees = 0
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
