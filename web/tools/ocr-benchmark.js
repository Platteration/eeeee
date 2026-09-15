/** Manifest: [{ category: 'printed'|'handwritten', image: 'file.png', expectedNumbers: ['12.50', '8.25'] }]. */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
const manifest = resolve(process.argv[2] ?? 'ocr-samples/manifest.json');
const samples = JSON.parse(await readFile(manifest, 'utf8'));
const worker = await createWorker('eng', 1, { langPath: fileURLToPath(new URL('../vendor/ocr/lang/', import.meta.url)) });
const totals = { printed: { correct: 0, cells: 0 }, handwritten: { correct: 0, cells: 0 } };
try {
  for (const sample of samples) {
    if (!Object.hasOwn(totals, sample.category) || !Array.isArray(sample.expectedNumbers)) throw Error('Invalid benchmark manifest');
    const { data } = await worker.recognize(resolve(dirname(manifest), sample.image));
    // Compare ordered standalone numbers exactly, including signs and decimals.
    const numbers = data.text.match(/(?<!\w)[+-]?\d+(?:[.,]\d+)?(?!\w)/g) ?? [];
    const expected = sample.expectedNumbers.map(String);
    const correct = expected.filter((value, i) => numbers[i] === value).length;
    totals[sample.category].correct += correct; totals[sample.category].cells += Math.max(expected.length, numbers.length);
    console.log(JSON.stringify({ image: sample.image, category: sample.category, correct, expectedCells: expected.length, recognizedCells: numbers.length }));
  }
} finally { await worker.terminate(); }
let passed = true;
for (const [category, total] of Object.entries(totals)) {
  const accuracy = total.cells ? total.correct / total.cells : 0;
  const pass = total.cells >= 100 && accuracy >= (category === 'printed' ? 0.98 : 0.95);
  console.log(JSON.stringify({ category, ...total, accuracy, pass })); passed &&= pass;
}
process.exitCode = passed ? 0 : 1;
