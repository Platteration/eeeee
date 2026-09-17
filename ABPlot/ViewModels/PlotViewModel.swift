import Combine
import CoreGraphics
import Foundation

@MainActor
final class PlotViewModel: ObservableObject {
    @Published var doc: PlotDocument
    @Published var selectedPointID: UUID?
    @Published private(set) var saveError: String?

    @Published private(set) var recoveryRequired = false
    @Published private(set) var recoveryFileName: String?

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
    /// Consecutive saves sharing a token (typing a name) extend one undo step
    /// instead of adding one per keystroke, as the web editor groups input.
    private var historyGroup: UUID?

    init(saveURL: URL? = nil) {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let resolvedURL = saveURL ?? documents.appendingPathComponent("plot.json")
        self.saveURL = resolvedURL
        var loaded: PlotDocument?
        var loadFailure = false
        do {
            loaded = try PlotJSON.decode(Data(contentsOf: resolvedURL))
        } catch {
            // A missing first-run file is expected; unreadable existing data is not.
            let nsError = error as NSError
            loadFailure = !(nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileReadNoSuchFileError)
        }
        let doc = loaded ?? .default
        self.doc = doc
        nextLabelNumber = Self.nextLabel(in: doc)
        savedSnapshot = Snapshot(document: doc, nextLabelNumber: nextLabelNumber)
        recoveryRequired = loadFailure
        if loadFailure { saveError = "The previous save could not be opened. It has been preserved. Back it up before saving this plot." }
    }

    var canUndo: Bool { !undoHistory.isEmpty }
    var canRedo: Bool { !redoHistory.isEmpty }

    func undo() {
        save() // Finish any in-flight drag before navigating history.
        historyGroup = nil
        guard let previous = undoHistory.popLast() else { return }
        redoHistory.append(savedSnapshot)
        restore(previous)
    }

    func redo() {
        save()
        historyGroup = nil
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
        for point in doc.points {
            guard let coordinate = PlotMath.abCoordinates(of: point.position, a: doc.pointA, b: doc.pointB),
                  Float(coordinate.s * doc.abDistanceMeters).isFinite,
                  Float(coordinate.t * doc.abDistanceMeters).isFinite else {
                return "Some point coordinates are too large for AR. Check the plot measurements."
            }
        }
        return doc.points.isEmpty ? "Tap the canvas to add your first point." : nil
    }

    func addPoint(at position: CGPoint) {
        doc.points.append(PlotPoint(id: UUID(), position: position, label: String(nextLabelNumber)))
        nextLabelNumber = Self.nextLabel(in: doc)
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

    /// The review flow supplies a fully validated document. Record replacement
    /// as one edit so Undo restores every prior point, reference, and unit.
    func importMeasurements(_ document: PlotDocument) {
        doc = document
        selectedPointID = nil
        nextLabelNumber = Self.nextLabel(in: document)
        save()
    }

    /// Scanned or typed measurements replace the geometry only. The plot's name
    /// and its review metadata from the web editor have no native UI yet, so a
    /// replacement built from a table must not silently drop them.
    func replaceMeasurements(with document: PlotDocument) {
        var replacement = document
        replacement.name = doc.name
        replacement.baselineNote = doc.baselineNote
        replacement.baselineNeedsRemeasure = doc.baselineNeedsRemeasure
        replacement.outlineDirection = doc.outlineDirection
        importMeasurements(replacement)
    }

    private static func nextLabel(in document: PlotDocument) -> Int {
        let highest = document.points.compactMap { Int($0.label) }.filter { $0 > 0 }.max() ?? 0
        if highest < Int.max { return highest + 1 }
        let used = Set(document.points.map(\.label))
        var candidate = 1
        while used.contains(String(candidate)) { candidate += 1 }
        return candidate
    }

    /// Pass the same `historyGroup` for every keystroke of one editing session
    /// so the whole name is one undo step; pass nil to commit and end the group.
    func setName(_ name: String, historyGroup: UUID? = nil) {
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        doc.name = trimmed.isEmpty ? nil : trimmed
        save(historyGroup: historyGroup)
    }

    /// Never overwrite an unreadable autosave until its bytes have a durable copy.
    func preserveRecoveryAndSave() {
        guard recoveryRequired else { retrySaving(); return }
        do {
            let previous = try Data(contentsOf: saveURL)
            let backup = saveURL.deletingLastPathComponent()
                .appendingPathComponent("plot-recovery-\(UUID().uuidString).json")
            try previous.write(to: backup, options: .atomic)
            recoveryFileName = backup.lastPathComponent
            recoveryRequired = false
            persist()
        } catch {
            saveError = "Could not preserve the previous save. It is still untouched. Export the current plot using Plot files & name."
        }
    }

    func retrySaving() {
        save()
    }

    /// Apply one uniform scale and translation to every canvas position.
    /// The declared distance and coordinates relative to A/B stay unchanged.
    func fitPlot(in size: CGSize) {
        let padding: CGFloat = 28
        guard size.width.isFinite, size.height.isFinite,
              size.width > padding * 2, size.height > padding * 2 else { return }
        let positions = [doc.pointA, doc.pointB] + doc.points.map(\.position)
        guard positions.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return }
        let minX = positions.map(\.x).min()!
        let maxX = positions.map(\.x).max()!
        let minY = positions.map(\.y).min()!
        let maxY = positions.map(\.y).max()!
        let width = maxX - minX
        let height = maxY - minY
        guard width.isFinite, height.isFinite else { return }
        let scaleX = width > 0 ? (size.width - padding * 2) / width : .infinity
        let scaleY = height > 0 ? (size.height - padding * 2) / height : .infinity
        let scale = width == 0 && height == 0 ? 1 : min(scaleX, scaleY)
        guard scale.isFinite, scale > 0 else { return }
        let center = CGPoint(x: minX + width / 2, y: minY + height / 2)
        func fitted(_ position: CGPoint) -> CGPoint {
            CGPoint(x: (position.x - center.x) * scale + size.width / 2,
                    y: (position.y - center.y) * scale + size.height / 2)
        }
        // Repeated fitting can differ only by floating-point rounding.
        guard positions.contains(where: {
            let next = fitted($0)
            return abs(next.x - $0.x) > 0.001 || abs(next.y - $0.y) > 0.001
        }) else { return }
        doc.pointA = fitted(doc.pointA)
        doc.pointB = fitted(doc.pointB)
        for index in doc.points.indices {
            doc.points[index].position = fitted(doc.points[index].position)
        }
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
        guard distance.isFinite, distance >= 0 else { return }
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

    private func save(historyGroup group: UUID? = nil) {
        let current = Snapshot(document: doc, nextLabelNumber: nextLabelNumber)
        guard current != savedSnapshot else {
            if group != historyGroup { historyGroup = nil }
            if saveError != nil { persist() }
            return
        }
        if group == nil || group != historyGroup {
            undoHistory.append(savedSnapshot)
            if undoHistory.count > historyLimit {
                undoHistory.removeFirst(undoHistory.count - historyLimit)
            }
        }
        redoHistory.removeAll()
        historyGroup = group
        savedSnapshot = current
        persist()
    }

    private func persist() {
        guard !recoveryRequired else { return }
        do {
            let data = try PlotJSON.encode(doc)
            try data.write(to: saveURL, options: .atomic)
            saveError = nil
        } catch {
            saveError = error.localizedDescription
            print("ABPlot: failed to save plot: \(error)")
        }
    }
}
