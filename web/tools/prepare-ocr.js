import { cp, mkdir, readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const copy = async (from, to) => { await mkdir(new URL(to.substring(0, to.lastIndexOf('/') + 1), root), { recursive: true }); await cp(new URL(from, root), new URL(to, root)); };
await copy('node_modules/tesseract.js/dist/tesseract.esm.min.js', 'vendor/ocr/tesseract.esm.min.js');
await copy('node_modules/tesseract.js/dist/worker.min.js', 'vendor/ocr/worker.min.js');
for (const file of await readdir(new URL('node_modules/tesseract.js-core/', root))) {
  if (/\.wasm(\.js)?$/.test(file)) await copy(`node_modules/tesseract.js-core/${file}`, `vendor/ocr/core/${file}`);
}
await copy('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'vendor/ocr/lang/eng.traineddata.gz');
for (const name of ['tesseract.js', 'tesseract.js-core']) {
  await copy(`node_modules/${name}/${name === 'tesseract.js' ? 'LICENSE.md' : 'LICENSE'}`, `vendor/ocr/licenses/${name.replaceAll('/', '-')}.txt`);
}
console.log('Local OCR assets prepared.');
await copy('node_modules/@tesseract.js-data/eng/README.md', 'vendor/ocr/licenses/english-model.txt');
