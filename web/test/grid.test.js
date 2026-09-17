import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { abGrid } from '../src/grid.js';

/** 200 canvas units of baseline standing for 4 m: 50 units per metre. */
const doc = { pointA: { x: 100, y: 300 }, pointB: { x: 300, y: 300 }, abDistance: 4, unit: 'meters', points: [] };
const box = { x: 100, y: 200, w: 200, h: 200 };

describe('abGrid', () => {
  it('spaces lines at a round real-world interval', () => {
    const grid = abGrid(doc, box, 50); // ask for at least 1 m of spacing
    assert.equal(grid.stepMeters, 1);
    // 5 lines each way across a 4 m x 4 m window, inclusive of both edges.
    assert.equal(grid.lines.length, 10);
  });

  it('rounds the requested spacing up to 1, 2 or 5 times a power of ten', () => {
    assert.equal(abGrid(doc, box, 60).stepMeters, 2); // 1.2 m -> 2 m
    assert.equal(abGrid(doc, box, 130).stepMeters, 5); // 2.6 m -> 5 m
  });

  it('lays the grid along the baseline, not the screen', () => {
    const tilted = { ...doc, pointB: { x: 300, y: 500 } };
    const grid = abGrid(tilted, { x: -200, y: -200, w: 800, h: 1000 }, 60);
    const baseline = { x: tilted.pointB.x - tilted.pointA.x, y: tilted.pointB.y - tilted.pointA.y };
    for (const line of grid.lines) {
      const along = { x: line.x2 - line.x1, y: line.y2 - line.y1 };
      const cross = Math.abs(along.x * baseline.y - along.y * baseline.x);
      const dot = Math.abs(along.x * baseline.x + along.y * baseline.y);
      assert.ok(
        cross < 1e-6 || dot < 1e-6,
        'every line should be parallel or perpendicular to the baseline',
      );
    }
  });

  it('marks the two lines through A as axes', () => {
    const grid = abGrid(doc, box, 50);
    const axes = grid.lines.filter((line) => line.axis);
    assert.equal(axes.length, 2);
    for (const axis of axes) {
      // The line through A: A must lie on it.
      const cross =
        (axis.x2 - axis.x1) * (doc.pointA.y - axis.y1) - (axis.y2 - axis.y1) * (doc.pointA.x - axis.x1);
      assert.ok(Math.abs(cross) < 1e-6, 'an axis should pass through A');
    }
  });

  it('covers the whole visible box', () => {
    const grid = abGrid(doc, box, 50);
    const xs = grid.lines.flatMap((line) => [line.x1, line.x2]);
    const ys = grid.lines.flatMap((line) => [line.y1, line.y2]);
    assert.ok(Math.min(...xs) <= box.x && Math.max(...xs) >= box.x + box.w);
    assert.ok(Math.min(...ys) <= box.y && Math.max(...ys) >= box.y + box.h);
  });

  it('declines to draw without a scale', () => {
    assert.equal(abGrid({ ...doc, abDistance: 0 }, box, 50), null);
    assert.equal(abGrid({ ...doc, pointB: { x: 100, y: 300 } }, box, 50), null);
  });

  it('declines rather than emitting thousands of lines', () => {
    assert.equal(abGrid(doc, box, 1e-9), null);
  });
});
