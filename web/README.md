# ABPlot Web

The browser companion to the [ABPlot iOS app](../README.md). Sketch a plot of
points against an **A–B** baseline, declare the real-world A–B distance, and the
whole sketch turns into measurements: how far along and across the baseline each
point sits, how far it is from A, from B, and from any point you select.

The phone app takes the same plot into augmented reality. This one is for the
work that happens before and after that: laying the plot out with a mouse,
checking the numbers, printing it, and handing the JSON to the phone.

The editor uses plain ES modules and SVG. Local OCR uses a pinned Tesseract.js
worker and English model, copied into self-hosted assets during installation.

## Running it

```sh
cd web
npm ci             # prepare local OCR assets; Node 22 or 24
npm start          # http://localhost:8000  (PORT=… to change it)
```

`npm start` runs the server in `tools/serve.js`; any static server can serve the
editor and local OCR assets. Optional online OCR requires the configured backend.
Opening `index.html` as a `file://` URL will *not* work — ES modules
need an `http://` origin.

```sh
npm test           # the whole suite, no install required
```

## Using it

| | |
| --- | --- |
| Add a point | Click empty canvas, or **Add point** to drop one in the middle of the view |
| Select / deselect | Click a point, or a row in the table |
| Move | Drag a point, or the green **A** / red **B** handle; arrow keys nudge the selection (<kbd>Shift</kbd> for ten pixels at a time) |
| Place exactly | Type into a point's **Along** or **Perp.** cell — see below |
| Delete | <kbd>Delete</kbd>, or the ✕ in its row |
| Pan | Drag the background, the middle button, or <kbd>Shift</kbd>-drag |
| Zoom | Scroll, pinch, the ± buttons; **Fit** (<kbd>F</kbd>) frames everything |
| Undo / redo | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> — a whole drag undoes as one step |

The plot autosaves to `localStorage`, so a reload picks up where you left off.
The Plot panel shows save failures and offers Retry save. Export JSON for a
backup that works across devices. If a previous save cannot be read, it stays
untouched until you explicitly replace it; download its recovery copy first.

### Measuring, both ways

The table reads the sketch, and the sketch reads the table: **Along** and
**Perp.** are editable. Together they *are* the point's position, so typing a
distance moves the point exactly there — click roughly where a feature sits,
then enter what the tape actually said. The derived columns stay read-only; no
single distance from A pins a point down.

Entering a value on an unscaled plot is impossible rather than wrong: without a
declared A–B distance those cells are plain text.

Together with **Add point**, that also makes the whole app usable without a
pointing device: add a point, tab to its cells, and type where it goes.

### Scale

The declared A–B distance is the only real-world dimension you supply;
everything else follows from it. Change it and every measurement rescales.
Changing units converts the displayed distance: 2 m becomes about 6.562 ft.
The physical scale and point positions stay unchanged, matching the updated iOS app.

The grid is aligned to the baseline rather than the screen: each square is a
round real distance on the ground, and the two heavier lines are the axes
through A that the **Along** and **Perp.** columns are measured against.
**Perp.** is signed — positive is the canvas-*down* side of A→B, which is the
side you see below the baseline looking straight down at the plot.

### Files

- **Export JSON** writes the portable ABPlot format. In the updated iOS app,
  choose **Plot files & name → Open plot JSON**, review it, and replace the
  current plot. Use **Fit plot to screen** if the browser canvas was larger.
  The app can save JSON back to Files without renaming files or relaunching.
- **Import JSON** takes that file back, or anything close enough to it. Drop a
  file anywhere on the page to import it.
- **Export CSV** is the measurement table, in the document's unit.
- **Export SVG / PNG** is a printable plan: gridded, with a scale bar and a
  caption giving the A–B distance, the point count and the plot's extent. Tick
  *Label points with their measurements* and every dot carries its own along
  and across figures, so setting the plot out on site needs no second sheet to
  cross-reference.

Give the plot a **name** and it titles the drawing and names every file it
exports, so a folder of surveys stays legible.

### Plans at a true scale

By default a plan is sized to fit its content — a picture of the plot, at
whatever scale falls out. Pick a **sheet** instead (A4, A3, Letter, Tabloid,
either way up) and it becomes a drawing: laid out in millimetres at a stated
ratio, so a ruler on the paper reads real distances.

Leave the scale on *Auto* for the largest standard ratio that fits, or choose
one. The panel says what the next export will be before you make it — including
when a chosen scale is too large for the sheet, and which one would fit. The
ratio is printed on the drawing, because a scaled plan that does not say its
scale is not one.

PNG exports of a sheet are rasterized at 300 dpi (an A4 plan comes out 3508 px
wide), rather than the screen-sized image a fitted export gives.

## The file format

Swift's `Codable` encodes `CGPoint` as a two-element array, `UUID` as an
uppercase string, and `LengthUnit` as its raw value, so `plot.json` looks like:

```json
{
  "pointA": [100, 400],
  "pointB": [300, 400],
  "abDistance": 2,
  "unit": "meters",
  "points": [{ "id": "3F2A…", "position": [200, 300], "label": "1" }]
}
```

That is exactly what this app writes. On import it also accepts `{"x": …,
"y": …}` points and fills in an omitted `unit`, label or id, so a hand-written
or third-party file loads without ceremony; anything genuinely ambiguous is
rejected with a message rather than guessed at.

The optional `name` is retained by the updated iOS app. Older iOS versions
ignore it. An unnamed plot omits the key. Imported IDs are normalized to
uppercase UUIDs, with unique replacements for invalid or duplicate IDs, so
every point remains editable and exports successfully to iOS. File uploads
are limited to 5 MB; distances must be JSON numbers.

Canvas coordinates carry no units and no absolute meaning — only each point's
position *relative to A and B* matters, which is why a plot drawn in a browser
window lands correctly on a phone screen of a different size.

## How the measurements work

`src/plotMath.js` is a line-for-line twin of `ABPlot/Models/PlotMath.swift`.
For a canvas point `p` with `d = p − A` and `Δ = B − A`:

```
s = (d·Δ) / |Δ|²          fraction along A→B   (A = 0, B = 1)
t = (d·Δ⊥) / |Δ|²         fraction across it   (Δ⊥ = (−Δy, Δx))
```

`(s, t)` is dimensionless, so it survives panning, zooming and resizing
untouched. Multiplying by the declared A–B distance gives meters — and
`(s·D, t·D)` is precisely the local `(x, z)` the iOS app hands to RealityKit,
so a number read here is where the marker lands in AR.

## Layout

```
index.html          markup and the panel's static chrome
styles.css          light and dark themes
src/
  plotMath.js       pure geometry; the twin of PlotMath.swift
  plotDocument.js   document shape, defaults, JSON parsing and serializing
  measurements.js   the numbers behind the table
  grid.js           baseline-aligned grid lines, shared by canvas and export
  paper.js          sheet sizes, drawing scales, and which one fits
  format.js         lengths, units, and "nice" round steps
  store.js          state, selection, undo history, autosave
  editor.js         the SVG canvas: rendering, pan, zoom, pointer editing
  exporters.js      JSON, CSV, SVG and PNG output
  app.js            wiring
test/               node:test suites for every module above
tools/serve.js      dependency-free static server for `npm start`
```

Everything except `editor.js`, `app.js` and the `download*` helpers is free of
the DOM, which is why the suite runs in plain Node with nothing installed.

## Browser regression checks

The runtime still has no dependencies or build step. Development-only browser
checks use Playwright; `npm test` runs the pure Node tests without an install.
To run the browser suite, use `npm ci`, `npx playwright install`, then
`npm run test:browser`. CI runs Chromium, Firefox, and mobile WebKit, covering
keyboard deletion, coordinate entry and tab order, native text undo, canceled
touches, interrupted drag recovery, JSON import/export, CSV/SVG/PNG downloads,
failed-save retry, and the narrow layout.

Dragging saves once on release or interruption, and remains one Undo step.
Canceled touches and Shift-clicks do not create points. Canvas markers have
44-pixel hit areas at every zoom, and touch-device form controls are larger.
# Reviewed measurements and OCR

Choose **Enter measurements…** to paste a table or open CSV/TSV/text. Select
along/perpendicular offsets or distances from A/B, input units, decimal separator,
and column numbers. An optional header is skipped only when selected. Preview,
correct or explicitly remove invalid rows, then add points or replace existing
points as one undoable action. The working target is 250 points; existing plots
are not truncated, and bulk entry accepts up to 500 rows per operation.

The photo section accepts JPEG/PNG/WebP, with camera input, crop and rotation.
Local OCR loads self-hosted assets prepared by `npm ci`; its results must be
checked against the source image before applying. See [OCR_PILOT.md](OCR_PILOT.md)
for optional access-code online recognition, container setup and quality gates.

Autosave uses browser locks and compares the last read save before writing.
Conflicting tabs pause autosave and offer loading the latest save or exporting
the current version. Unsupported locking or blocked storage leaves export
available. A corrupt previous save stays downloadable until replacement succeeds.

### Pool photo overlays

Open **Pool photo overlay** and choose a JPEG, PNG or WebP photo. Set the measured
A–B distance and units. Both entry workflows are supported:

- **Match an existing point:** choose A, B or a measured point and click its
  location in the photo. Automatic advance selects the next unmatched point.
- **Click, then enter A/B distances:** click a measured location, enter its label
  and distances from A and B, and choose its side in the measured plan. Invalid
  measurement triangles are rejected before a point is added.

Drag to pan, use the zoom buttons or wheel, and click a selected point's new
location to correct a match. Undo photo mark and Remove selected match adjust
photo matches without changing the measured plot. Labels, A/B distances, opacity
and the outline are configurable; outline segments follow measured point order.

**Project unmatched points** needs at least four well-spaced matches on the same
plane (for example, the pool rim). This uses a [planar perspective transform](https://docs.opencv.org/4.0.0/d9/dab/tutorial_homography.html),
not a 3D reconstruction: an edge-on photo, mixed depths or collinear matches
cannot reliably align the whole pool. Solid markers are manual matches; hollow
markers are projected estimates. Neither matching nor projection changes the
actual measured coordinates or distances.

**Save photo project** downloads the image, measured plot, matches and appearance
in one JSON file; **Open saved photo project** restores it. Photo recovery copies are saved to IndexedDB on this browser. After a reload,
choose **Saved on this browser → Open recovery copy**. Separate tabs keep separate
copies; save failures preserve the previous copy and show a download reminder.
Browser storage may be cleared or evicted, so download a project before closing
when the work matters. **Delete recovery copy** removes a selected local copy.
Ordinary plot JSON remains compatible with iOS and contains no photo; photo
projects are a separate web format. Export overlaid PNG or SVG to share the
annotated image. Photos are processed locally and normalized to PNG up to four
megapixels; this feature does not upload them.

## Release and deployment

`npm run build` prepares an allowlisted `web/dist/` directory for static HTTPS
hosting, including local OCR assets and license notices. Online OCR is unavailable
on static hosting. `npm run smoke -- https://your-site.example` checks the deployed
assets and private-path responses. Do not enable an SPA fallback: missing source
and service paths should return 404. See [RELEASE.md](../RELEASE.md) for the
container option, release gates, rollback, and iOS signing steps.
