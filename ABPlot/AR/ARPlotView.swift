import SwiftUI

struct ARPlotView: View {
    let document: PlotDocument
    @StateObject private var session = ARPlotSession()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            ARViewContainer(document: document, session: session)
                .ignoresSafeArea()

            VStack {
                VStack(spacing: 6) {
                    Text(session.instruction)
                        .font(.subheadline.bold())
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())

                    if let hint = session.hint {
                        Text(hint)
                            .font(.caption)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial, in: Capsule())
                            .foregroundColor(.orange)
                    }
                }
                .padding(.top, 8)

                Spacer()

                HStack(spacing: 16) {
                    Button {
                        session.resetHandler?()
                    } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(.ultraThinMaterial, in: Capsule())
                    }

                    Button {
                        dismiss()
                    } label: {
                        Label("Done", systemImage: "xmark")
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                }
                .padding(.bottom, 16)
            }
        }
        .onAppear {
            session.declaredSpanMeters = document.abDistanceMeters
        }
    }
}
