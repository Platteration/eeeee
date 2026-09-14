import SwiftUI
import PhotosUI
import AVFoundation

struct MeasurementImportView: View {
    let canvasSize: CGSize
    let initialDistance: Double
    let initialUnit: LengthUnit
    let apply: (PlotDocument) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var baseline = ""
    @State private var unit: LengthUnit = .meters
    @State private var mode: MeasurementImport.Mode = .distances
    @State private var belowLabels = Set<String>()
    @State private var photo: PhotosPickerItem?
    @State private var sourceImage: UIImage?
    @State private var showingCamera = false
    @State private var isRecognizing = false
    @State private var scanError: String?
    @State private var cameraTask: Task<Void, Never>?
    @State private var confirmingReplacement = false
    @FocusState private var editingText: Bool

    private var parsed: MeasurementImport.Parsed { MeasurementImport.parse(text) }
    private var preview: Result<PlotDocument, Error> {
        Result {
            try MeasurementImport.document(text: text, baseline: MeasurementImport.number(baseline) ?? 0,
                                           unit: unit, mode: mode, belowLabels: belowLabels,
                                           canvasSize: canvasSize)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label("Choose measurement photo", systemImage: "photo")
                    }
                    Button { openCamera() } label: {
                        Label("Take measurement photo", systemImage: "camera")
                    }
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                    if isRecognizing { ProgressView("Reading measurements…") }
                    if let sourceImage {
                        Image(uiImage: sourceImage).resizable().scaledToFit()
                            .frame(maxHeight: 220)
                            .accessibilityLabel("Source measurement photo")
                    }
                } footer: {
                    Text("Text recognition runs on your device. Choose a clear photo of a table, or paste/type rows below. Photos are not saved in the plot.")
                }
                .disabled(isRecognizing)

                Section("Measurement format") {
                    Picker("Columns", selection: $mode) {
                        ForEach(MeasurementImport.Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    HStack {
                        Text("A–B distance")
                        TextField("Distance", text: $baseline)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityLabel("Import A–B distance")
                        Picker("Unit", selection: $unit) {
                            ForEach(LengthUnit.allCases) { Text($0.symbol).tag($0) }
                        }
                        .labelsHidden()
                    }
                    Text("Enter the baseline and unit from your source. These apply to every row.")
                        .font(.caption).foregroundColor(.secondary)
                }
                Section {
                    TextEditor(text: $text)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 180)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($editingText)
                        .accessibilityLabel("Recognized measurement rows")
                    Text(mode == .distances
                         ? "One row: label distance-from-A distance-from-B\nExample: P1 3.0 4.0"
                         : "One row: label along-AB perpendicular\nExample: P1 2.0 -1.0\nPositive perpendicular is below A→B; negative is above.")
                        .font(.caption).foregroundColor(.secondary)
                    Text("Correct recognition errors and remove headings/notes. Use spaces, commas, or semicolons between columns. For decimal commas, separate columns with spaces or semicolons.")
                        .font(.caption).foregroundColor(.secondary)
                } header: { Text("Review recognized text") }

                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    reviewSection
                }
            }
            .navigationTitle("Scan measurements")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { cameraTask?.cancel(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use measurements") {
                        editingText = false
                        confirmingReplacement = true
                    }
                    .disabled(isRecognizing || !canImport)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { editingText = false; hideKeyboard() }
                }
            }
            .onAppear {
                if baseline.isEmpty { baseline = String(initialDistance); unit = initialUnit }
            }
            .task(id: photo) {
                guard let photo else { return }
                isRecognizing = true
                defer { isRecognizing = false }
                do {
                    guard let data = try await photo.loadTransferable(type: Data.self) else {
                        throw MeasurementOCR.ScanError.unreadableImage
                    }
                    try Task.checkCancellation()
                    await recognize(data)
                } catch is CancellationError {} catch { scanError = error.localizedDescription }
            }
            .onDisappear { cameraTask?.cancel() }
            .sheet(isPresented: $showingCamera) {
                MeasurementCamera { data in
                    showingCamera = false
                    if let data { cameraTask = Task { await recognize(data) } }
                }
                .ignoresSafeArea()
            }
            .alert("Could not read photo", isPresented: Binding(
                get: { scanError != nil }, set: { if !$0 { scanError = nil } }
            )) {
                Button("OK", role: .cancel) { scanError = nil }
            } message: { Text(scanError ?? "Try another photo.") }
            .confirmationDialog("Replace the current plot with these measurements?", isPresented: $confirmingReplacement,
                                titleVisibility: .visible) {
                Button("Replace plot") {
                    if case .success(let document) = preview { apply(document); dismiss() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Check the numbers, baseline, units, and point sides first. You can Undo this import in the editor.")
            }
        }
    }

    private var canImport: Bool {
        if case .success = preview { return true }
        return false
    }

    @ViewBuilder private var reviewSection: some View {
        Section("Check points (\(parsed.rows.count))") {
            ForEach(parsed.errors, id: \.self) { Text($0).foregroundColor(.red).font(.caption) }
            if case .failure(let error) = preview, parsed.errors.isEmpty {
                Text(error.localizedDescription).foregroundColor(.red).font(.caption)
            }
            if mode == .distances {
                Text("Two distances can place a point on either side of A→B. Choose the side for every point; Above is selected initially.")
                    .font(.caption).foregroundColor(.secondary)
            }
            ForEach(parsed.rows) { row in
                VStack(alignment: .leading) {
                    Text("\(row.label): \(row.first, format: .number) / \(row.second, format: .number) \(unit.symbol)")
                    if mode == .distances {
                        Picker("Side for \(row.label)", selection: Binding(
                            get: { belowLabels.contains(row.label) },
                            set: { if $0 { belowLabels.insert(row.label) } else { belowLabels.remove(row.label) } }
                        )) {
                            Text("Above A→B").tag(false)
                            Text("Below A→B").tag(true)
                        }
                        .pickerStyle(.segmented)
                    }
                }
            }
            if case .success(let document) = preview {
                ImportPlotPreview(document: document)
                    .frame(height: 170)
                    .accessibilityLabel("Preview of the imported plot")
            }
        }
    }

    @MainActor private func recognize(_ data: Data) async {
        isRecognizing = true
        defer { isRecognizing = false }
        let worker = Task.detached(priority: .userInitiated) { try MeasurementOCR.recognize(data) }
        do {
            let result = try await worker.value
            try Task.checkCancellation()
            text = result
            belowLabels.removeAll()
            sourceImage = UIImage(cgImage: try MeasurementOCR.thumbnail(data))
        } catch is CancellationError {} catch { scanError = error.localizedDescription }
    }

    private func openCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: showingCamera = true
        case .notDetermined:
            cameraTask = Task {
                let allowed = await AVCaptureDevice.requestAccess(for: .video)
                guard !Task.isCancelled else { return }
                if allowed { showingCamera = true }
                else { scanError = "Camera access was denied. Choose a photo, or enable camera access for ABPlot in Settings." }
            }
        default: scanError = "Choose a photo, or enable camera access for ABPlot in Settings."
        }
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

private struct ImportPlotPreview: View {
    let document: PlotDocument
    var body: some View {
        Canvas { context, size in
            let points = [document.pointA, document.pointB] + document.points.map(\.position)
            let minX = points.map(\.x).min()!, maxX = points.map(\.x).max()!
            let minY = points.map(\.y).min()!, maxY = points.map(\.y).max()!
            let scale = min((size.width - 32) / max(1, maxX - minX), (size.height - 32) / max(1, maxY - minY))
            func position(_ p: CGPoint) -> CGPoint {
                CGPoint(x: (p.x - (minX + maxX) / 2) * scale + size.width / 2,
                        y: (p.y - (minY + maxY) / 2) * scale + size.height / 2)
            }
            var line = Path()
            line.move(to: position(document.pointA)); line.addLine(to: position(document.pointB))
            context.stroke(line, with: .color(.secondary), lineWidth: 1)
            let labels = ["A", "B"] + document.points.map(\.label)
            for (index, point) in points.enumerated() {
                let p = position(point)
                context.fill(Path(ellipseIn: CGRect(x: p.x - 3, y: p.y - 3, width: 6, height: 6)),
                             with: .color(index == 0 ? .green : index == 1 ? .red : .blue))
                context.draw(Text(labels[index]).font(.caption2), at: CGPoint(x: p.x, y: p.y - 9))
            }
        }
    }
}
