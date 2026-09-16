# ABPlot handoff to Claude

Continue on **codex/abplot-claude-handoff** in **Platteration/eeeee**. This branch
combines both Claude platform branches and the subsequent Codex work:

- Web: `claude/ab-plotting-web-app-j4en2w`, including reviewed table entry, OCR,
  recovery and pool photo overlays.
- iOS: `claude/ios-ab-plotting-ar-232m3z` at `4477059`, including AR reticle,
  rotation, measurement imports/OCR, history and portable plot files.

Both histories are retained. Info.plist keeps Files sharing/open-in-place support.
Web and iOS CI run for PRs and pushes to this handoff branch. Continue from this
branch so work on either platform remains included. A static package is prepared
for deployment; packaging and green unsigned iOS builds do not publish a website
or distribute an app. Follow [RELEASE.md](RELEASE.md) for launch gates.

## Start here

```sh
git fetch origin
git switch codex/abplot-claude-handoff
cd web
npm ci
npm start
```

Use Node 22 or 24 and open http://localhost:8000. The iOS project requires Xcode
16+ on macOS; real AR needs a signed build and physical iPhone. Root README covers
the app, [web/README.md](web/README.md) covers the current browser journeys, and
[web/OCR_PILOT.md](web/OCR_PILOT.md) covers optional Azure setup and limits.

## What the focused web polish release changes

The header owns project name, Open project, Save project and Export. **Plan** and
**Photo** are inline workspaces. The plan side panel separates **Measure**,
**Points**, and **Checks** and collapses on smaller screens. A fresh browser
project starts unscaled: enter the actual A–B distance and explicitly apply it.
Changing the reference previews its global effect before committing.

**Measure** supports one-at-a-time A/B entry with Add & next, a missed point's
insertion position, and reviewed table/OCR entry. The table defaults to A/B
distances; column mapping and exact offset editing remain available as advanced
controls. **Select** is the default plan/photo tool. Moving and adding/matching
require their explicit tools, so inspection taps cannot accidentally edit data.

**Points** presents number/code plus optional description, search, filters,
previous/next navigation, A/B remeasurement, reminders and notes. Labels can be
repaired without changing UUIDs, geometry, sequence or photo matches. Imported
legacy labels are preserved and warned on; new duplicate/reserved labels are
rejected. Per-point remeasurement drafts survive navigation and cannot apply
under a stale point/reference/unit context. Descriptions and notes autosave on
input, with consecutive typing grouped into one Undo step.

**Checks** keeps conservative crossing/overlap/flatness/direction advice. Earlier,
Later and Reverse sequence change order without changing geometry. Concave pools
are valid; warnings identify candidates rather than claiming one reading is
provably wrong. Manual reminders and outline warnings remain distinct.

**Photo** supports matching existing points or clicking first and then entering
A/B readings. Clicking an existing marker selects it even after auto-advance;
Move match changes image coordinates only. Select does not place marks. Photo
measurements guard against changed reference units, and creating a point plus
its match is one Undo action. Projection remains an optional planar alignment aid
using at least four well-spaced matches, never a source of physical measurements.

**Export** includes plot-only iPhone JSON, CSV with descriptions/reminders/notes,
SVG/PNG plans with the ordered boundary and a description key, and a printable
field sheet of A/B readings, descriptions, checks and notes. The print document is
separate from the editor and can use the browser's Save as PDF destination.

## Whole-project state and compatibility

Keep the two existing portable formats:

- Ordinary plot JSON: CGPoint arrays `[x,y]`, UUID identifiers, meters/feet units,
  point labels and optional metadata. **Export plot for iPhone** selects this
  format even when the web project has a photo.
- Photo project: `format: "abplot-photo-project"`, `version: 1`, ordinary
  `document`, and a normalized embedded PNG with UUID/A/B-keyed pixel matches and
  display settings. No version bump or saved-project migration is required.

**Save project** uses photo-project JSON whenever an image is attached and plain
plot JSON otherwise. **Open project** auto-detects either. New project and ordinary
plot-file opening detach the previous photo; Undo restores the complete previous
pair. Its prior durable photo recovery remains available. Separate tabs keep
separate photo recovery records, and failed updates preserve the earlier copy.
The header reports photo recovery failures as well as ordinary plot-save status.
Browser recovery is distinct from an explicitly downloaded portable project.

Relevant ownership boundaries:

- `web/src/store.js` owns document and photo-sidecar Undo/Redo. `apply(mutate,
  {historyGroup})` groups consecutive input from a focus token while saving each
  change. `applyProject` mutates a `{document, photo}` pair atomically. Existing
  document-only edits preserve the photo. `loadLatest()` detaches it.
- `web/src/projectState.js` shares frozen image assets across history snapshots;
  only pins/settings are copied. Never place image data into ordinary plot
  autosave or structured-clone full image bytes for each text edit.
- `web/src/photoPanel.js` owns photo interactions, project open/save, recovery and
  loading cancellation. Its public API includes `open`, `close`, `cancelOpen`,
  `openProject(file)`, `replaceDocument(doc)`, `saveProject()`, `hasDraft`, and
  `discardDrafts()`. Callbacks coordinate workspace visibility, recovery status
  and the shared before-replace draft guard.
- `web/src/pointNames.js`, `reviewPanel.js`, `quickEntry.js` own point presentation,
  focused entry and draft handling. `photoOverlay.js` and `plotReview.js` remain
  pure geometry/validation helpers. `fieldSheet.js` owns printable checklists.

Optional point metadata is `description` (120 characters), `note` (1,000) and
`needsRemeasure`. Document metadata includes name, baseline note/reminder and
outline direction. The updated Swift Codable model preserves these fields and
JSON checks cover round trips; native description/review UI is a later task.
Older iOS builds may drop optional metadata when saving. The iOS app does not yet
open web photo-project files.

Unapplied measurement fields are intentionally not part of project downloads.
Opening/replacing a project requires resolving the draft guard. Changing baseline
or units must not silently reinterpret typed readings. Keep these boundaries when
adding more entry or navigation tools.

## Validation and remaining release checks

```sh
cd web
npm test
npx playwright install chromium firefox webkit
npm run test:browser
npm run build
```

Unit and browser coverage includes naming/metadata, grouped Undo, complete
plot/photo history, immutable asset references, explicit modes, touch cancellation,
stale drafts/read operations, both photo workflows, OCR failure fallback,
projection, exports, browser recovery and narrow layouts. The final commit's
GitHub Actions results are the source of truth; do not quote old test totals as
validation of later edits.

CI covers web Node 22/24 on Windows/Linux, Chromium/Firefox/mobile WebKit, repeated
mobile interaction, Docker smoke checks, macOS Swift checks and unsigned
simulator/device builds. Real iPhone Files/camera/AR use, handwriting accuracy,
live Azure behavior, signing and a deployed origin remain separate checks.

Next focused follow-ups after this release:

1. Test actual pool photos, field sheets and mobile downloads with users on site.
2. Add a deliberate project library only after learning which saved-project
   organization users need; browser recovery is not a project manager.
3. Design offline install/cache updates explicitly, including model assets and
   version rollback. Do not imply a complete offline guarantee from local OCR.
4. Improve OCR crop manipulation and side-by-side source/table review; gather
   representative handwriting samples before making accuracy claims.
5. Add native iOS description/reminder UI and, separately, photo-project support.
   Preserve the small ordinary plot format for cross-platform measurements.

Cloud OCR stays optional and disabled without explicit configuration. No cloud
credentials belong in the repository. Use the release checklist before making
public deployment, real-device AR or handwriting-accuracy claims.
