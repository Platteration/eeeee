import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toCsv, toSvg } from '../src/exporters.js';

const doc = {
  pointA: { x: 100, y: 300 },
  pointB: { x: 300, y: 300 },
  abDistance: 4,
  unit: 'meters',
  points: [
    { id: 'p1', label: '1', position: { x: 200, y: 200 } },
    { id: 'p2', label: 'oak, "big"', position: { x: 300, y: 400 } },
  ],
};

/**
 * A minimal well-formedness check: every element that opens is closed, in
 * order, and nothing is left open at the end.
 */
function assertBalancedTags(markup) {
  const stack = [];
  for (const [, closing, name, selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (selfClosing === '/') continue;
    if (closing === '/') assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], 'every element should be closed');
}

describe('toCsv', () => {
  it('writes a header and one row per point', () => {
    const lines = toCsv(doc).trim().split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^label,canvas_x,canvas_y,s_along_ab,t_perpendicular,along_m,perpendicular_m,from_a_m,from_b_m$/);
    const [label, x, y, s, t, along, perp, fromA, fromB] = lines[1].split(',');
    assert.deepEqual([label, x, y], ['1', '200.00', '200.00']);
    assert.equal(Number(s), 0.5);
    assert.equal(Number(t), -0.5);
    assert.equal(Number(along), 2);
    assert.equal(Number(perp), -2);
    assert.equal(Number(fromA).toFixed(3), '2.828');
    assert.equal(Number(fromB).toFixed(3), '2.828');
  });

  it('quotes labels containing commas and quotes', () => {
    assert.match(toCsv(doc), /^"oak, ""big""",/m);
  });

  it('names the columns after the document unit and converts into it', () => {
    const csv = toCsv({ ...doc, unit: 'feet' });
    assert.match(csv.split('\n')[0], /along_ft/);
    // 4 ft declared => the point sits half a baseline along, i.e. 2 ft.
    assert.equal(Number(csv.split('\n')[1].split(',')[5]), 2);
  });

  it('leaves measurement columns empty when there is no baseline', () => {
    const csv = toCsv({ ...doc, abDistance: 0 });
    assert.deepEqual(csv.split('\n')[1].split(','), ['1', '200.00', '200.00', '', '', '', '', '', '']);
  });
});

describe('toSvg', () => {
  const markup = toSvg(doc);

  it('is a standalone, well-formed SVG document', () => {
    assert.match(markup, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(markup.trim(), /<\/svg>$/);
    assertBalancedTags(markup);
    assert.doesNotMatch(markup, /<(link|style|image)\b/, 'nothing should be loaded from outside the file');
  });

  it('honours the requested width and keeps the plot proportional', () => {
    const wide = toSvg(doc, { width: 600 });
    const [, width, height] = wide.match(/width="(\d+)" height="(\d+)"/);
    assert.equal(Number(width), 600);
    // The plot is 200 x 200 canvas units, so the drawing is square; the extra
    // height is the fixed padding and footer strip.
    assert.ok(Number(height) > Number(width) - 200, `unexpected height ${height}`);
  });

  it('draws every point and both reference handles', () => {
    assert.equal(markup.match(/<circle/g).length, doc.points.length + 2);
    assert.match(markup, />A</);
    assert.match(markup, />B</);
  });

  it('escapes labels rather than injecting markup', () => {
    const hostile = toSvg({ ...doc, points: [{ id: 'x', label: '<script>&"', position: { x: 150, y: 250 } }] });
    assert.match(hostile, /&lt;script&gt;&amp;&quot;/);
    assert.doesNotMatch(hostile, /<script>/);
    assertBalancedTags(hostile);
  });

  it('captions the drawing with the declared distance and extent', () => {
    assert.match(markup, /A–B 4\.00 m/);
    assert.match(markup, /2 points/);
    assert.match(markup, /extent 4\.00 m × 4\.00 m/);
  });

  it('draws the measuring grid and names its interval', () => {
    assert.ok(markup.match(/stroke="#e5e5ea"/g).length > 4, 'expected grid lines');
    assert.match(markup, /grid \d/);
    const plain = toSvg(doc, { showGrid: false });
    assert.equal(plain.match(/stroke="#e5e5ea"/g), null);
    assert.doesNotMatch(plain, /grid \d/);
  });

  it('can label each point with its own measurements', () => {
    const annotated = toSvg(doc, { annotate: true });
    assert.match(annotated, /\+2\.00, -2\.00/);
    assert.match(annotated, /labelled along, across/);
    assertBalancedTags(annotated);
    // Off by default, so a plain plan stays uncluttered.
    assert.doesNotMatch(markup, /\+2\.00, -2\.00/);
  });

  it('leaves points it cannot measure unlabelled', () => {
    const unscaled = toSvg({ ...doc, abDistance: 0 }, { annotate: true });
    assert.doesNotMatch(unscaled, /labelled along/);
    assertBalancedTags(unscaled);
  });

  it('omits the scale bar when the plot has no scale', () => {
    const unscaled = toSvg({ ...doc, abDistance: 0 });
    assertBalancedTags(unscaled);
    assert.doesNotMatch(unscaled, /<line[^>]*stroke="#1c1c1e"/);
  });
});
