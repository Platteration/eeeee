import RealityKit
import UIKit
import simd

enum PlotEntityFactory {
    static func marker(color: UIColor, radius: Float = 0.02) -> ModelEntity {
        ModelEntity(
            mesh: .generateSphere(radius: radius),
            materials: [UnlitMaterial(color: color)]
        )
    }

    /// A marker sphere with a floating text label above it. The returned
    /// `labelPivot` should be billboarded (yaw-only) toward the camera.
    static func labeledMarker(text: String, color: UIColor) -> (root: Entity, labelPivot: Entity) {
        let root = marker(color: color)

        let pivot = Entity()
        pivot.position = [0, 0.06, 0]
        root.addChild(pivot)

        let mesh = MeshResource.generateText(
            text,
            extrusionDepth: 0.001,
            font: .systemFont(ofSize: 0.05),
            containerFrame: .zero,
            alignment: .center,
            lineBreakMode: .byWordWrapping
        )
        let label = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: .white)])
        // generateText's mesh origin is at its baseline start; recenter it on the pivot.
        let bounds = mesh.bounds
        label.position = [-bounds.center.x, 0, 0]
        pivot.addChild(label)

        return (root, pivot)
    }

    /// Flat aiming disc that lies on the detected plane. `generatePlane` with a
    /// `depth:` (rather than `height:`) lies in the XZ plane, and a corner
    /// radius of half the width turns the square into a circle.
    static func reticle(color: UIColor) -> Entity {
        let root = Entity()

        let ring = ModelEntity(
            mesh: .generatePlane(width: 0.12, depth: 0.12, cornerRadius: 0.06),
            materials: [UnlitMaterial(color: color.withAlphaComponent(0.35))]
        )
        root.addChild(ring)

        let dot = ModelEntity(
            mesh: .generatePlane(width: 0.02, depth: 0.02, cornerRadius: 0.01),
            materials: [UnlitMaterial(color: color)]
        )
        dot.position = [0, 0.001, 0]
        root.addChild(dot)

        return root
    }

    /// Dotted circle of the given radius, lying flat, centred on its own origin.
    /// Used to show where B has to go for the plot to match its declared scale.
    /// The mesh and material are shared across every dot so this stays cheap.
    static func targetRing(radius: Float, color: UIColor, segments: Int = 48) -> Entity {
        let root = Entity()
        guard radius > 0, segments > 0 else { return root }

        let mesh = MeshResource.generateBox(size: [0.012, 0.002, 0.012])
        let material = UnlitMaterial(color: color)
        for index in 0..<segments {
            let angle = Float(index) / Float(segments) * 2 * .pi
            let dot = ModelEntity(mesh: mesh, materials: [material])
            dot.position = [radius * cos(angle), 0, radius * sin(angle)]
            root.addChild(dot)
        }
        return root
    }

    /// A 1 m line along local +X. Position, scale and orient it with
    /// `updateLine` rather than regenerating the mesh — this is driven every
    /// frame while aiming, so mesh generation per frame would be wasteful.
    static func unitLine(thickness: Float = 0.006, color: UIColor) -> ModelEntity {
        ModelEntity(
            mesh: .generateBox(size: [1, thickness, thickness]),
            materials: [UnlitMaterial(color: color)]
        )
    }

    /// Stretch and orient a `unitLine` so it spans `start`→`end` horizontally.
    /// `generateBox` centres its mesh, so placing the midpoint and yawing to the
    /// A→B direction lands the ends exactly on `start` and `end`.
    static func updateLine(_ entity: ModelEntity, from start: SIMD3<Float>, to end: SIMD3<Float>) {
        let (yaw, span) = PlotMath.horizontalYawAndSpan(from: start, to: end)
        entity.scale = [max(span, 0.0001), 1, 1]
        entity.position = (start + end) / 2
        entity.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
    }
}
