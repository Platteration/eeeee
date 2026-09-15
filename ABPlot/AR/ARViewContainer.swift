import ARKit
import Combine
import RealityKit
import SwiftUI
import UIKit
import simd

struct ARViewContainer: UIViewRepresentable {
    let document: PlotDocument
    @ObservedObject var session: ARPlotSession

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(frame: .zero)

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        arView.session.run(configuration)

        context.coordinator.attach(to: arView)
        session.controller = context.coordinator

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(document: document, session: session)
    }

    static func dismantleUIView(_ uiView: ARView, coordinator: Coordinator) {
        coordinator.detach()
        uiView.session.pause()
    }

    @MainActor
    final class Coordinator: NSObject, ARCoachingOverlayViewDelegate, ARPlotControlling {
        private let document: PlotDocument
        private let session: ARPlotSession
        private weak var arView: ARView?

        private var updateSubscription: (any Cancellable)?

        /// Preview geometry hangs off a single world-origin anchor, so every
        /// child position below is simply a world coordinate.
        private let previewAnchor = AnchorEntity(world: SIMD3<Float>(repeating: 0))
        private let reticle = PlotEntityFactory.reticle(color: .systemYellow)
        private let previewLine = PlotEntityFactory.unitLine(color: .systemYellow)
        private var previewMarkerA: Entity?
        private var targetRing: Entity?

        private var plotAnchor: AnchorEntity?
        private var billboardTargets: [Entity] = []
        private var reticleWorldPosition: SIMD3<Float>?
        /// Heading committed when B was placed; rotation offsets apply on top.
        private var committedYaw: Float = 0

        init(document: PlotDocument, session: ARPlotSession) {
            self.document = document
            self.session = session
        }

        // MARK: Setup / teardown

        func attach(to arView: ARView) {
            self.arView = arView

            let coaching = ARCoachingOverlayView()
            coaching.goal = .horizontalPlane
            coaching.session = arView.session
            coaching.delegate = self
            // Auto Layout rather than an autoresizing mask: the ARView starts at
            // .zero and is sized by SwiftUI later, which an autoresizing mask
            // handles far less predictably.
            coaching.translatesAutoresizingMaskIntoConstraints = false
            arView.addSubview(coaching)
            NSLayoutConstraint.activate([
                coaching.leadingAnchor.constraint(equalTo: arView.leadingAnchor),
                coaching.trailingAnchor.constraint(equalTo: arView.trailingAnchor),
                coaching.topAnchor.constraint(equalTo: arView.topAnchor),
                coaching.bottomAnchor.constraint(equalTo: arView.bottomAnchor),
            ])

            reticle.isEnabled = false
            previewLine.isEnabled = false
            previewAnchor.addChild(reticle)
            previewAnchor.addChild(previewLine)
            arView.scene.addAnchor(previewAnchor)

            let tap = UITapGestureRecognizer(
                target: self, action: #selector(Coordinator.handleTap(_:))
            )
            arView.addGestureRecognizer(tap)

            // One main-thread callback per rendered frame, replacing a
            // per-ARFrame Task hop. The subscription must be retained or it is
            // cancelled immediately.
            //
            // The closure is non-Sendable and formed in a @MainActor method, so
            // it inherits main-actor isolation and can call `onFrame` directly.
            // If a future SDK marks this handler @Sendable and the compiler
            // objects, wrap the body in `MainActor.assumeIsolated { ... }`.
            updateSubscription = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] _ in
                self?.onFrame()
            }
        }

        func detach() {
            updateSubscription = nil
        }

        // MARK: Per-frame

        private func onFrame() {
            updateReticle()
            billboardLabels()
        }

        private func raycastToPlane(from point: CGPoint) -> SIMD3<Float>? {
            guard let arView else { return nil }
            let hit = arView.raycast(
                from: point, allowing: .existingPlaneGeometry, alignment: .horizontal
            ).first ?? arView.raycast(
                from: point, allowing: .estimatedPlane, alignment: .horizontal
            ).first
            guard let hit else { return nil }
            let column = hit.worldTransform.columns.3
            return SIMD3<Float>(column.x, column.y, column.z)
        }

        private func updateReticle() {
            guard let arView, !session.isPlaced else {
                reticle.isEnabled = false
                previewLine.isEnabled = false
                return
            }

            // UIView.center is expressed in the SUPERVIEW's coordinate space;
            // raycasting needs a point in the ARView's own space.
            let screenCentre = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)

            guard let hit = raycastToPlane(from: screenCentre) else {
                reticleWorldPosition = nil
                reticle.isEnabled = false
                previewLine.isEnabled = false
                setTracking(false)
                setLiveDistance(nil)
                return
            }

            // A hit means a usable surface exists, so leave the scanning phase
            // here too rather than depending solely on the coaching overlay's
            // callback — which doesn't always fire on every device.
            if session.phase == .searchingForPlane {
                session.phase = .waitingForA
            }

            reticleWorldPosition = hit
            reticle.isEnabled = true
            reticle.position = hit
            setTracking(true)

            if case .waitingForB(let worldA) = session.phase {
                previewLine.isEnabled = true
                PlotEntityFactory.updateLine(previewLine, from: worldA, to: hit)
                setLiveDistance(PlotMath.horizontalYawAndSpan(from: worldA, to: hit).span)
            } else {
                previewLine.isEnabled = false
                setLiveDistance(nil)
            }
        }

        private func billboardLabels() {
            guard let arView, !billboardTargets.isEmpty else { return }
            // Read the camera straight from the current ARFrame (never retain
            // the frame itself) rather than a RealityKit convenience property.
            guard let camera = arView.session.currentFrame?.camera else { return }
            let cameraColumn = camera.transform.columns.3
            let cam = SIMD3<Float>(cameraColumn.x, cameraColumn.y, cameraColumn.z)
            for pivot in billboardTargets {
                let p = pivot.position(relativeTo: nil)
                // Yaw-only billboard keeping the text upright: look(at:) aims the
                // entity's −Z at the target, but generateText faces +Z, so aim −Z
                // AWAY from the camera. If labels render mirrored on device,
                // change the target to the camera position — a one-line flip.
                pivot.look(
                    at: [2 * p.x - cam.x, p.y, 2 * p.z - cam.z],
                    from: p,
                    relativeTo: nil
                )
            }
        }

        /// These publish into SwiftUI, so only write when the value actually
        /// changes — this runs every frame.
        private func setTracking(_ tracking: Bool) {
            if session.reticleIsTracking != tracking {
                session.reticleIsTracking = tracking
            }
        }

        private func setLiveDistance(_ meters: Float?) {
            // Quantize to centimeters so the readout doesn't republish at 60 Hz.
            let quantized = meters.map { ($0 * 100).rounded() / 100 }
            if session.reticleDistanceFromA != quantized {
                session.reticleDistanceFromA = quantized
            }
        }

        // MARK: ARPlotControlling

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            commitReticle()
        }

        func commitReticle() {
            guard let hit = reticleWorldPosition else {
                session.showHint("No surface there — aim at the scanned plane")
                return
            }

            switch session.phase {
            case .searchingForPlane, .waitingForA:
                showPreviewA(at: hit)
                session.phase = .waitingForB(worldA: hit)

            case .waitingForB(let worldA):
                guard let (yaw, span) = PlotMath.yawAndDistance(worldA: worldA, worldB: hit) else {
                    session.showHint("Aim farther from A")
                    return
                }
                committedYaw = yaw
                session.clearYawOffset()
                buildPlot(worldA: worldA, yaw: yaw)
                clearPreviewGeometry()
                setLiveDistance(nil)
                session.phase = .placed(worldA: worldA, yaw: yaw, tappedSpan: span)

            case .placed:
                break
            }
        }

        func adjustB() {
            guard case .placed(let worldA, _, _) = session.phase else { return }
            removePlot()
            session.clearYawOffset()
            showPreviewA(at: worldA)
            session.phase = .waitingForB(worldA: worldA)
        }

        func reset() {
            removePlot()
            clearPreviewGeometry()
            setLiveDistance(nil)
            session.clearYawOffset()
            session.phase = .waitingForA
        }

        func setYawOffset(_ radians: Float) {
            guard case .placed(let worldA, _, let span) = session.phase else { return }
            let newYaw = committedYaw + radians
            plotAnchor?.orientation = simd_quatf(angle: newYaw, axis: [0, 1, 0])
            session.phase = .placed(worldA: worldA, yaw: newYaw, tappedSpan: span)
        }

        // MARK: Scene building

        private func showPreviewA(at worldA: SIMD3<Float>) {
            clearPreviewGeometry()

            let markerA = PlotEntityFactory.marker(color: .systemGreen)
            markerA.position = worldA
            previewAnchor.addChild(markerA)
            previewMarkerA = markerA

            // Ring at the declared distance: land B on it and the plot matches
            // its declared scale exactly.
            let radius = Float(document.abDistanceMeters)
            if radius > 0 {
                let ring = PlotEntityFactory.targetRing(
                    radius: radius,
                    color: UIColor.systemGreen.withAlphaComponent(0.85)
                )
                ring.position = worldA
                previewAnchor.addChild(ring)
                targetRing = ring
            }
        }

        private func clearPreviewGeometry() {
            previewMarkerA?.removeFromParent()
            previewMarkerA = nil
            targetRing?.removeFromParent()
            targetRing = nil
            previewLine.isEnabled = false
        }

        private func removePlot() {
            if let plotAnchor, let arView {
                arView.scene.removeAnchor(plotAnchor)
            }
            plotAnchor = nil
            billboardTargets.removeAll()
        }

        private func buildPlot(worldA: SIMD3<Float>, yaw: Float) {
            guard let arView else { return }
            removePlot()

            let anchor = AnchorEntity(world: worldA)
            anchor.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])

            let abMeters = document.abDistanceMeters
            let bLocal = SIMD3<Float>(Float(abMeters), 0, 0)

            // Baseline drawn on the floor so a wrong A/B assignment or a bad
            // heading is obvious immediately, not after walking the plot.
            let baseline = PlotEntityFactory.unitLine(
                color: UIColor.white.withAlphaComponent(0.8)
            )
            PlotEntityFactory.updateLine(baseline, from: .zero, to: bLocal)
            anchor.addChild(baseline)

            let (markerA, pivotA) = PlotEntityFactory.labeledMarker(text: "A", color: .systemGreen)
            markerA.position = [0, 0.005, 0]
            anchor.addChild(markerA)
            billboardTargets.append(pivotA)

            let (markerB, pivotB) = PlotEntityFactory.labeledMarker(text: "B", color: .systemRed)
            markerB.position = [bLocal.x, 0.005, 0]
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

        // MARK: ARCoachingOverlayViewDelegate

        // The delegate requirement is nonisolated in the Xcode 16.4 SDK.
        // Hop to the main actor before touching observable placement state.
        nonisolated func coachingOverlayViewDidDeactivate(_ coachingOverlayView: ARCoachingOverlayView) {
            Task { @MainActor [weak self] in
                guard let self, self.arView != nil else { return }
                if self.session.phase == .searchingForPlane {
                    self.session.phase = .waitingForA
                }
            }
        }
    }
}
