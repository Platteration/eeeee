import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRows, reviewMeasurements, measurementNumber } from '../src/measurementImport.js';
import { defaultDocument, parseDocument, serializeDocument } from '../src/plotDocument.js';
import { measurePoints } from '../src/measurements.js';
import { Store } from '../src/store.js';

test('CSV quoting, headers and column mapping preserve labels and values', () => {
  const rows = parseRows('x,label,y\n1,"front, corner",-2', { header: true, columns: [1, 0, 2] });
  assert.equal(rows[0].label, 'front, corner'); assert.equal(rows[0].first, '1');
  assert.throws(() => parseRows('"unclosed,1,2'), /not closed/);
  assert.throws(() => parseRows('p,1,2', { columns: [0, 0, 2] }), /different column/);
});
test('decimal comma is explicit and ambiguous values are rejected', () => {
  const rows = parseRows('P1;1,5;−2,5');
  const result = reviewMeasurements(rows, defaultDocument(), { decimal: ',' });
  assert.equal(result.valid, true); assert.equal(measurePoints(result.document)[0].along, 1.5);
  assert.throws(() => measurementNumber('1,500'), /selected decimal/);
  assert.throws(() => measurementNumber('1.500', ','), /selected decimal/);
});
test('A/B distances reproduce iOS triangle geometry and baseline sides', () => {
  const doc = { ...defaultDocument(), abDistance: 4 };
  const rows = parseRows('P1 3 3\nP2 3 3'); rows[1].side = 'below';
  const result = reviewMeasurements(rows, doc, { mode: 'distances' });
  assert.equal(result.valid, true);
  const measured = measurePoints(result.document);
  assert.equal(measured[0].along, 2); assert.ok(Math.abs(measured[0].perp + Math.sqrt(5)) < 1e-10);
  assert.ok(measured[1].perp > 0);
  assert.equal(reviewMeasurements(parseRows('P 1 1'), doc, { mode: 'distances' }).valid, false);
  assert.equal(reviewMeasurements(parseRows('P -3 3'), doc, { mode: 'distances' }).valid, false);
});
test('units, duplicates and reserved labels are reviewed before commit', () => {
  const doc = defaultDocument();
  const result = reviewMeasurements(parseRows('P1,10,0'), doc, { unit: 'feet' });
  assert.ok(Math.abs(measurePoints(result.document)[0].along - 3.048) < 1e-10);
  assert.equal(reviewMeasurements(parseRows('p1,1,1'), result.document).valid, false);
  assert.equal(reviewMeasurements(parseRows('p1,1,1'), result.document, { replace: true }).valid, true);
  assert.equal(reviewMeasurements(parseRows('A,1,1'), doc).valid, false);
});
test('250-point import is portable and commits as one undoable action', () => {
  const text = Array.from({ length: 250 }, (_, i) => `P${i},${i / 10},${i % 10}`).join('\n');
  const result = reviewMeasurements(parseRows(text), defaultDocument());
  assert.equal(result.valid, true);
  const store = new Store(); store.replace(result.document);
  assert.equal(parseDocument(serializeDocument(store.document)).points.length, 250);
  store.undo(); assert.equal(store.document.points.length, 0); assert.equal(store.canUndo, false);
});
