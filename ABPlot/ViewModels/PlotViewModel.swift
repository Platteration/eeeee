import Combine
import CoreGraphics
import Foundation

@MainActor
final class PlotViewModel: ObservableObject {
    @Published var doc: PlotDocument
    @Published var selectedPointID: UUID?

    private let saveURL: URL
    private var nextLabelNumber: Int
    private struct Snapshot: Equatable {
        var document: PlotDocument
        var nextLabelNumber: Int
    }
    private var savedSnapshot: Snapshot
    @Published private var undoHistory: [Snapshot] = []
    @Published private var redoHistory: [Snapshot] = []
    private let historyLimit = 100

    init(saveURL: URL? = nil) {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let resolvedURL = saveURL ?? documents.appendingPathComponent("plot.json")
        self.saveURL = resolvedURL
        let loaded = (try? Data(contentsOf: resolvedURL)).flatMap {
            try? JSONDecoder().decode(PlotDocument.self, from: $0)
        }
        let doc = loaded ?? .default
        self.doc = doc
        nextLabelNumber = (doc.points.compactMap { Int($0.label) }.max() ?? 0) + 1
        savedSnapshot = Snapshot(document: doc, nextLabelNumber: nextLabelNumber)
    }

    var canUndo: Bool { !undoHistory.isEmpty }
    var canRedo: Bool { !redoHistory.isEmpty }

    func undo() {
        save() // Finish any in-flight drag before navigating history.
        guard let previous = undoHistory.popLast() else { return }
        redoHistory.append(savedSnapshot)
        restore(previous)
    }

    func redo() {
        save()
        guard let next = redoHistory.popLast() else { return }
        undoHistory.append(savedSnapshot)
        restore(next)
    }

    private func restore(_ snapshot: Snapshot) {
        doc = snapshot.document
        nextLabelNumber = snapshot.nextLabelNumber
        savedSnapshot = snapshot
        selectedPointID = nil
        persist()
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
        let current = Snapshot(document: doc, nextLabelNumber: nextLabelNumber)
        guard current != savedSnapshot else { return }
        undoHistory.append(savedSnapshot)
        if undoHistory.count > historyLimit {
            undoHistory.removeFirst(undoHistory.count - historyLimit)
        }
        redoHistory.removeAll()
        savedSnapshot = current
        persist()
    }

    private func persist() {
        do {
            let data = try JSONEncoder().encode(doc)
            try data.write(to: saveURL, options: .atomic)
        } catch {
            print("ABPlot: failed to save plot: \(error)")
        }
    }
}
