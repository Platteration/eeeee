# ABPlot handoff to Claude

Continue on **codex/abplot-claude-handoff** in **Platteration/eeeee**. This branch
combines both existing Claude platform branches and the subsequent Codex changes:

- Web: `claude/ab-plotting-web-app-j4en2w`, including data recovery, reviewed bulk
  entry, local/optional cloud OCR, and PR #12 pool photo overlays.
- iOS: `claude/ios-ab-plotting-ar-232m3z` at `4477059`, including the AR reticle,
  rotation, measurement imports/OCR, history, and portable plot-file improvements.

The merge retains both histories. The Swift app is preserved from the iOS branch;
Info.plist also keeps the web branch's Files sharing/open-in-place capabilities.
Both CI workflows run for PRs and pushes to this handoff branch. Keep subsequent
work on this branch or branch from it so changes to either platform are retained.

The release-readiness pass adds iOS corrupt-save preservation, browser photo
recovery, HTTP health/security headers, a static deployment artifact, and
[RELEASE.md](RELEASE.md). Follow that document for launch gates.

## Start here

```sh
git fetch origin
git switch codex/abplot-claude-handoff
cd web
npm ci
npm start
```

Use Node 22 or 24 and open http://localhost:8000. The iOS project needs Xcode 16+
on macOS; signing and a physical iPhone are needed for actual AR use. Root README
covers the app, web/README.md covers the browser, and web/OCR_PILOT.md covers
optional Azure setup, access-code gating, limits, and benchmark acceptance.

## Photo workflow and code map

Open **Pool photo overlay** in the browser's File controls. Match existing A/B or
measured points to a photo, or choose **Click, then enter A/B distances** to add a
measured point and match it in one operation. Side means above/below in the
measured plan. The photo marker can be anywhere without moving that measured
point. Invalid triangle measurements block point creation.

- `web/src/photoPanel.js`: dialog, gestures, both entry modes, image loading,
  project save/open, PNG/SVG download, cancellation and save reminders.
- `web/src/photoOverlay.js`: project format validation, planar perspective fit,
  marker/outline geometry and escaped self-contained SVG.
- `web/src/measurementImport.js`, `plotDocument.js`, `store.js`: existing shared
  measurement validation, units/wire format, undo and safe persistence.
- `web/browser-tests/photo.spec.js`, `web/test/photoOverlay.test.js`: photo
  workflow and numerical regression coverage.
- `ABPlot/Models/PlotJSON.swift` and `Tests/JSONChecks.swift`: iOS file contract.

Photo projects use version 1 of `abplot-photo-project` and embed the normalized
PNG, ordinary plot document, pixel-coordinate matches keyed by point UUID/A/B,
and display settings. They can be downloaded explicitly, and per-tab browser recovery copies are
also saved in IndexedDB. Recovery failures preserve the previous durable copy.
The iOS app currently accepts ordinary plot JSON, not photo-project files. Export
ordinary JSON from the main web editor to move measurements to iOS. That contract
still uses CGPoint arrays `[x,y]`, UUID strings, meters/feet, and optional name.

Projection uses four or more well-spaced matches on one plane (e.g. the pool rim).
It is an alignment aid, not 3D reconstruction or a way to derive distances from a
photo. Edge-on views, mixed depths and collinear matches are unsuitable. Hollow
markers are projected estimates; solid markers are user matches. Manual matching
works without projection. Image processing stays local in this feature.

## Validation and next checks

Local Windows validation of the photo implementation passed **153 unit tests**
and **69 browser tests** across Chromium, Firefox and mobile WebKit. Desktop and
390px-wide screenshots were inspected. Browser tests cover exports, project
round trips, invalid triangles, projection, zoom alignment, cancelled pointers,
and stale image-load cancellation alongside all existing editor/OCR checks.

```sh
cd web
npm test
npx playwright install chromium firefox webkit
npm run test:browser
```

The combined branch's GitHub Actions checks are the source of truth for its final
commit: web Node 22/24 on Windows/Linux, browser suite plus repeated mobile drag,
Docker smoke test, and macOS Swift checks plus unsigned simulator/device builds.
A green unsigned build is not physical-device validation.

Remaining useful follow-up work for Claude:

1. Smoke-test real iPhone Files import/export, camera OCR and AR placement.
2. Try real pool photos and measurement sheets; check point matching usability
   on touch devices and compare projected outlines against visible rim features.
3. Gather representative handwriting samples before claiming OCR accuracy.
   The controlled printed benchmark passed; handwriting acceptance is still open.
4. Configure and test live Azure OCR only when service credentials and persistent
   pilot-counter storage are available. Cloud OCR stays optional/disabled by default.
5. If bringing photo overlays into iOS, explicitly implement the photo-project
   format there; ordinary plot JSON intentionally remains a small shared format.

Do not claim real-device AR, real handwriting accuracy or live Azure validation
from the automated checks. No cloud credentials are stored in the repository.
