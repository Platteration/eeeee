import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { distanceMeters, isMeasurable, measurePoints, metersPerCanvasUnit, plotExtent } from '../src/measurements.js';

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
