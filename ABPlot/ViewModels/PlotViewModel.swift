import Combine
import CoreGraphics
import Foundation

@MainActor
final class PlotViewModel: ObservableObject {
    @Published var doc: PlotDocument
    @Published var selectedPointID: UUID?

    private let saveURL: URL
    private var nextLabelNumber: Int

    init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        saveURL = documents.appendingPathComponent("plot.json")
        let loaded = (try? Data(contentsOf: saveURL)).flatMap {
            try? JSONDecoder().decode(PlotDocument.self, from: $0)
        }
        let doc = loaded ?? .default
        self.doc = doc
        nextLabelNumber = (doc.points.compactMap { Int($0.label) }.max() ?? 0) + 1
    }

    var canEnterAR: Bool {
        arUnavailableReason == nil
    }

    var arUnavailableReason: String? {
        guard doc.abDistance.isFinite, doc.abDistance > 0,
              doc.abDistanceMeters.isFinite,
              Float(doc.abDistanceMeters).isFinite else {
            return "Enter a positive A–B distance."
        }
        let dx = doc.pointB.x - doc.pointA.x
        let dy = doc.pointB.y - doc.pointA.y
        guard dx * dx + dy * dy > PlotMath.minCanvasABDistance * PlotMath.minCanvasABDistance else {
            return "Move A and B farther apart."
        }
        return doc.points.isEmpty ? "Tap the canvas to add your first point." : nil
    }

    func addPoint(at position: CGPoint) {
        doc.points.append(PlotPoint(id: UUID(), position: position, label: String(nextLabelNumber)))
        nextLabelNumber += 1
        save()
    }

    func movePoint(id: UUID, to position: CGPoint) {
        guard let index = doc.points.firstIndex(where: { $0.id == id }) else { return }
        doc.points[index].position = position
    }

    func moveA(to position: CGPoint) {
        doc.pointA = position
    }

    func moveB(to position: CGPoint) {
        doc.pointB = position
    }

    func endDrag() {
        save()
    }

    func deleteSelectedPoint() {
        guard let id = selectedPointID else { return }
        doc.points.removeAll { $0.id == id }
        selectedPointID = nil
        save()
    }

    func clearAllPoints() {
        doc.points.removeAll()
        selectedPointID = nil
        nextLabelNumber = 1
        save()
    }

    func setDistance(_ distance: Double) {
        guard distance.isFinite else { return }
        doc.abDistance = distance
        save()
    }

    func setUnit(_ unit: LengthUnit) {
        guard unit != doc.unit else { return }
        let convertedDistance = doc.abDistanceMeters / unit.toMeters
        guard convertedDistance.isFinite else { return }
        doc.abDistance = convertedDistance
        doc.unit = unit
        save()
    }

    private func save() {
        do {
            let data = try JSONEncoder().encode(doc)
            try data.write(to: saveURL, options: .atomic)
        } catch {
            print("ABPlot: failed to save plot: \(error)")
        }
    }
}
