# ABPlot Web

The browser companion to the [ABPlot iOS app](../README.md). Sketch a plot of
points against an **A–B** baseline, declare the real-world A–B distance, and the
whole sketch turns into measurements: how far along and across the baseline each
point sits, how far it is from A, from B, and from any point you select.

The phone app takes the same plot into augmented reality. This one is for the
work that happens before and after that: laying the plot out with a mouse,
checking the numbers, printing it, and handing the JSON to the phone.

No build step, no dependencies — plain ES modules and one `<svg>`.

## Running it

```sh
cd web
npm start          # http://localhost:8000  (PORT=… to change it)
```

`npm start` runs the small static server in `tools/serve.js`; any static server
will do. Opening `index.html` as a `file://` URL will *not* work — ES modules
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
