# ABPlot Web

Make a pool plan from distances measured from reference points **A** and **B**.
Enter the rim points in walking order, check the outline, add a photo, and take
a printable field sheet back to the pool. The same plot measurements open in the
[ABPlot iOS app](../README.md) for augmented-reality placement.

The web editor works on desktop and phone browsers. Its plan and photo are two
views of the same project. Source modules and SVG keep the interface small;
local OCR uses a pinned, self-hosted Tesseract.js worker and English model.

## Run locally

```sh
cd web
npm ci             # Node 22 or 24; also prepares local OCR assets
npm start          # http://localhost:8000
npm test           # pure Node unit tests
```

Use an HTTP server, not a file:// URL: browser ES modules require an HTTP origin.
The included server supports optional online OCR; a static host supports manual
entry, photo matching and local OCR without service credentials.

## A first pool project

1. Give the project a name in the header. In **Plan → Measure**, enter the
   measured A–B distance and choose **Apply distance**. A fresh web project has
   no measured baseline until you set it.
2. Enter a point number or code, an optional description such as “Deep-end
   corner”, and its measured distances from A and B. Choose its side of the
   baseline on the plan, then **Add & next**. Continue around the rim clockwise
   or counterclockwise. New points receive the next unused numeric label.
3. Open **Points** to find a point by number or description, check its readings,
   add a note, or flag it for remeasurement. **Checks** shows possible outline
   problems and candidates to inspect.
4. Optionally switch to **Photo**, choose an image, and match the same points to
   their visible locations. Both existing-point and click-first workflows work.
5. **Save project** downloads an editable copy of the current work, including
   an attached photo. **Export** provides printable output and a plot-only file
   for the iPhone app.

The side panel has **Measure**, **Points**, and **Checks** sections and can be
collapsed to make more room for the plan. Advanced coordinate editing and import
column mapping stay in their own expandable sections.

### Select, move, and measure

| Action | Control |
| --- | --- |
| Inspect a plan point | **Select**, then tap the marker or choose it in Points |
| Move a plan point or A/B | **Move**, then drag; arrow keys nudge a selected point |
| Sketch approximate points | **Sketch points**, then tap empty plan space |
| Finish moving or sketching | **Done**, or Escape, returns to Select |
| Add exact A/B readings | **Measure → Add & next** |
| Insert a missed reading | Choose **Insert after…** in Walking sequence before adding |
| Enter exact offsets | **Points → Advanced coordinate table**, edit Along / Perp. |
| Pan the plan | Drag the background, middle-drag, or Shift-drag |
| Zoom / fit | Pinch, wheel, ±, or **Fit** |
| Undo / redo | Header buttons or Ctrl/⌘+Z and Ctrl/⌘+Shift+Z |

Select is the default. A tap on empty plan or photo space does not add or move a
point unless an editing tool is selected. Photo and plan markers have generous
hit areas while the visible dots remain compact.

Point UUIDs identify measurements and photo matches. Numbers/codes and optional
descriptions identify them to people; renaming never changes a UUID, reading,
position, or walking sequence. New labels cannot duplicate another label or use
reserved A/B. Imported legacy labels remain available and receive repair warnings
instead of silently losing measurements. Descriptions can contain up to 120
characters; notes can contain up to 1,000.

### Review and drafts

**Points** offers search, previous/next navigation, and filters for remeasurement
reminders or warnings. Edit A/B readings and choose **Save remeasurement** to move
only that point. A successful remeasurement clears its flag; dragging preserves
the reminder. **Next to remeasure** also visits a flagged A–B reference.

Unfinished remeasurement fields remain with their point while you inspect other
points. If the baseline, units, or that point's position changes, the editor
blocks applying the old draft and explains how to reset it. Quick-entry and photo
measurement drafts also guard against a changed reference. Opening or starting
another project asks before discarding unapplied fields. Project downloads contain
committed measurements, not unfinished input fields.

Notes and descriptions autosave as you type, but consecutive typing in one field
is one project Undo step. Undo also restores remeasurement edits, reminders,
sequence changes, and complete plot/photo replacements.

Impossible A/B triangles block applying a measurement and explain which readings
conflict with the baseline. Outline checks flag crossings, overlapping points,
flat shapes and an explicitly requested walking direction that does not match.
Check the sequence first, then remeasure if its order is right. **Earlier in
sequence**, **Later in sequence**, and **Reverse sequence** change the walking
order without moving measured points. Concave outlines are valid. These checks
suggest candidates; they cannot prove which reading is wrong. Choose **Not a
closed outline** for other kinds of plots.

### The A–B reference

The measured A–B distance determines the scale of every point. Changing the
number previews that effect before an explicit Apply action. Moving the reference
handles changes the frame used to interpret the plan. Undo restores either change.
Changing units converts the displayed distance while preserving physical scale
and point positions: 2 m becomes about 6.562 ft.

Along / Perp. offsets follow the direction A→B rather than the screen axes.
Positive perpendicular is the canvas-down side of A→B. Offsets cannot be edited
as physical measurements until a positive A–B distance is set.

## Photos

Switch to the inline **Photo** workspace and choose a JPEG, PNG or WebP image.
The **Photo tool** starts in Select:

- **Select** inspects an existing marker without moving a match.
- **Match** places the selected measured point at an empty photo location.
  Optional automatic advance chooses the next unmatched point. Clicking an
  existing marker always selects that marker, even after automatic advance.
- **Move match** drags a matched marker, or nudges it with arrow keys when the
  photo is focused. This changes image coordinates only.
- **Pan** drags the image; zoom controls and **Fit photo** help with precision.

Choose **Click, then enter A/B distances** to click a location first and then
supply its number/code, description and measured readings. Side refers to the
measured plan, not the photograph's vertical direction. Adding the measured point
and its photo match is one Undo action. A/B themselves can stay unmatched when
they are outside the photograph.

Appearance controls change opacity, labels, measurement annotations and the
ordered outline. **Project unmatched points** needs at least four well-spaced
matches on the same plane, such as the rim. It is a planar alignment aid: an
edge-on view, mixed depths or collinear matches cannot define a dependable
projection. Solid markers are manual matches; hollow markers are estimates.
Neither projection nor rematching changes the actual measured coordinates.

Photos are processed locally and normalized to PNG up to four megapixels. The
photo feature does not upload them. **Export overlaid PNG / SVG** shares the
annotated image; **Save project** retains the editable measurements and matches.

## Save, recover, export and print

**Save project** chooses the existing file format appropriate to the current
work: ordinary plot JSON without a photo, or a version-1 photo project containing
both the plot and image. **Open project** accepts either format. Starting a new
project or opening ordinary plot JSON detaches the previous photo; Undo restores
the complete earlier project, and its prior photo recovery stays available.

The header distinguishes browser recovery from a portable downloaded file. Plot
autosave uses localStorage; photo recovery uses IndexedDB. After a reload, use
**Photo → Recover work from this browser → Open recovery copy** to restore a
complete photo project. Separate tabs keep separate copies. Failed updates keep
the last durable recovery and explain how to download current work. Browser data
can be cleared or evicted, so keep a downloaded project when the work matters.

Autosave checks browser locks and the previously read save before writing. If
another tab saved a different plot, autosave pauses and offers its latest save or
a download of your own version. Blocked storage leaves file export available.
An unreadable previous plot stays downloadable until replacement succeeds.

The **Export** dialog contains:

- **Export plot for iPhone:** measurements and optional descriptions/notes in the
  shared plot JSON format, without the image. In iOS use **Plot files & name →
  Open plot JSON**. Photo projects currently open only in the web client.
- **Export CSV:** measurements in the project's units, plus descriptions,
  remeasurement flags and notes. Text cells are escaped for spreadsheet use.
- **Export SVG / PNG:** the plan with its ordered outline, point markers, review
  indicators, scale bar and a description key. Optional annotations add offsets.
- **Print field sheet:** a paper checklist of points in walking order, A/B
  readings, descriptions, reminders and notes, including a flagged baseline.
  The browser print dialog can also save it as PDF. Printing leaves the editor
  and its selection/history intact.

Choose **Fit to content** for a picture, or A4/A3/Letter/Tabloid and a drawing
scale for a measured paper plan. Auto selects a scale that fits the chosen sheet;
the preview reports whether a manually chosen scale fits. SVG uses physical page
dimensions, and paper PNG output is rasterized at 300 dpi. Print scaled plans at
actual size rather than letting the printer shrink them to fit.

## Tables and OCR

Use **Measure → Paste, scan or import a table** to paste text or open CSV/TSV.
A/B distances are the default; along/perpendicular offsets remain available.
Advanced controls select delimiters, decimal separators, headers and columns.
Preview first, correct or explicitly remove invalid rows, then apply all reviewed
points as one undoable action. Bulk entry accepts up to 500 rows per operation;
existing plots are not truncated.

The OCR section accepts an image or camera photo with crop and rotation controls.
Local recognition uses the self-hosted assets prepared by npm ci. Always check
its output against the source image before applying; uncertain words are called
out. Recognition can be cancelled, and failures leave manual entry available.
See [OCR_PILOT.md](OCR_PILOT.md) for the optional access-code online pilot, Azure
setup and quality gates. Online upload remains an explicit, separate action.

## Shared file format and state

The existing plot format keeps CGPoint pairs as arrays, UUID identifiers, and
meters/feet units:

```json
{
  "name": "Pool survey",
  "pointA": [100, 400],
  "pointB": [300, 400],
  "abDistance": 2,
  "unit": "meters",
  "points": [{ "id": "3F2A0000-0000-4000-8000-000000000001", "position": [200, 300], "label": "1", "description": "Deep-end corner" }]
}
```

Optional point metadata is `description`, `note`, and `needsRemeasure`. Optional
document metadata is `name`, `baselineNote`, `baselineNeedsRemeasure`, and
`outlineDirection` (`clockwise`, `counterclockwise`, or `off`; omitted permits
either direction). The updated iOS model preserves these fields through file
round trips; its native UI does not yet expose the new review/description tools.
Older app versions may discard optional fields when saving.

Ordinary plot imports also accept `{x,y}` coordinates. Invalid or duplicate IDs
receive unique replacements while valid UUIDs are retained and normalized to
uppercase. Distances must be JSON numbers. Open project accepts files up to 8 MB;
measurement text imports have a separate 1 MB limit.

Photo projects retain `format: "abplot-photo-project"`, `version: 1`, an ordinary
`document`, and a `photo` with embedded PNG, dimensions, UUID/A/B-keyed pixel
matches and appearance settings. Existing projects need no migration. Internally
Store history snapshots share immutable image assets and copy only small photo
metadata; the image bytes never enter ordinary plot autosave.

`Store.apply(mutate, {historyGroup})` optionally groups consecutive edits from one
focus token while autosaving each committed change. `applyProject` updates a
`{document, photo}` pair atomically. `projectState.js` supplies the shared-asset
photo state and ordinary-photo conversion. Existing document-only edits preserve
the attached photo; whole-project replacement explicitly sets or detaches it.

## Validation and release

```sh
npm test
npx playwright install chromium firefox webkit
npm run test:browser
npm run build
```

Unit coverage includes geometry, outline checks, descriptions and labels, shared
JSON, grouping and project history, exports, and recovery failures. Browser
coverage spans Chromium, Firefox and mobile WebKit: point entry/review, draft
protection, explicit editing modes, touch cancellation, OCR, photo projection,
whole-project open/save/undo, recovery and narrow layouts. Check the final commit's
CI for the complete result rather than relying on an earlier test count.

`npm run build` writes an allowlisted `web/dist/` package with local OCR assets
and license notices. A prepared package is not a public deployment. Serve it over
HTTPS without an SPA fallback; missing paths must remain 404. Run
`npm run smoke -- https://your-site.example` against the deployed origin. See
[RELEASE.md](../RELEASE.md) for launch gates, rollback and iOS signing steps.

Future work, outside this focused web release: a project library, a deliberate
offline-install/cache strategy, direct-manipulation OCR cropping and image/table
review, and native iOS UI for descriptions, review reminders and photo projects.
