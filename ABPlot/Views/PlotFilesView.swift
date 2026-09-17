import SwiftUI
import UniformTypeIdentifiers

private struct PlotJSONFile: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct PlotFilesView: View {
    @EnvironmentObject private var viewModel: PlotViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    /// One token per presentation of this sheet: typing the name is one undo step.
    @State private var nameHistoryGroup = UUID()
    @State private var importing = false
    @State private var exporting = false
    @State private var exportFile = PlotJSONFile(data: Data())
    @State private var incoming: PlotDocument?
    @State private var incomingFilename = ""
    @State private var errorMessage: String?

    init(initialName: String?) {
        _name = State(initialValue: initialName ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Current plot") {
                    TextField("Plot name", text: $name)
                        .onSubmit { viewModel.setName(name) }
                        .onChange(of: name) { viewModel.setName($0, historyGroup: nameHistoryGroup) }
                    Text("\(viewModel.doc.points.count) points · A–B \(viewModel.doc.abDistance, format: .number) \(viewModel.doc.unit.symbol)")
                        .foregroundStyle(.secondary)
                    Button("Save JSON to Files…", systemImage: "square.and.arrow.up") {
                        viewModel.setName(name)
                        do {
                            exportFile = PlotJSONFile(data: try PlotJSON.encode(viewModel.doc))
                            exporting = true
                        } catch { errorMessage = error.localizedDescription }
                    }
                }
                Section {
                    Button("Open plot JSON…", systemImage: "folder") { importing = true }
                } footer: {
                    Text("Open a plot from the website or a saved backup. You can review it before replacing the current plot, then use Undo to restore your previous work.")
                }
                if let incoming {
                    Section("Review \(incomingFilename)") {
                        Text(incoming.name ?? "Untitled plot")
                        Text("\(incoming.points.count) points · A–B \(incoming.abDistance, format: .number) \(incoming.unit.symbol)")
                        Button("Replace current plot", role: .destructive) {
                            viewModel.setName(name)
                            viewModel.importMeasurements(incoming)
                            dismiss()
                        }
                        Button("Cancel import", role: .cancel) { self.incoming = nil }
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Plot files")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { viewModel.setName(name); dismiss() }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            incoming = nil
            errorMessage = nil
            do {
                let url = try result.get()
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= PlotJSON.maximumBytes else {
                    throw PlotJSON.Invalid.document("Choose a plot JSON file smaller than 5 MB.")
                }
                incoming = try PlotJSON.decode(Data(contentsOf: url))
                incomingFilename = url.lastPathComponent
            } catch {
                if (error as? CocoaError)?.code != .userCancelled { errorMessage = error.localizedDescription }
            }
        }
        .fileExporter(isPresented: $exporting, document: exportFile, contentType: .json,
                      defaultFilename: "plot") { result in
            if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled {
                errorMessage = error.localizedDescription
            }
        }
    }
}
