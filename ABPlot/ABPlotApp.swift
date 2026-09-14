import SwiftUI

@main
struct ABPlotApp: App {
    @StateObject private var viewModel = PlotViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
        }
        .onChange(of: scenePhase) { phase in
            if phase != .active { viewModel.endDrag() }
        }
    }
}
