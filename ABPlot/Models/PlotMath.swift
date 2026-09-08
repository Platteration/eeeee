import CoreGraphics
import Foundation
import simd

/// Pure coordinate math mapping the 2D canvas plot onto the real world.
///
/// ## Canvas → normalized AB frame
/// Canvas coordinates are SwiftUI view points where y grows *down*. For a
/// canvas point `p` relative to reference points `a` and `b`:
///
///     d = p − a;  Δ = b − a;  L² = Δ.x² + Δ.y²
///     s = (d.x·Δ.x + d.y·Δ.y) / L²        // fraction along A→B (A = 0, B = 1)
///     t = (d.x·(−Δ.y) + d.y·Δ.x) / L²     // perpendicular fraction; + = screen-down side of A→B
///
/// `(s, t)` is dimensionless (units of AB-lengths), so it is invariant under
/// canvas pan, rotation and resize — only geometry relative to A/B matters.
///
/// ## AB frame → AR world
/// Given raycast hits `worldA` and `worldB` on a horizontal plane and the
/// declared A–B distance `D` in meters:
///
/// 1. Flatten B to A's height (`worldB.y = worldA.y`) — every ARKit
///    horizontal plane has world-up as its normal.
/// 2. Basis: X̂ = normalize(worldB − worldA), Ŷ = (0,1,0), Ẑ = X̂ × Ŷ.
/// 3. World position of a plot point: `worldA + (s·D)·X̂ + (t·D)·Ẑ`.
///
/// Mapping canvas-down (+t) to +Ẑ is what keeps the plot un-mirrored: looking
/// straight down at the floor with A on the left and B on the right, you see
/// exactly the canvas as drawn.
///
/// In RealityKit this is realized as a single anchor at `worldA` rotated by
/// `yaw = atan2(−(worldB.z − worldA.z), worldB.x − worldA.x)` about +Y, with
/// each point as a child at local `(s·D, 0, t·D)` — rotation about +Y by yaw
/// maps local +X → X̂ and local +Z → Ẑ.
///
/// ## Scale choice
/// The *declared* distance D sets the scale; the tapped B fixes direction
/// only. This keeps every real-world dimension true even when the taps are
/// imprecise — the rendered B landing off the tapped B spot is feedback about
/// placement/measurement error (the HUD reports the discrepancy). To instead
/// scale the plot so B lands exactly where tapped, replace D with the tapped
/// span returned by `yawAndDistance`.
///
/// ## Worked example
/// Canvas A=(100,300), B=(300,300), P=(200,200) (above the baseline), D=4 m:
/// Δ=(200,0), L²=40000, d=(100,−100) ⇒ s=0.5, t=−0.5 ⇒ local=(2, 0, −2).
/// Tapped worldA=(1,0,−2), worldB=(1,0,−5) ⇒ X̂=(0,0,−1), yaw=atan2(3,0)=π/2.
/// P_world = (1,0,−2) + rotY(π/2)·(2,0,−2) = (−1,0,−4).
/// B_world = (1,0,−2) + rotY(π/2)·(4,0,0) = (1,0,−6) — 1 m past the tapped B,
/// because the tapped span (3 m) is less than the declared distance (4 m).
enum PlotMath {
    /// Minimum canvas A–B separation (in points) for the frame to be defined.
    static let minCanvasABDistance: CGFloat = 1.0
    /// Minimum horizontal separation (meters) between the tapped A and B.
    static let minWorldABDistance: Float = 0.05

    /// Normalized (s, t) coordinates of `p` in the frame defined by canvas
    /// points `a` and `b`. Returns nil when A and B are (nearly) coincident.
    static func abCoordinates(of p: CGPoint, a: CGPoint, b: CGPoint) -> (s: Double, t: Double)? {
        let dx = Double(p.x - a.x)
        let dy = Double(p.y - a.y)
        let ux = Double(b.x - a.x)
        let uy = Double(b.y - a.y)
        let lengthSquared = ux * ux + uy * uy
        guard lengthSquared > Double(minCanvasABDistance * minCanvasABDistance) else { return nil }
        let s = (dx * ux + dy * uy) / lengthSquared
        let t = (dx * -uy + dy * ux) / lengthSquared
        return (s, t)
    }

    /// Yaw (rotation about +Y mapping local +X to the `start`→`end` direction)
    /// and the horizontal distance between them, both unconditional.
    ///
    /// Used for preview geometry, which must stay well-defined at any length —
    /// including zero, where the yaw is arbitrary but harmless.
    static func horizontalYawAndSpan(
        from start: SIMD3<Float>, to end: SIMD3<Float>
    ) -> (yaw: Float, span: Float) {
        let dx = end.x - start.x
        let dz = end.z - start.z
        return (atan2(-dz, dx), (dx * dx + dz * dz).squareRoot())
    }

    /// Yaw and horizontal span for *committing* a placement: nil when the two
    /// points are too close together to define a trustworthy direction.
    static func yawAndDistance(worldA: SIMD3<Float>, worldB: SIMD3<Float>) -> (yaw: Float, tappedSpan: Float)? {
        let (yaw, span) = horizontalYawAndSpan(from: worldA, to: worldB)
        guard span >= minWorldABDistance else { return nil }
        return (yaw, span)
    }

    /// Local position of a plot point under the yawed anchor at world A.
    /// Raised 5 mm so markers don't z-fight with the detected plane.
    static func localPosition(s: Double, t: Double, abMeters: Double) -> SIMD3<Float> {
        SIMD3<Float>(Float(s * abMeters), 0.005, Float(t * abMeters))
    }
}
