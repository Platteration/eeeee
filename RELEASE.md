# ABPlot release candidate

The website is the quickest launch path. The combined source stays on
`codex/abplot-claude-handoff`; draft PR #13 is the review/handoff reference.
A prepared artifact is not a deployed site, and unsigned iOS builds are not an
App Store or TestFlight release.

## Website launch

1. Use a commit whose web and iOS GitHub Actions checks are green. Download its
   **abplot-static-site** artifact from the Web editor tests run, or run:

   ```sh
   cd web
   npm ci
   npm test
   npm run build
   ```

2. Upload the contents of `web/dist/` to an HTTPS static host. Serve index.html
   at the root, JS as JavaScript, CSS as CSS, `.wasm` as application/wasm, and
   model `.gz` files as downloadable binary (do not transparently unzip them).
   Preserve paths and filename case. Missing paths must return 404; disable SPA
   fallback rewrites. Never publish the repository root or `.env` files.
3. Use revalidation (`Cache-Control: no-cache`) for HTML and application JS/CSS
   to avoid mixing releases. The bundle uses relative asset paths, but hosting
   at a dedicated origin root is simplest. Configure HTTPS before testing saved
   projects and browser APIs. Retain the previous artifact for rollback.
4. Run `npm run smoke -- https://YOUR-HOST` from `web/` against the public URL.
5. On the deployed origin, manually run this short acceptance pass:
   - Enter a known A–B distance, add measured points, undo, change units, and
     verify the same physical distances.
   - Export JSON, reload, reimport it, and export a printable plan.
   - Load a pool photo, try both matching modes, zoom and move a match, then
     save/reopen a photo project and download its PNG.
   - Wait for “Recovery copy saved”, reload, and open the recovery copy. Confirm
     labels, positions, units and image match what was saved.
   - Recognize a clear printed measurement table locally, correct a number in
     review, and import it. Check that local OCR contacts only this site.
   - Repeat the essentials on a real phone. Downloaded files and camera/photo
     permissions can differ from browser automation.
6. Read the data/privacy page with the actual hosting operator. Add its contact
   channel and hosting-specific data practices before a public release.

The static package has no online OCR backend. Manual entry, local OCR and photo
overlays work without service credentials. No cloud service is enabled by this
release process.

## Container option

From the repository root:

```sh
docker build -t abplot-web:release ./web
docker run --name abplot -d --restart unless-stopped -p 127.0.0.1:8000:8000 abplot-web:release
```

Put an HTTPS reverse proxy in front of port 8000. `/healthz` returns a read-only
health response; the container includes a healthcheck, runs as a non-root user,
and drains connections on termination. Runtime paths are allowlisted, responses
include a Content Security Policy, nosniff, no-referrer and frame restrictions.
No TLS termination is built into the Node process.

Keep online OCR disabled for the first launch unless its live service is tested.
If enabled later, use `web/OCR_PILOT.md`: set its public origin, credentials,
access code and session secret through the host's secret controls, and mount a
persistent writable `/data` volume. Its durable daily quota assumes one container;
do not horizontally scale that optional service without shared quota accounting.

## iOS beta prerequisites

The app builds unsigned for simulator and device in CI. To distribute it, use
Xcode on macOS and complete these owner/device steps:

- Set a registered bundle identifier and signing team. The checked-in
  `com.example.abplot` is a development placeholder.
- Review the supplied opaque 1024px AppIcon, based on the existing A/B brand.
- Choose a release version/build number, archive with signing, and validate the
  archive in Xcode before distributing through the intended Apple channel.
- Complete the channel's app information, privacy/support details and any review
  requirements using the actual services in the distributed build.
- On a physical iPhone: open/save a web JSON through Files, scan a printed table,
  deny camera access and verify fallback, recover an interrupted edit, and place
  A/B in AR on a real surface. Check rotation, units, reset and interruption.

Unreadable iOS autosaves now stay untouched while editing. **Back up previous
save** writes their original bytes to a uniquely named recovery file in the app's
Documents folder before saving the current plot. If backup fails, autosave stays
blocked and portable file export remains available. Keep recovery files until
contents have been inspected. Extreme coordinate overflow is rejected on import
and non-finite AR positions cannot enter placement.

## Go/no-go and rollback

Ship the website only after the final commit's automated checks and the deployed
phone/desktop acceptance pass succeed. Hold iOS distribution until signing,
metadata and the physical-device pass are complete. Hold online OCR and handwriting
accuracy claims until their separate live/sample checks pass.

Rollback the website by redeploying the previous complete static artifact or
container image, then run the smoke probe again. Avoid clearing browser data:
users may have unsaved plots or recovery copies. Ordinary plot JSON is unchanged;
photo projects stay version 1, so existing saved projects remain portable.

For support, record the release commit, browser/device, visible error, and steps
to reproduce. Ask for a redacted sample only when needed; do not collect personal
pool photos or measurement data by default.

Apple references: [uploading builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds) and [submitting an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app). Processing and review are external release gates; no next-day approval is assumed.
