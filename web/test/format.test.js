import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatCompact, formatLength, formatSigned, fromMeters, niceStep, toMeters } from '../src/format.js';

describe('unit conversion', () => {
  it('round-trips through meters', () => {
    assert.equal(fromMeters(3.048, 'feet').toFixed(6), '10.000000');
    assert.equal(toMeters(10, 'feet'), 3.048);
    assert.equal(fromMeters(7, 'meters'), 7);
  });
});

describe('formatLength', () => {
  it('renders in the document unit', () => {
    assert.equal(formatLength(3.048, 'feet'), '10.00 ft');
    assert.equal(formatLength(2, 'meters'), '2.00 m');
    assert.equal(formatLength(2, 'meters', { withUnit: false }), '2.00');
    assert.equal(formatLength(2.34567, 'meters', { digits: 3 }), '2.346 m');
  });

  it('never renders a measurement as "-0.00"', () => {
    assert.equal(formatLength(-0.0001, 'meters'), '0.00 m');
  });

  it('dashes out values it cannot know', () => {
    assert.equal(formatLength(null, 'meters'), '—');
    assert.equal(formatLength(Number.NaN, 'meters'), '—');
  });
});

describe('formatSigned', () => {
  it('keeps the side of the baseline visible', () => {
    assert.equal(formatSigned(2, 'meters'), '+2.00 m');
    assert.equal(formatSigned(-2, 'meters'), '-2.00 m');
    assert.equal(formatSigned(0, 'meters'), '0.00 m');
    assert.equal(formatSigned(null, 'meters'), '—');
  });
});

describe('niceStep', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    assert.deepEqual([0.03, 0.11, 0.6, 1, 1.5, 3, 7, 12, 260].map(niceStep), [0.05, 0.2, 1, 1, 2, 5, 10, 20, 500]);
  });

  it('falls back to 1 for values that cannot be stepped', () => {
    assert.equal(niceStep(0), 1);
    assert.equal(niceStep(-5), 1);
    assert.equal(niceStep(Number.NaN), 1);
  });
});

describe('formatCompact', () => {
  it('drops trailing zeros', () => {
    assert.equal(formatCompact(1), '1');
    assert.equal(formatCompact(0.5), '0.5');
    assert.equal(formatCompact(2.000001), '2');
  });
});

describe('rounding to zero', () => {
  it('does not dress a value that displays as zero with a sign', () => {
    assert.equal(formatSigned(0.0001, 'meters'), '0.00 m');
    assert.equal(formatSigned(-0.0001, 'meters'), '0.00 m');
  });
});
