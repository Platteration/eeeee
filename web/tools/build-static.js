/** Produce an allowlisted static release directory with self-hosted local OCR. */
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url), output = new URL('dist/', root);
// The deletion target is the fixed dist child of this script's web root.
if (output.href !== new URL('dist/', root).href || !output.href.startsWith(root.href)) throw Error('Invalid build directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'privacy.html', 'src', 'vendor']) await cp(new URL(name, root), new URL(name, output), { recursive: true });
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await writeFile(new URL('release.json', output), JSON.stringify({ app: 'ABPlot', version: pkg.version, builtAt: new Date().toISOString(), onlineOcr: false }, null, 2));
console.log('Static web release prepared in web/dist. Serve over HTTPS; online OCR is unavailable in this package.');
