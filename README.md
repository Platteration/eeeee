# ABPlot

A simple iOS app for **AB plotting with AR placement**. Sketch a freeform plot
of points on a 2D canvas relative to a baseline between two reference points
**A** and **B**, declare the real-world A–B distance, then step into augmented
reality: tap the real-world spots of A and B on a detected surface and the app
overlays every plotted point at the correct position, scale, and orientation.

Built with SwiftUI, ARKit, and RealityKit. No third-party dependencies.
iOS 16+, iPhone only.

## How it works

### 1. Plot editor
- Tap the canvas to add numbered points; drag to move them; tap a point and
  use the trash button to delete it.
- Drag the green **A** and red **B** handles to place the baseline.
- Enter the real-world A–B distance and pick meters or feet in the bottom bar.
  This distance defines the scale of the whole plot.
- The plot autosaves and is restored on relaunch.

### 2. AR mode
- Tap **View in AR** (enabled once you have at least one point and a valid
  distance).
- Scan a flat horizontal surface until the coaching overlay dismisses.
- Tap the real-world location of **A**, then of **B**.
- All plotted points appear on the surface, oriented along your tapped A→B
  direction. **Reset** lets you re-place; **Done** returns to the editor.

### A note on scale
The *declared* A–B distance sets the real-world scale — the tapped B fixes
direction only. That keeps every dimension true even if a tap is a little
off; the HUD reports the discrepancy between your tapped span and the
declared distance (e.g. "tapped span 3.00 m vs declared 4.00 m (−25%)") so
you can judge placement accuracy. If the rendered B marker isn't exactly
where you tapped, that's this feedback, not a bug.

## Building

1. Open `ABPlot.xcodeproj` in **Xcode 16 or newer**.
   - If the project fails to open, regenerate it:
     `brew install xcodegen && xcodegen` in the repo root.
2. Select the **ABPlot** target → *Signing & Capabilities* → choose your
   Team (change the bundle identifier from `com.example.abplot` if needed).
3. Connect a **physical iPhone** and select it as the run destination —
   ARKit does not run in the simulator (the app builds there, but shows an
   "AR unavailable" alert). On first run, trust your developer certificate
   on the phone under Settings → General → VPN & Device Management.
4. Run.

The app icon set is intentionally empty (builds with a warning). To add one,
drop a 1024×1024 PNG into `ABPlot/Assets.xcassets/AppIcon.appiconset/` and
reference it in that folder's `Contents.json`.

## Project layout

```
ABPlot.xcodeproj/       Xcode 16 project (filesystem-synchronized group)
Config/Info.plist       App Info.plist (camera usage, ARKit requirement)
project.yml             XcodeGen fallback spec
ABPlot/
  ABPlotApp.swift       App entry point
  Models/               PlotDocument + pure coordinate math (PlotMath)
  ViewModels/           PlotViewModel (state + JSON persistence)
  Views/                2D plot editor
  AR/                   AR placement state machine, ARView container,
                        entity factory, AR screen
```
