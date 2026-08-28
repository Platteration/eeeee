import RealityKit
import UIKit

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
}
