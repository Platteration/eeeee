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
| Add a point | Click empty canvas |
| Select / deselect | Click a point, or a row in the table |
| Move | Drag a point, or the green **A** / red **B** handle; arrow keys nudge the selection (<kbd>Shift</kbd> for ten pixels at a time) |
| Place exactly | Type into a point's **Along** or **Perp.** cell — see below |
| Delete | <kbd>Delete</kbd>, or the ✕ in its row |
| Pan | Drag the background, the middle button, or <kbd>Shift</kbd>-drag |
| Zoom | Scroll, pinch, the ± buttons; **Fit** (<kbd>F</kbd>) frames everything |
| Undo / redo | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> — a whole drag undoes as one step |

The plot autosaves to `localStorage`, so a reload picks up where you left off.

### Measuring, both ways

The table reads the sketch, and the sketch reads the table: **Along** and
**Perp.** are editable. Together they *are* the point's position, so typing a
distance moves the point exactly there — click roughly where a feature sits,
then enter what the tape actually said. The derived columns stay read-only; no
single distance from A pins a point down.

Entering a value on an unscaled plot is impossible rather than wrong: without a
declared A–B distance those cells are plain text.

### Scale

The declared A–B distance is the only real-world dimension you supply;
everything else follows from it. Change it and every measurement rescales.
Changing the unit *reinterprets* the number rather than converting it — 2 m
becomes 2 ft, matching the iOS app, so a document means the same thing in both.

The grid is aligned to the baseline rather than the screen: each square is a
round real distance on the ground, and the two heavier lines are the axes
through A that the **Along** and **Perp.** columns are measured against.
**Perp.** is signed — positive is the canvas-*down* side of A→B, which is the
side you see below the baseline looking straight down at the plot.

### Files

- **Export JSON** writes the iOS app's `plot.json`, byte-compatible with what
  the phone reads and writes (see below). To open it there, copy it into the
  app's folder in the Files app (*On My iPhone → ABPlot*), replacing
  `plot.json`, and relaunch the app — it loads its plot at launch.
- **Import JSON** takes that file back, or anything close enough to it. Drop a
  file anywhere on the page to import it.
- **Export CSV** is the measurement table, in the document's unit.
- **Export SVG / PNG** is a printable plan: gridded, with a scale bar and a
  caption giving the A–B distance, the point count and the plot's extent.

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
