import SwiftUI

@main
struct ABPlotApp: App {
    @StateObject private var viewModel = PlotViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
        }
    }
}
