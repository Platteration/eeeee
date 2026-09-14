import SwiftUI

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
                            viewModel.addPoint(at: clamp(location, in: geo.size))
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
        .position(point.position)
        .onTapGesture {
            viewModel.selectedPointID = isSelected ? nil : point.id
        }
        .gesture(
            // Nonzero minimum distance so a selection tap doesn't nudge the point.
            DragGesture(minimumDistance: 3, coordinateSpace: .named(Self.canvasSpace))
                .onChanged { viewModel.movePoint(id: point.id, to: clamp($0.location, in: size)) }
                .onEnded { _ in viewModel.endDrag() }
        )
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
        .position(position)
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.canvasSpace))
                .onChanged { move(clamp($0.location, in: size)) }
                .onEnded { _ in viewModel.endDrag() }
        )
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
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

    private func clamp(_ p: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(
            x: min(max(p.x, 0), size.width),
            y: min(max(p.y, 0), size.height)
        )
    }
}
