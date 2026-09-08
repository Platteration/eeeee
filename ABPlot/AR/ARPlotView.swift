import SwiftUI

struct ARPlotView: View {
    let document: PlotDocument
    @StateObject private var session = ARPlotSession()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            ARViewContainer(document: document, session: session)
                .ignoresSafeArea()

            if session.isAiming {
                crosshair
            }

            VStack {
                topStatus
                Spacer()
                controls
            }
        }
        .onAppear {
            session.declaredSpanMeters = document.abDistanceMeters
        }
    }

    // MARK: Aiming crosshair

    private var crosshair: some View {
        let tint: Color = session.reticleIsTracking ? .yellow : .white.opacity(0.4)
        return ZStack {
            Circle()
                .strokeBorder(tint, lineWidth: 2)
                .frame(width: 34, height: 34)
            Circle()
                .fill(tint)
                .frame(width: 4, height: 4)
        }
        .allowsHitTesting(false)
    }

    // MARK: Status

    private var topStatus: some View {
        VStack(spacing: 6) {
            Text(session.instruction)
                .font(.subheadline.bold())
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())

            if let measurement = session.liveMeasurement {
                Text(measurement)
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
            }

            if let hint = session.hint {
                Text(hint)
                    .font(.caption)
                    .foregroundColor(.orange)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
        .padding(.top, 8)
        .padding(.horizontal)
    }

    // MARK: Controls

    @ViewBuilder
    private var controls: some View {
        VStack(spacing: 12) {
            if session.isPlaced {
                rotationControls
            }

            HStack(spacing: 12) {
                if session.isAiming {
                    Button {
                        session.controller?.commitReticle()
                    } label: {
                        Text(session.placeButtonTitle)
                            .font(.headline)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .disabled(!session.reticleIsTracking)
                } else if session.isPlaced {
                    capsuleButton("Adjust B", systemImage: "arrow.triangle.2.circlepath") {
                        session.controller?.adjustB()
                    }
                }

                capsuleButton("Reset", systemImage: "arrow.counterclockwise") {
                    session.controller?.reset()
                }

                capsuleButton("Done", systemImage: "xmark") {
                    dismiss()
                }
            }
        }
        .padding(.bottom, 16)
        .padding(.horizontal)
    }

    private var rotationControls: some View {
        VStack(spacing: 4) {
            HStack(spacing: 12) {
                Button {
                    session.setRotation(degrees: session.yawOffsetDegrees - 1)
                } label: {
                    Image(systemName: "rotate.left")
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }

                Slider(
                    value: Binding(
                        get: { session.yawOffsetDegrees },
                        set: { session.setRotation(degrees: $0) }
                    ),
                    in: -180...180
                )

                Button {
                    session.setRotation(degrees: session.yawOffsetDegrees + 1)
                } label: {
                    Image(systemName: "rotate.right")
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }
            }

            Text(String(format: "Rotation %+.0f°", session.yawOffsetDegrees))
                .font(.caption2.monospacedDigit())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func capsuleButton(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
        }
    }
}
