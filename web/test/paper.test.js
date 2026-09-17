import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MM_PER_PX,
  PAPER_SIZES,
  SCALE_RATIOS,
  drawingArea,
  fitScale,
  formatScale,
  mmPerMeter,
  sheetSize,
} from '../src/paper.js';

describe('sheetSize', () => {
  it('turns the sheet for landscape', () => {
    assert.deepEqual(sheetSize('a4'), { width: 210, height: 297 });
    assert.deepEqual(sheetSize('a4', 'landscape'), { width: 297, height: 210 });
  });

  it('refuses a size it does not know', () => {
    assert.throws(() => sheetSize('a9'), /Unknown paper size/);
  });
});

describe('mmPerMeter', () => {
  it('is the definition of the scale', () => {
    assert.equal(mmPerMeter(100), 10); // 1:100 -- a metre is 10 mm
    assert.equal(mmPerMeter(50), 20);
    assert.equal(mmPerMeter(1000), 1);
  });
});

describe('drawingArea', () => {
  it('takes out the margins and the caption strip', () => {
    const area = drawingArea('a4', 'landscape', { margin: 12, footer: 16 });
    assert.deepEqual(area, { width: 297 - 24, height: 210 - 24 - 16 });
  });
});

describe('fitScale', () => {
  const area = drawingArea('a4', 'landscape'); // 273 x 170 mm

  it('picks the largest standard scale the plot fits at', () => {
    // 20 x 10 m needs 200 x 100 mm at 1:100 -- fits; 1:50 would need 400 mm.
    assert.equal(fitScale({ widthMeters: 20, heightMeters: 10 }, area), 100);
    // 2 x 1 m fits at 1:10 (200 x 100 mm) but not 1:5.
    assert.equal(fitScale({ widthMeters: 2, heightMeters: 1 }, area), 10);
  });

  it('is limited by whichever dimension runs out first', () => {
    // Narrow but tall: the height forces the coarser scale.
    assert.equal(fitScale({ widthMeters: 1, heightMeters: 16 }, area), 100);
  });

  it('gives up rather than inventing a scale', () => {
    assert.equal(fitScale({ widthMeters: 10000, heightMeters: 10000 }, area), null);
  });

  it('only ever returns a ratio from the standard list', () => {
    for (const size of [0.5, 3, 17, 140, 850]) {
      const ratio = fitScale({ widthMeters: size, heightMeters: size }, area);
      assert.ok(SCALE_RATIOS.includes(ratio), `${ratio} is not a standard scale`);
    }
  });

  it('never claims a fit it does not have', () => {
    for (const size of [0.5, 3, 17, 140, 850, 4000]) {
      const ratio = fitScale({ widthMeters: size, heightMeters: size }, area);
      if (ratio === null) continue;
      assert.ok(size * mmPerMeter(ratio) <= area.height, `${size} m does not fit at 1:${ratio}`);
    }
  });
});

describe('constants', () => {
  it('uses SVG\'s own 96 dpi pixel', () => {
    assert.equal(MM_PER_PX * 96, 25.4);
  });

  it('states scales the way a drawing does', () => {
    assert.equal(formatScale(100), '1:100');
  });

  it('lists paper sizes portrait, in millimetres', () => {
    for (const size of Object.values(PAPER_SIZES)) {
      assert.ok(size.height > size.width, `${size.label} should be portrait`);
    }
  });
});
