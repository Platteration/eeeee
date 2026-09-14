import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  abDistanceMeters,
  changeUnit,
  createPoint,
  defaultDocument,
  fileStem,
  newId,
  nextLabel,
  parseDocument,
  serializeDocument,
  toWireFormat,
} from '../src/plotDocument.js';

/** Exactly what the iOS app writes to `plot.json` (CGPoint encodes as [x, y]). */
const iosFile = `{
  "pointA": [100, 400],
  "pointB": [300, 400],
  "abDistance": 2.5,
  "unit": "feet",
  "points": [
    { "id": "8F3B0C1E-1111-4222-8333-444455556666", "position": [200, 300], "label": "1" },
    { "id": "8F3B0C1E-1111-4222-8333-444455556667", "position": [250, 355.5], "label": "2" }
  ]
}`;

describe('parseDocument', () => {
  it('reads the iOS wire format', () => {
    const doc = parseDocument(iosFile);
    assert.deepEqual(doc.pointA, { x: 100, y: 400 });
    assert.deepEqual(doc.pointB, { x: 300, y: 400 });
    assert.equal(doc.abDistance, 2.5);
    assert.equal(doc.unit, 'feet');
    assert.equal(doc.points.length, 2);
    assert.deepEqual(doc.points[1].position, { x: 250, y: 355.5 });
    assert.equal(doc.points[0].id, '8F3B0C1E-1111-4222-8333-444455556666');
  });

  it('also accepts points written as {x, y} objects', () => {
    const doc = parseDocument({
      pointA: { x: 1, y: 2 },
      pointB: { x: 3, y: 4 },
      abDistance: 1,
      unit: 'meters',
      points: [{ position: { x: 5, y: 6 } }],
    });
    assert.deepEqual(doc.pointA, { x: 1, y: 2 });
    assert.deepEqual(doc.points[0].position, { x: 5, y: 6 });
  });

  it('fills in the parts a hand-written file may omit', () => {
    const doc = parseDocument({ pointA: [0, 0], pointB: [10, 0], abDistance: 3 });
    assert.equal(doc.unit, 'meters');
    assert.deepEqual(doc.points, []);

    const labelled = parseDocument({ pointA: [0, 0], pointB: [10, 0], abDistance: 3, points: [{ position: [1, 1] }] });
    assert.equal(labelled.points[0].label, '1');
    assert.match(labelled.points[0].id, /^[0-9A-F-]{36}$/);
  });

  it('accepts an unscaled plot, since the iOS app can save one', () => {
    assert.equal(parseDocument({ pointA: [0, 0], pointB: [10, 0], abDistance: 0 }).abDistance, 0);
  });

  it('rejects what it cannot honestly interpret', () => {
    const cases = [
      ['not json at all', /Not valid JSON/],
      ['[1, 2, 3]', /Expected a JSON object/],
      [{ pointA: [0, 0], pointB: [1, 0], abDistance: 1, unit: 'cubits' }, /Unknown unit/],
      [{ pointA: [0, 0], pointB: [1, 0], abDistance: -4 }, /non-negative/],
      [{ pointA: [0, 0], pointB: [1, 0], abDistance: 'far' }, /non-negative/],
      [{ pointA: [0, 0], abDistance: 1 }, /pointB must be/],
      [{ pointA: ['a', 'b'], pointB: [1, 0], abDistance: 1 }, /pointA must be/],
      [{ pointA: [0, 0], pointB: [1, 0], abDistance: 1, points: {} }, /points must be an array/],
      [{ pointA: [0, 0], pointB: [1, 0], abDistance: 1, points: [{ position: [0] }] }, /points\[0\]\.position/],
    ];
    for (const [input, message] of cases) {
      assert.throws(() => parseDocument(input), message, `should have rejected ${JSON.stringify(input)}`);
    }
  });

  it('copies rather than aliases its input', () => {
    const raw = { pointA: [0, 0], pointB: [10, 0], abDistance: 1, points: [{ position: [2, 2], label: 'x' }] };
    const doc = parseDocument(raw);
    doc.points[0].position.x = 99;
    doc.pointA.x = 99;
    assert.deepEqual(raw.points[0].position, [2, 2]);
    assert.deepEqual(raw.pointA, [0, 0]);
  });
});

describe('serializeDocument', () => {
  it('writes CGPoints as arrays, the way Foundation decodes them', () => {
    const wire = JSON.parse(serializeDocument(parseDocument(iosFile)));
    assert.deepEqual(wire.pointA, [100, 400]);
    assert.deepEqual(wire.points[0].position, [200, 300]);
    assert.equal(wire.unit, 'feet');
  });

  it('keeps each coordinate pair on one line', () => {
    const text = serializeDocument(parseDocument(iosFile));
    assert.match(text, /"pointA": \[100, 400\]/);
    assert.match(text, /"position": \[250, 355\.5\]/);
    assert.deepEqual(JSON.parse(text).points[1].position, [250, 355.5], 'still valid JSON');
  });

  it('can write without pretty-printing', () => {
    const text = serializeDocument(parseDocument(iosFile), { pretty: false });
    assert.doesNotMatch(text, /\n/);
    assert.deepEqual(JSON.parse(text).pointB, [300, 400]);
  });

  it('round-trips an iOS file unchanged', () => {
    const once = parseDocument(iosFile);
    const twice = parseDocument(serializeDocument(once));
    assert.deepEqual(twice, once);
    assert.deepEqual(toWireFormat(twice), JSON.parse(iosFile));
  });
});

describe('labels and ids', () => {
  it('numbers new points above the highest number already used', () => {
    assert.equal(nextLabel([]), '1');
    assert.equal(nextLabel([{ label: '1' }, { label: '7' }, { label: '3' }]), '8');
    assert.equal(nextLabel([{ label: 'porch' }, { label: '2' }]), '3');
  });

  it('creates points with a fresh uppercase UUID', () => {
    const point = createPoint({ x: 5, y: 6 }, []);
    assert.deepEqual(point.position, { x: 5, y: 6 });
    assert.equal(point.label, '1');
    assert.match(point.id, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    assert.notEqual(newId(), newId());
  });
});

describe('abDistanceMeters', () => {
  it('switches units without changing geometry or physical measurements, including a round trip', () => {
    const doc = parseDocument(iosFile);
    const before = structuredClone(doc);
    changeUnit(doc, 'meters');
    assert.equal(doc.abDistance, 2.5 * 0.3048);
    assert.deepEqual(doc.points, before.points);
    assert.deepEqual(doc.pointA, before.pointA);
    changeUnit(doc, 'feet');
    assert.ok(Math.abs(doc.abDistance - before.abDistance) < 1e-12);
    assert.throws(() => changeUnit(doc, 'cubits'), /Unknown/);
  });
  it('converts feet to meters', () => {
    assert.equal(abDistanceMeters({ ...defaultDocument(), abDistance: 10, unit: 'feet' }), 3.048);
    assert.equal(abDistanceMeters({ ...defaultDocument(), abDistance: 10, unit: 'meters' }), 10);
  });
});

describe('plot names', () => {
  it('keeps a name when a file carries one', () => {
    assert.equal(parseDocument({ ...JSON.parse(iosFile), name: 'North lawn' }).name, 'North lawn');
    assert.equal(parseDocument(iosFile).name, '');
  });

  it('writes no name key at all when there is none, matching the phone byte for byte', () => {
    const wire = JSON.parse(serializeDocument(parseDocument(iosFile)));
    assert.ok(!('name' in wire));
    assert.deepEqual(wire, JSON.parse(iosFile));
  });

  it('writes the name first when there is one, where the phone will ignore it', () => {
    const text = serializeDocument({ ...parseDocument(iosFile), name: 'North lawn' });
    assert.match(text, /^\{\n {2}"name": "North lawn",/);
    assert.equal(parseDocument(text).name, 'North lawn');
  });

  it('makes a filesystem-safe stem out of the name', () => {
    const stem = (name) => fileStem({ name });
    assert.equal(stem('North lawn'), 'north-lawn');
    assert.equal(stem('  Site 3: fence/posts  '), 'site-3-fenceposts');
    assert.equal(stem('Café Ø'), 'cafe');
    assert.equal(stem(''), 'plot');
    assert.equal(stem('///'), 'plot');
    assert.equal(fileStem({}), 'plot');
    assert.ok(stem('x'.repeat(200)).length <= 60);
  });
});

describe('portable imports', () => {
  it('repairs invalid and duplicate IDs without losing points, preserving valid IDs', () => {
    const raw = JSON.parse(iosFile);
    raw.points[0].id = raw.points[0].id.toLowerCase();
    raw.points.push({ ...raw.points[1] }, { ...raw.points[0], id: 'legacy-point' });
    const doc = parseDocument(raw);
    assert.equal(doc.points.length, 4);
    assert.equal(new Set(doc.points.map((p) => p.id)).size, 4);
    for (const p of doc.points) assert.match(p.id, /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/);
    assert.deepEqual(parseDocument(serializeDocument(doc)), doc);
  });
  it('rejects empty, null, boolean, and text distances instead of treating them as zero', () => {
    for (const abDistance of [null, '', false, '3']) {
      assert.throws(() => parseDocument({ ...JSON.parse(iosFile), abDistance }), /non-negative/);
    }
  });
  it('does not overflow or partially parse point labels', () => {
    assert.equal(nextLabel([{ label: '99 trees' }, { label: '2' }]), '3');
    assert.equal(nextLabel([{ label: String(Number.MAX_SAFE_INTEGER) }, { label: '1' }]), '2');
  });
});
