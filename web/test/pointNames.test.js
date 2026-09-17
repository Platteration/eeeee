import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultDocument, newId, parseDocument, serializeDocument } from '../src/plotDocument.js';
import { labelWarnings, normalizePointDescription, pointDisplayName, validatePointLabel } from '../src/pointNames.js';
import { reviewMeasurements } from '../src/measurementImport.js';
import { parsePhotoProject, photoSettings, serializePhotoProject } from '../src/photoOverlay.js';

const point = (label, extra = {}) => ({ id: newId(), label, position: { x: 200, y: 300 }, ...extra });

test('new names have one trimmed, case-insensitive policy across creation and rename', () => {
  const existing = point('Corner');
  assert.equal(validatePointLabel(' 12 ', [existing]), '12');
  assert.equal(validatePointLabel('CORNER', [existing], existing.id), 'CORNER');
  for (const label of ['', '   ', 'A', ' b ', 'corner', 'x'.repeat(41)]) assert.throws(() => validatePointLabel(label, [existing]));
  assert.throws(() => validatePointLabel('same', [{ label: 'same' }]), /Duplicate/);
  assert.equal(pointDisplayName({ label: '12', description: '  Shallow end  ' }), '12 · Shallow end');
});

test('legacy labels load without renaming and expose warnings keyed by UUID', () => {
  const doc = { ...defaultDocument(), points: [point('A'), point('Corner'), point(' corner '), point('')] };
  const restored = parseDocument(serializeDocument(doc));
  assert.deepEqual(restored.points.map(p => [p.id, p.label]), doc.points.map(p => [p.id, p.label]));
  assert.deepEqual(new Set(labelWarnings(restored).flatMap(w => w.ids)), new Set(doc.points.map(p => p.id)));
});

test('remeasurement accepts unchanged legacy names and retains identity and metadata', () => {
  for (const label of ['A', 'duplicate', '', 'x'.repeat(50)]) {
    const source = point(label, { description: 'Deep end', note: 'Check sag', needsRemeasure: true });
    const doc = { ...defaultDocument(), points: [source, point('duplicate')] };
    const result = reviewMeasurements([{ id: 'untrusted-row-id', label, first: '2', second: '2' }], doc, { mode: 'distances', existingPointId: source.id });
    assert.equal(result.valid, true);
    assert.equal(result.document.points.length, 2);
    assert.equal(result.rows[0].point.id, source.id);
    assert.equal(result.rows[0].point.label, label);
    assert.equal(result.rows[0].point.description, 'Deep end');
    assert.equal(result.rows[0].point.note, 'Check sag');
    assert.equal(result.rows[0].point.needsRemeasure, true);
    assert.deepEqual(doc.points[0].position, { x: 200, y: 300 });
  }
});

test('remeasurement still rejects impossible geometry and changed conflicting labels', () => {
  const source = point('A'), doc = { ...defaultDocument(), points: [source, point('Taken')] };
  for (const row of [{ label: 'A', first: '0.1', second: '0.1' }, { label: 'taken', first: '2', second: '2' }]) {
    const result = reviewMeasurements([row], doc, { mode: 'distances', existingPointId: source.id });
    assert.equal(result.valid, false);
    assert.deepEqual(result.document.points, doc.points);
  }
  assert.throws(() => reviewMeasurements([], doc, { existingPointId: source.id }), /one existing point/);
  const duplicateRows = reviewMeasurements([{ label: '3', first: '1', second: '1' }, { label: ' 3 ', first: '1', second: '1' }], doc);
  assert.equal(duplicateRows.valid, false); assert.match(duplicateRows.rows[1].error, /Duplicate/);
});

test('descriptions stay separate from notes across JSON and photo project round trips', () => {
  const source = point('12', { description: 'Échelle, "shallow" <corner>', note: 'Check next visit' });
  const doc = { ...defaultDocument(), points: [source] };
  const photo = { name: 'pool.png', dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 600, pins: { [source.id]: { x: 800, y: 500 } }, settings: photoSettings() };
  assert.deepEqual(parseDocument(serializeDocument(doc)), doc);
  const restored = parsePhotoProject(serializePhotoProject(doc, photo));
  assert.deepEqual(restored.document, doc); assert.deepEqual(restored.photo.pins, photo.pins);
  doc.points.reverse(); doc.points[0].label = '13';
  assert.deepEqual(parsePhotoProject(serializePhotoProject(doc, photo)).photo.pins, photo.pins);
  assert.equal(normalizePointDescription('x'.repeat(121)).length, 120);
  assert.equal(normalizePointDescription({ text: 'bad' }), '');
  assert.equal(Object.hasOwn(JSON.parse(serializeDocument({ ...doc, points: [point('1', { description: ' ' })] })).points[0], 'description'), false);
});
