import SwiftUI

/// Shared by plotted points and both reference handles.
struct PlotDragModifier: ViewModifier {
    let position: CGPoint
    let canvasSize: CGSize
    let coordinateSpace: String
    let move: (CGPoint) -> Void
    let end: () -> Void
    @State private var origin: CGPoint?
    @GestureState private var isDragging = false

    func body(content: Content) -> some View {
        content
            .gesture(
                DragGesture(minimumDistance: 3, coordinateSpace: .named(coordinateSpace))
                    .updating($isDragging) { _, active, _ in active = true }
                    .onChanged { value in
                        let start = origin ?? position
                        origin = start
                        move(PlotMath.draggedPosition(from: start, translation: value.translation, in: canvasSize))
                    }
                    .onEnded { _ in finish() }
            )
            // GestureState also resets on cancellation, when onEnded may not run.
            .onChange(of: isDragging) { active in
                if !active { finish() }
            }
    }

    private func finish() {
        guard origin != nil else { return }
        origin = nil
        end()
    }
}
