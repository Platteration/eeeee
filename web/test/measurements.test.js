import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  distanceMeters,
  isMeasurable,
  measurePoints,
  metersPerCanvasUnit,
  plotExtent,
  positionForOffsets,
} from '../src/measurements.js';

/** The PlotMath.swift worked example: A-B is 4 m, one point above the baseline. */
const doc = {
  pointA: { x: 100, y: 300 },
  pointB: { x: 300, y: 300 },
  abDistance: 4,
  unit: 'meters',
  points: [{ id: 'p1', label: '1', position: { x: 200, y: 200 } }],
};

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} !== ${expected} (±${tolerance})`);

describe('isMeasurable', () => {
  it('needs both a baseline and a declared distance', () => {
    assert.equal(isMeasurable(doc), true);
    assert.equal(isMeasurable({ ...doc, abDistance: 0 }), false);
    assert.equal(isMeasurable({ ...doc, pointB: { x: 100, y: 300 } }), false);
  });
});

describe('measurePoints', () => {
  it('gives the AR local coordinates the iOS app would place', () => {
    const [row] = measurePoints(doc);
    close(row.s, 0.5);
    close(row.t, -0.5);
    close(row.along, 2);
    close(row.perp, -2);
    close(row.fromA, Math.hypot(2, 2));
    close(row.fromB, Math.hypot(2, 2));
    assert.equal(row.fromReference, null);
  });

  it('respects the document unit when converting to meters', () => {
    const [row] = measurePoints({ ...doc, abDistance: 4, unit: 'feet' });
    close(row.along, 2 * 0.3048, 1e-12);
  });

  it('measures against a reference point when given one', () => {
    const [row] = measurePoints(doc, { x: 100, y: 300 });
    close(row.fromReference, Math.hypot(2, 2));
  });

  it('reports nulls rather than nonsense without a usable baseline', () => {
    const [row] = measurePoints({ ...doc, pointB: { x: 100, y: 300 } });
    assert.deepEqual(
      { s: row.s, along: row.along, fromA: row.fromA },
      { s: null, along: null, fromA: null },
    );
    assert.equal(row.label, '1');
  });
});

describe('metersPerCanvasUnit and distanceMeters', () => {
  it('derives the scale from the declared distance', () => {
    close(metersPerCanvasUnit(doc), 0.02); // 4 m over 200 canvas units
    assert.equal(metersPerCanvasUnit({ ...doc, abDistance: 0 }), null);
  });

  it('measures between arbitrary canvas points', () => {
    close(distanceMeters(doc, { x: 0, y: 0 }, { x: 300, y: 400 }), 10);
    assert.equal(distanceMeters({ ...doc, abDistance: 0 }, doc.pointA, doc.pointB), null);
  });
});

describe('plotExtent', () => {
  it('covers the baseline as well as the points', () => {
    assert.deepEqual(plotExtent(doc), { along: 4, perp: 2, count: 1 });
  });

  it('grows to fit points beyond B', () => {
    const wider = { ...doc, points: [...doc.points, { id: 'p2', label: '2', position: { x: 400, y: 400 } }] };
    const extent = plotExtent(wider);
    close(extent.along, 6); // A at 0 m, the far point at 6 m along
    close(extent.perp, 4); // 2 m above the baseline to 2 m below
    assert.equal(extent.count, 2);
  });

  it('is null when there is nothing to measure', () => {
    assert.equal(plotExtent({ ...doc, points: [] }), null);
    assert.equal(plotExtent({ ...doc, abDistance: 0 }), null);
  });
});

describe('positionForOffsets', () => {
  it('is the exact inverse of the along/perp a row reports', () => {
    for (const original of [{ x: 200, y: 200 }, { x: -40, y: 610 }, { x: 300, y: 300 }]) {
      const one = { ...doc, points: [{ id: 'p', label: '1', position: original }] };
      const [row] = measurePoints(one);
      const back = positionForOffsets(one, { along: row.along, perp: row.perp });
      close(back.x, original.x, 1e-9);
      close(back.y, original.y, 1e-9);
    }
  });

  it('places a point by tape measurements alone', () => {
    // 3 m along the baseline from A, 1 m below it: 200 units per 4 m.
    assert.deepEqual(positionForOffsets(doc, { along: 3, perp: 1 }), { x: 250, y: 350 });
  });

  it('works the same on a rotated baseline', () => {
    const rotated = { ...doc, pointB: { x: 100, y: 500 } }; // A->B points down the canvas
    const at = positionForOffsets(rotated, { along: 4, perp: 0 });
    close(at.x, rotated.pointB.x, 1e-9);
    close(at.y, rotated.pointB.y, 1e-9);
  });

  it('declines without a scale', () => {
    assert.equal(positionForOffsets({ ...doc, abDistance: 0 }, { along: 1, perp: 1 }), null);
  });
});
