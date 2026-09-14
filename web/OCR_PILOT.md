# OCR pilot operations

The editor, reviewed text/CSV entry and local OCR work without an Azure account.
Run `npm ci` on Node 22 or 24. Installation copies pinned worker, WebAssembly and
English model assets into `vendor/ocr`; deploy that directory with the static
client. Images stay in the browser unless the user chooses the online action.
Opening the editor does not download the recognition model. The model is loaded
on the first local recognition request. Handwriting recognition is provisional.

## Optional online service

Build from `web` with `docker build -t abplot-web .`. Run **one container/replica**,
with a persistent volume mounted at `/data`, behind an HTTPS reverse proxy.
The container serves the website and `/api/ocr` from the same origin. It exposes
only client assets, not server code, tests, environment files or usage records.

Supply these environment variables through your host's secret configuration:

| Variable | Meaning |
| --- | --- |
| `AZURE_OCR_ENDPOINT` | HTTPS endpoint of an Azure Document Intelligence resource |
| `AZURE_OCR_KEY` | Service key; never put this in browser code |
| `OCR_ACCESS_CODE` | Shared pilot access code, at least 12 characters |
| `OCR_SESSION_SECRET` | Random signing secret, at least 32 characters |
| `OCR_PUBLIC_ORIGIN` | Exact website origin, e.g. `https://plots.example.com`, no trailing slash |
| `OCR_DATA_DIR` | Writable persistent directory; container defaults to `/data` |
| `OCR_DAILY_LIMIT` | Shared image limit per UTC day; default 100 |

Generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Use independent values for the access code and signing secret. Rotating the signing
secret invalidates outstanding eight-hour sessions. Cookies are HttpOnly,
SameSite=Strict, and Secure on HTTPS. Localhost HTTP is supported for development.

If configuration is missing, invalid, or the usage file cannot be read/written,
the online option is disabled. `/api/ocr/config` reports only `{ "enabled": false }`
or `{ "enabled": true }`; it never exposes credentials. Test it after deployment.

Each image reserves one daily slot durably **before** submission. Failed or
cancelled requests still use that slot because Azure may already have billed the
request. There is no automatic resubmission. Preserve the `/data` volume across
restarts. Do not share it among concurrent replicas. The code caps one request
per session and four active requests overall, with a 60-second processing deadline.
Only prepared PNGs up to 4 MB / 4 megapixels are accepted. Login attempts are
limited to five per remote address per 15 minutes; behind a reverse proxy this
address may be shared, so pilot administrators should account for that limit.

The application does not save uploaded images or recognized text on the server,
or include them in logs. Azure's own service retention and processing policies
still apply; do not describe online recognition as entirely local.
Local recognition, paste and CSV remain usable when the pilot is unavailable.

## Quality gate

Keep cloud recognition restricted to the pilot. Before expanding it, collect a
representative, consented set of printed tables and handwritten field notes,
including decimals, signs, crossed-out values, shadows and rotated photos.
Use at least 100 numeric cells **in each category**. Never commit private samples.

Create a local manifest containing entries like:

```json
[
  { "category": "printed", "image": "printed.png", "expectedNumbers": ["12.50", "8.25"] },
  { "category": "handwritten", "image": "notes.png", "expectedNumbers": ["-1.25", "2.00"] }
]
```

Run `node tools/ocr-benchmark.js /path/to/manifest.json` to report local OCR's
ordered exact numeric accuracy separately for print and handwriting. Missing
and additional numeric tokens count against accuracy. The command exits nonzero
unless both sample sizes and the 98% printed / 95% handwriting thresholds pass.
Evaluate Azure on the same images through the pilot and record the same metrics,
plus correction time and unusable-image counts. All OCR results still require
human review regardless of their confidence score.

Automated browser tests use generated printed text to verify the worker, local
asset loading and mandatory review. They do not establish real handwriting
accuracy. Physical iPhone/Android capture, real handwritten samples, live Azure
credentials and a hosting environment are still required for release validation.

## Rollout checks

Run `npm test`, `npm run test:browser`, and the repeated mobile drag regression.
CI also builds and starts the container with online OCR disabled. On the pilot
host, verify correct and incorrect access codes, one successful image, timeout,
quota exhaustion, and quota persistence across a container restart. Monitor
HTTP error counts and the daily usage counter without logging request bodies.
