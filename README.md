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
  In-progress drags also save when the app becomes inactive. If a save fails,
  an editor message stays visible with **Retry save** until saving succeeds.
- Switching between meters and feet converts the distance, preserving the
  real-world scale. Use **Done** above the decimal keyboard to finish editing.
- The editor explains what is needed before entering AR: a positive distance,
  separated A/B handles, and at least one plotted point.
- **Clear all points** asks for confirmation and keeps A, B, and the distance.
- Use **Plot options → Fit plot to screen** to bring A, B, and all plotted
  points into view after opening a plot on a smaller screen. This preserves
  proportions and the declared distance, autosaves, and supports Undo.
- Points and reference handles have larger touch targets; new points and drags
  stay inset from the canvas edges so their handles remain reachable.
- Dragging preserves where you grabbed a handle, without snapping its center
  to your finger. Tap a plotted point to see its distances from A and B in the
  selected unit; these update as you move the selected point or either reference.
- **Undo** and **Redo** recover point additions, deletions, whole drags, clearing,
  and distance/unit edits. External keyboards support Command-Z and
  Shift-Command-Z. The last 100 edits are available during the current session;
  the restored plot autosaves, but history starts fresh on relaunch.

### Scan measurement tables (OCR)
- Choose **Plot options → Scan measurements**, then take a photo or select an
  existing image. Apple Vision reads text on-device; no cloud OCR service or API
  key is needed. You can also paste or type rows into the same review screen.
- Enter the source's **A–B distance** and **unit**. Choose the column meaning:
  - **Distances from A/B**: `P1 3.0 4.0` means P1 is 3 units from A and 4 from B.
    For a baseline of 5 this is a valid triangle. Choose Above or Below A→B for
    each point, since two distances alone cannot determine the side.
  - **Baseline offsets**: `P1 2.0 -1.0` means 2 units along A→B and 1 unit above
    the baseline. Positive perpendicular offsets go below A→B.
- Review the source photo and recognized text, correct misread digits, and
  remove headings or unrelated notes. Each row needs a unique label and two
  numbers. Spaces, commas, and semicolons can separate columns; decimal commas
  require spaces or semicolons between columns. A and B are reserved labels.
- Check the point preview, then **Use measurements → Replace plot**. Import
  replaces the current plot in one undoable, autosaved edit. Invalid rows or
  impossible A/B distance pairs block import. Up to 500 points are supported.
- Clear printed tables work best. Handwriting, skewed tables, and annotated
  sketches may need manual correction; this does not infer geometry from a drawing.
  If camera access is unavailable, use the photo picker or paste/type data.

### Export coordinates
- Choose **Plot options → Export coordinates (CSV)** and save to Files.
  Add a plotted point and a valid A–B baseline/distance to enable export.
- The CSV includes A, B, and every numbered point in the selected meters/feet
  unit. `along_ab` measures from A toward B; `perpendicular_screen_down` is
  positive on the canvas-down side of A→B. Both can be negative.
- `distance_from_a` and `distance_from_b` are straight-line distances to the
  references. These are calculated from your sketch and declared A–B distance,
  not measured by the AR camera. Fitting the canvas does not change them.
- Numeric fields use a decimal point, regardless of the phone's locale. Import
  the file as comma-separated data if your spreadsheet expects a different delimiter.

### 2. AR mode
- Tap **View in AR** (enabled once you have at least one point and a valid
  distance).
- Scan a flat horizontal surface. Once a surface is found, a yellow **reticle**
  appears on it under the centre crosshair — you aim with the phone rather than
  stabbing at the screen, so your finger never covers the target.
- Aim at the real-world location of **A** and tap **Place A** (or tap anywhere
  on the view).
- A green **target ring** appears around A at exactly your declared A–B
  distance, with a live line and a distance readout following the reticle. Land
  B anywhere on that ring and the plot matches its declared scale exactly — the
  readout shows the delta as you move ("1.87 m · declared 2.00 m (−6%)").
- Tap **Place B**. All plotted points appear on the surface, with the A→B
  baseline drawn on the floor so you can confirm the heading at a glance.
- **Rotate** with the slider or the ±1° buttons to fine-tune orientation about
  A. **Adjust B** re-aims the direction while keeping A where it is.
  **Reset rotation** returns to the placed heading without clearing A or B.
  **Reset** clears both; **Done** returns to the editor.
- Live and placed distance readouts use the meters/feet unit selected in the
  editor. Discrepancy percentages and the physical placement scale are unchanged.

### A note on scale
The *declared* A–B distance sets the real-world scale — where you place B fixes
direction only. That keeps every dimension true even if your placement is a
little off; the HUD reports the discrepancy between your span and the declared
distance (e.g. "your span 3.00 m vs declared 4.00 m (−25%)") so you can judge
placement accuracy. If the rendered B marker isn't exactly where you placed it,
that's this feedback, not a bug — the target ring is there to make matching the
declared scale easy when you want it.

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
