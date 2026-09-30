/**
 * Read-only production smoke probe. Run: npm run smoke -- https://your-site
 *
 * The site may be served from an origin root or from a sub-path such as
 * https://user.github.io/eeeee/, so every probe is resolved relative to the
 * given base rather than to the origin.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const PUBLIC = [['', 'text/html'], ['src/app.js', 'javascript'], ['styles.css', 'text/css'], ['privacy.html', 'text/html'], ['vendor/ocr/tesseract.esm.min.js', 'javascript']];
const PRIVATE = ['server/ocr-api.js', '.env', 'package.json'];

/** Normalize a site URL so relative paths resolve inside it: the path always ends with `/`. */
export function siteBase(input) {
  const base = new URL(input);
  base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}

/** Probe `site`; resolves with the probed URLs or throws on the first failure. */
export async function smoke(site, { fetchImpl = fetch, log = () => {}, timeout = 10000 } = {}) {
  const base = siteBase(site);
  const probed = [];
  for (const [path, type] of PUBLIC) {
    const url = new URL(path, base);
    const result = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (!result.ok || !result.headers.get('content-type')?.includes(type)) throw Error(`${url}: unexpected ${result.status} or content type`);
    log(`OK ${url.pathname}`); probed.push(url.href);
  }
  for (const path of PRIVATE) {
    const url = new URL(path, base);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
    if (response.status !== 404) throw Error(`${url} should return 404, received ${response.status}`);
    probed.push(url.href);
  }
  log('Runtime assets, privacy page and private-path checks passed.');
  return probed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await smoke(process.argv[2] || 'http://127.0.0.1:8000', { log: console.log });
}
