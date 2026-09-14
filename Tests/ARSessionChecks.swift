import Foundation
import simd

@MainActor
private final class RecordingController: ARPlotControlling {
    var rotations: [Float] = []
    var resetCount = 0
    func commitReticle() {}
    func adjustB() {}
    func reset() { resetCount += 1 }
    func setYawOffset(_ radians: Float) { rotations.append(radians) }
}

@main
struct ARSessionChecks {
    @MainActor
    static func main() {
        let session = ARPlotSession()
        session.declaredSpanMeters = 3.048 // 10 feet
        session.reticleDistanceFromA = 1.524 // 5 feet
        session.phase = .waitingForB(worldA: .zero)
        session.displayUnit = .feet
        precondition(session.liveMeasurement == "5.00 ft · declared 10.00 ft (-50%)")
        session.phase = .placed(worldA: .zero, yaw: 0, tappedSpan: 1.524)
        precondition(session.instruction == "Placed · your span 5.00 ft vs declared 10.00 ft (-50%)")
        precondition(session.liveMeasurement == nil)

        session.displayUnit = .meters
        precondition(session.instruction == "Placed · your span 1.52 m vs declared 3.05 m (-50%)")
        session.phase = .waitingForB(worldA: .zero)
        precondition(session.liveMeasurement == "1.52 m · declared 3.05 m (-50%)")
        session.declaredSpanMeters = 0
        session.displayUnit = .feet
        precondition(session.liveMeasurement == "5.00 ft")
        session.reticleDistanceFromA = nil
        precondition(session.liveMeasurement == nil)

        let controller = RecordingController()
        session.controller = controller
        let placed = PlacementPhase.placed(worldA: SIMD3<Float>(1, 0, 2), yaw: 0.4, tappedSpan: 2)
        session.phase = placed
        session.setRotation(degrees: 90)
        precondition(abs(controller.rotations.last! - .pi / 2) < 1e-6)
        session.setRotation(degrees: 0)
        precondition(session.yawOffsetDegrees == 0 && controller.rotations.last == 0)
        precondition(controller.resetCount == 0 && session.phase == placed)
        session.setRotation(degrees: 999)
        precondition(session.yawOffsetDegrees == 180)
        session.setRotation(degrees: -999)
        precondition(session.yawOffsetDegrees == -180)
        let calls = controller.rotations.count
        session.setRotation(degrees: .nan)
        session.setRotation(degrees: .infinity)
        precondition(session.yawOffsetDegrees == -180 && controller.rotations.count == calls)
        print("AR session checks passed: units, discrepancy percentages, rotation reset, clamping, and non-finite input")
    }
}
