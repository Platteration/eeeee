import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_CANVAS_AB_DISTANCE,
  abCoordinates,
  canvasABLength,
  canvasPoint,
  hasValidBaseline,
  worldOffset,
} from '../src/plotMath.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} !== ${expected} (±${tolerance})`);

describe('abCoordinates', () => {
  it('reproduces the worked example from PlotMath.swift', () => {
    // A=(100,300), B=(300,300), P=(200,200) above the baseline => s=0.5, t=-0.5.
    const ab = abCoordinates({ x: 200, y: 200 }, { x: 100, y: 300 }, { x: 300, y: 300 });
    close(ab.s, 0.5);
    close(ab.t, -0.5);
  });

  it('puts A at (0, 0) and B at (1, 0)', () => {
    const a = { x: 40, y: 90 };
    const b = { x: -20, y: 15 };
    const atA = abCoordinates(a, a, b);
    const atB = abCoordinates(b, a, b);
    close(atA.s, 0);
    close(atA.t, 0);
    close(atB.s, 1);
    close(atB.t, 0);
  });

  it('reads canvas-down as positive t', () => {
    const { t } = abCoordinates({ x: 200, y: 400 }, { x: 100, y: 300 }, { x: 300, y: 300 });
    assert.ok(t > 0, 'a point below a left-to-right baseline should have positive t');
  });

  it('is invariant under translation, rotation and scaling of the canvas', () => {
    const a = { x: 100, y: 300 };
    const b = { x: 300, y: 340 };
    const p = { x: 170, y: 210 };
    const reference = abCoordinates(p, a, b);

    const transform = ({ x, y }) => {
      const angle = 0.7;
      const scale = 3.5;
      return {
        x: 12 + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
        y: -40 + scale * (x * Math.sin(angle) + y * Math.cos(angle)),
      };
    };
    const moved = abCoordinates(transform(p), transform(a), transform(b));
    close(moved.s, reference.s, 1e-9);
    close(moved.t, reference.t, 1e-9);
  });

  it('returns null when A and B are too close to define a frame', () => {
    const a = { x: 10, y: 10 };
    assert.equal(abCoordinates({ x: 5, y: 5 }, a, a), null);
    assert.equal(abCoordinates({ x: 5, y: 5 }, a, { x: 10.5, y: 10 }), null);
    assert.notEqual(abCoordinates({ x: 5, y: 5 }, a, { x: 12, y: 10 }), null);
  });
});

describe('canvasPoint', () => {
  it('inverts abCoordinates', () => {
    const a = { x: -30, y: 220 };
    const b = { x: 410, y: 55 };
    for (const p of [{ x: 0, y: 0 }, { x: 200, y: 200 }, { x: -100, y: 640 }]) {
      const back = canvasPoint(abCoordinates(p, a, b), a, b);
      close(back.x, p.x, 1e-9);
      close(back.y, p.y, 1e-9);
    }
  });
});

describe('baseline helpers', () => {
  it('measures the canvas baseline', () => {
    close(canvasABLength({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });

  it('agrees with abCoordinates about degenerate baselines', () => {
    const a = { x: 0, y: 0 };
    const just = { x: MIN_CANVAS_AB_DISTANCE, y: 0 };
    assert.equal(hasValidBaseline(a, just), false);
    assert.equal(abCoordinates({ x: 1, y: 1 }, a, just), null);
    assert.equal(hasValidBaseline(a, { x: 2, y: 0 }), true);
  });
});

describe('worldOffset', () => {
  it('scales normalized coordinates by the declared distance', () => {
    assert.deepEqual(worldOffset(0.5, -0.5, 4), { along: 2, perp: -2 });
  });
});
