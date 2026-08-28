import ARKit
import RealityKit
import SwiftUI

struct ARViewContainer: UIViewRepresentable {
    let document: PlotDocument
    @ObservedObject var session: ARPlotSession

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(frame: .zero)

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        arView.session.run(configuration)
        arView.session.delegate = context.coordinator
        context.coordinator.arView = arView

        let coaching = ARCoachingOverlayView()
        coaching.goal = .horizontalPlane
        coaching.session = arView.session
        coaching.delegate = context.coordinator
        coaching.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        coaching.frame = arView.bounds
        arView.addSubview(coaching)

        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        arView.addGestureRecognizer(tap)

        session.resetHandler = { [weak coordinator = context.coordinator] in
            coordinator?.reset()
        }

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(document: document, session: session)
    }

    @MainActor
    final class Coordinator: NSObject, ARSessionDelegate, ARCoachingOverlayViewDelegate {
        let document: PlotDocument
        let session: ARPlotSession
        weak var arView: ARView?

        private var plotAnchor: AnchorEntity?
        private var previewAnchorA: AnchorEntity?
        private var billboardTargets: [Entity] = []

        init(document: PlotDocument, session: ARPlotSession) {
            self.document = document
            self.session = session
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let arView else { return }
            let screenPoint = recognizer.location(in: arView)

            // Prefer real plane geometry; fall back to an estimated plane so
            // taps work before detection has fully mapped the surface.
            let result = arView.raycast(
                from: screenPoint, allowing: .existingPlaneGeometry, alignment: .horizontal
            ).first ?? arView.raycast(
                from: screenPoint, allowing: .estimatedPlane, alignment: .horizontal
            ).first

            guard let result else {
                session.showHint("No surface there — aim at the scanned plane")
                return
            }
            let column = result.worldTransform.columns.3
            let position = SIMD3<Float>(column.x, column.y, column.z)

            switch session.phase {
            case .searchingForPlane, .waitingForA:
                placePreviewA(at: position)
                session.phase = .waitingForB(worldA: position)
            case .waitingForB(let worldA):
                guard let (yaw, tappedSpan) = PlotMath.yawAndDistance(worldA: worldA, worldB: position) else {
                    session.showHint("Tap farther from A")
                    return
                }
                buildPlot(worldA: worldA, yaw: yaw)
                session.phase = .placed(worldA: worldA, yaw: yaw, tappedSpan: tappedSpan)
            case .placed:
                break
            }
        }

        private func placePreviewA(at worldA: SIMD3<Float>) {
            guard let arView else { return }
            let anchor = AnchorEntity(world: worldA)
            anchor.addChild(PlotEntityFactory.marker(color: .systemGreen))
            arView.scene.addAnchor(anchor)
            previewAnchorA = anchor
        }

        private func buildPlot(worldA: SIMD3<Float>, yaw: Float) {
            guard let arView else { return }

            if let previewAnchorA {
                arView.scene.removeAnchor(previewAnchorA)
                self.previewAnchorA = nil
            }
            billboardTargets.removeAll()

            let anchor = AnchorEntity(world: worldA)
            anchor.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])

            let abMeters = document.abDistanceMeters

            let (markerA, pivotA) = PlotEntityFactory.labeledMarker(text: "A", color: .systemGreen)
            markerA.position = [0, 0.005, 0]
            anchor.addChild(markerA)
            billboardTargets.append(pivotA)

            let (markerB, pivotB) = PlotEntityFactory.labeledMarker(text: "B", color: .systemRed)
            markerB.position = [Float(abMeters), 0.005, 0]
            anchor.addChild(markerB)
            billboardTargets.append(pivotB)

            for point in document.points {
                guard let (s, t) = PlotMath.abCoordinates(
                    of: point.position, a: document.pointA, b: document.pointB
                ) else { continue }
                let (marker, pivot) = PlotEntityFactory.labeledMarker(
                    text: point.label, color: .systemBlue
                )
                marker.position = PlotMath.localPosition(s: s, t: t, abMeters: abMeters)
                anchor.addChild(marker)
                billboardTargets.append(pivot)
            }

            arView.scene.addAnchor(anchor)
            plotAnchor = anchor
        }

        func reset() {
            guard let arView else { return }
            if let plotAnchor {
                arView.scene.removeAnchor(plotAnchor)
                self.plotAnchor = nil
            }
            if let previewAnchorA {
                arView.scene.removeAnchor(previewAnchorA)
                self.previewAnchorA = nil
            }
            billboardTargets.removeAll()
            session.phase = .waitingForA
        }

        // MARK: ARCoachingOverlayViewDelegate

        nonisolated func coachingOverlayViewDidDeactivate(_ coachingOverlayView: ARCoachingOverlayView) {
            Task { @MainActor in
                if self.session.phase == .searchingForPlane {
                    self.session.phase = .waitingForA
                }
            }
        }

        // MARK: ARSessionDelegate

        nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
            let cameraColumn = frame.camera.transform.columns.3
            let cam = SIMD3<Float>(cameraColumn.x, cameraColumn.y, cameraColumn.z)
            Task { @MainActor in
                for pivot in self.billboardTargets {
                    let p = pivot.position(relativeTo: nil)
                    // Yaw-only billboard keeping the text upright: look(at:)
                    // aims the entity's −Z at the target, but generateText
                    // faces +Z, so aim −Z AWAY from the camera. If labels
                    // render mirrored on device, change the target to the
                    // camera position — a single-line flip.
                    pivot.look(
                        at: [2 * p.x - cam.x, p.y, 2 * p.z - cam.z],
                        from: p,
                        relativeTo: nil
                    )
                }
            }
        }
    }
}
