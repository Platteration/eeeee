import SwiftUI
import UniformTypeIdentifiers

struct PlotEditorView: View {
    @EnvironmentObject private var viewModel: PlotViewModel
    @FocusState private var distanceFieldFocused: Bool
    @State private var showingClearConfirmation = false

    private static let canvasSpace = "canvas"

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color(.systemBackground)
                    .contentShape(Rectangle())
                    .onTapGesture(coordinateSpace: .named(Self.canvasSpace)) { location in
                        distanceFieldFocused = false
                        if viewModel.selectedPointID != nil {
                            viewModel.selectedPointID = nil
                        } else {
                            viewModel.addPoint(at: PlotMath.clampToCanvas(location, in: geo.size))
                        }
                    }

                baseline

                ForEach(viewModel.doc.points) { point in
                    pointDot(point, in: geo.size)
                }

                referenceHandle("A", color: .green, position: viewModel.doc.pointA, in: geo.size) {
                    viewModel.moveA(to: $0)
                }
                referenceHandle("B", color: .red, position: viewModel.doc.pointB, in: geo.size) {
                    viewModel.moveB(to: $0)
                }
            }
            .coordinateSpace(name: Self.canvasSpace)
            .onAppear { canvasSize = geo.size }
            .onChange(of: geo.size) { canvasSize = $0 }
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { distanceFieldFocused = false }
            }
        }
        .confirmationDialog("Clear all plotted points?", isPresented: $showingClearConfirmation, titleVisibility: .visible) {
            Button("Clear all points", role: .destructive) {
                viewModel.clearAllPoints()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This cannot be undone. A, B, and your distance will be kept.")
        }
    }

    private var baseline: some View {
        Path { path in
            path.move(to: viewModel.doc.pointA)
            path.addLine(to: viewModel.doc.pointB)
        }
        .stroke(style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
        .foregroundColor(.secondary)
        .allowsHitTesting(false)
    }

    private func pointDot(_ point: PlotPoint, in size: CGSize) -> some View {
        let isSelected = viewModel.selectedPointID == point.id
        return ZStack {
            Circle()
                .fill(Color.accentColor)
            Circle()
                .strokeBorder(isSelected ? Color.orange : Color.white, lineWidth: isSelected ? 3 : 1.5)
            Text(point.label)
                .font(.caption2.bold())
                .foregroundColor(.white)
                .minimumScaleFactor(0.5)
        }
        .frame(width: 24, height: 24)
        .frame(width: 44, height: 44)
        .contentShape(Circle())
        .position(point.position)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Point \(point.label)")
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
        .onTapGesture {
            viewModel.selectedPointID = isSelected ? nil : point.id
        }
        .modifier(PlotDragModifier(position: point.position, canvasSize: size,
                                   coordinateSpace: Self.canvasSpace,
                                   move: { viewModel.movePoint(id: point.id, to: $0) },
                                   end: { viewModel.endDrag() }))
    }

    private func referenceHandle(
        _ label: String,
        color: Color,
        position: CGPoint,
        in size: CGSize,
        move: @escaping (CGPoint) -> Void
    ) -> some View {
        ZStack {
            Circle().fill(color)
            Circle().strokeBorder(Color.white, lineWidth: 2)
            Text(label)
                .font(.footnote.bold())
                .foregroundColor(.white)
        }
        .frame(width: 32, height: 32)
        .frame(width: 44, height: 44)
        .contentShape(Circle())
        .position(position)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Reference point \(label)")
        .modifier(PlotDragModifier(position: position, canvasSize: size,
                                   coordinateSpace: Self.canvasSpace, move: move,
                                   end: { viewModel.endDrag() }))
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if viewModel.saveError != nil {
                HStack {
                    Text(viewModel.saveError ?? "Couldn’t autosave. Export a copy to keep your changes.")
                        .font(.caption)
                    Spacer()
                    Button(viewModel.recoveryRequired ? "Back up previous save" : "Retry save") {
                        if viewModel.recoveryRequired { viewModel.preserveRecoveryAndSave() }
                        else { viewModel.retrySaving() }
                    }
                        .font(.caption.bold())
                }
                .foregroundColor(.orange)
                .accessibilityElement(children: .contain)
            }
            if let recovery = viewModel.recoveryFileName {
                Text("Previous save preserved in Files → ABPlot as \(recovery)")
                    .font(.caption).textSelection(.enabled)
            }
            HStack {
                Text("A–B distance")
                    .font(.subheadline)
                TextField(
                    "Distance",
                    value: Binding(
                        get: { viewModel.doc.abDistance },
                        set: { viewModel.setDistance($0) }
                    ),
                    format: .number
                )
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 80)
                .focused($distanceFieldFocused)
                .accessibilityLabel("A–B distance")

                Picker("Unit", selection: Binding(
                    get: { viewModel.doc.unit },
                    set: { viewModel.setUnit($0) }
                )) {
                    ForEach(LengthUnit.allCases) { unit in
                        Text(unit.symbol).tag(unit)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 100)

                Spacer()

                if viewModel.selectedPointID != nil {
                    Button(role: .destructive) {
                        viewModel.deleteSelectedPoint()
                    } label: {
                        Image(systemName: "trash")
                    }
                    .accessibilityLabel("Delete selected point")
                }

                Menu {
                    Button("Clear all points", role: .destructive) {
                        distanceFieldFocused = false
                        showingClearConfirmation = true
                    }
                    .disabled(viewModel.doc.points.isEmpty)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Plot options")
            }

            Text(viewModel.arUnavailableReason ?? "Tap to add a point · drag points, A, or B to move them")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    @ViewBuilder
    private var selectedPointDetails: some View {
        if let point = viewModel.doc.points.first(where: { $0.id == viewModel.selectedPointID }),
           let distances = PlotMath.referenceDistances(of: point.position, in: viewModel.doc) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Point \(point.label) · distances from references")
                    .font(.caption.bold())
                Text("A: \(distances.a, format: .number.precision(.fractionLength(2))) \(viewModel.doc.unit.symbol) · B: \(distances.b, format: .number.precision(.fractionLength(2))) \(viewModel.doc.unit.symbol)")
                    .font(.caption.monospacedDigit())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}
