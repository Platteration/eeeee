import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitPhotoProjection, photoSettings, overlayGeometry, photoOverlaySvg, parsePhotoProject, serializePhotoProject } from '../src/photoOverlay.js';
import { defaultDocument, newId, serializeDocument } from '../src/plotDocument.js';

const photo = () => ({ name: 'pool.png', dataUrl: 'data:image/png;base64,AAAA', width: 1000, height: 600, pins: {}, settings: photoSettings() });
test('four perspective correspondences project a fifth measured point accurately', () => {
  const map = ({ x, y }) => ({ x: (2 * x + 0.4 * y + 100) / (0.002 * x + 0.001 * y + 1), y: (0.2 * x + 1.5 * y + 70) / (0.002 * x + 0.001 * y + 1) });
  const positions = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
  const result = fitPhotoProjection(positions.map(position => ({ position, photo: map(position) })));
  const p = { x: 90, y: 40 }, projected = result.project(p), expected = map(p);
  assert.ok(Math.hypot(projected.x - expected.x, projected.y - expected.y) < 1e-7);
  assert.ok(result.error < 1e-7);
});
test('degenerate photo matches fail clearly instead of inventing perspective', () => {
  assert.throws(() => fitPhotoProjection([]), /four points/);
  assert.throws(() => fitPhotoProjection([0, 1, 2, 3].map(x => ({ position: { x, y: 0 }, photo: { x: x * 100, y: 10 } }))), /two directions/);
});
test('matching markers and drawing an outline never mutate measured geometry', () => {
  const doc = defaultDocument(), p = photo();
  doc.points = [{ id: newId(), label: 'Oak <gate>', position: { x: 200, y: 300 } }, { id: newId(), label: '2', position: { x: 300, y: 300 } }];
  p.pins[doc.points[0].id] = { x: 800, y: 500 }; p.pins[doc.points[1].id] = { x: 700, y: 200 };
  const before = serializeDocument(doc), markup = photoOverlaySvg(doc, p);
  assert.ok(markup.includes('Oak &lt;gate&gt;')); assert.ok(markup.includes('<image')); assert.ok(markup.includes('<line'));
  assert.equal(serializeDocument(doc), before); assert.equal(overlayGeometry(doc, p).points.length, 2);
});
test('photo projects round-trip independently of the iOS plot JSON contract', () => {
  const doc = defaultDocument(), p = photo(); p.pins.A = { x: 25, y: 40 };
  const restored = parsePhotoProject(serializePhotoProject(doc, p));
  assert.deepEqual(restored.document, doc); assert.deepEqual(restored.photo, p);
  assert.equal(JSON.parse(serializeDocument(doc)).photo, undefined);
});
test('photo project validation rejects unsafe image types and out-of-image matches', () => {
  const doc = defaultDocument(), p = photo(); p.dataUrl = 'data:image/svg+xml;base64,AAAA';
  assert.throws(() => parsePhotoProject(serializePhotoProject(doc, p)), /embedded PNG/);
  p.dataUrl = 'data:image/png;base64,AAAA'; p.pins.A = { x: Infinity, y: 0 };
  assert.throws(() => parsePhotoProject(serializePhotoProject(doc, p)), /outside the image/);
});
