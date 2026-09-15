/** Read-only production smoke probe. Run: npm run smoke -- https://your-site */
const base = new URL(process.argv[2] || 'http://127.0.0.1:8000');
const checks = [['/', 'text/html'], ['/src/app.js', 'javascript'], ['/styles.css', 'text/css'], ['/privacy.html', 'text/html'], ['/vendor/ocr/tesseract.esm.min.js', 'javascript']];
for (const [path, type] of checks) {
  const result = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
  if (!result.ok || !result.headers.get('content-type')?.includes(type)) throw Error(`${path}: unexpected ${result.status} or content type`);
  console.log(`OK ${path}`);
}
for (const path of ['/server/ocr-api.js', '/.env', '/package.json']) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
  if (response.status !== 404) throw Error(`${path} should return 404, received ${response.status}`);
}
console.log('Runtime assets, privacy page and private-path checks passed.');
