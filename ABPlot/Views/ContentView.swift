import ARKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var viewModel: PlotViewModel
    @State private var showingAR = false
    @State private var showingARUnavailableAlert = false

    var body: some View {
        NavigationStack {
            PlotEditorView()
                .navigationTitle("AB Plot")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            if ARWorldTrackingConfiguration.isSupported {
                                showingAR = true
                            } else {
                                showingARUnavailableAlert = true
                            }
                        } label: {
                            Label("View in AR", systemImage: "arkit")
                        }
                        .disabled(!viewModel.canEnterAR)
                    }
                }
        }
        .fullScreenCover(isPresented: $showingAR) {
            ARPlotView(document: viewModel.doc)
        }
        .alert("AR Unavailable", isPresented: $showingARUnavailableAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("AR requires a physical iOS device with ARKit support.")
        }
    }
}
