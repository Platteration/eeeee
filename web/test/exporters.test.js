import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planContentSize, rasterSize, toCsv, toSvg } from '../src/exporters.js';
import { drawingArea, fitScale } from '../src/paper.js';

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

describe('toSvg on paper', () => {
  /** Millimetres of paper per canvas unit, read back off the finished sheet. */
  function millimetresPerUnit(markup) {
    const width = Number(markup.match(/width="([\d.]+)mm"/)[1]);
    const view = markup.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
    return width / Number(view[3]);
  }

  it('draws at a true scale: 1:100 makes a 4 m baseline 40 mm of paper', () => {
    const sheet = toSvg(doc, { paper: 'a4', scale: 100 });
    const perUnit = millimetresPerUnit(sheet);
    const baseline = Math.hypot(doc.pointB.x - doc.pointA.x, doc.pointB.y - doc.pointA.y);
    assert.ok(Math.abs(baseline * perUnit - 40) < 0.01, `baseline measured ${baseline * perUnit} mm`);
  });

  it('halving the ratio doubles the ink', () => {
    const hundred = millimetresPerUnit(toSvg(doc, { paper: 'a4', scale: 100 }));
    const fifty = millimetresPerUnit(toSvg(doc, { paper: 'a4', scale: 50 }));
    assert.ok(Math.abs(fifty / hundred - 2) < 1e-9);
  });

  it('sizes the sheet in millimetres and turns it for orientation', () => {
    assert.match(toSvg(doc, { paper: 'a4' }), /width="297mm" height="210mm"/);
    assert.match(toSvg(doc, { paper: 'a4', orientation: 'portrait' }), /width="210mm" height="297mm"/);
    assert.match(toSvg(doc, { paper: 'a3' }), /width="420mm" height="297mm"/);
  });

  const chosenScale = (options) => Number(toSvg(doc, options).match(/1:(\d+)/)[1]);

  it('chooses the largest scale that fits when none is given', () => {
    assert.equal(chosenScale({ paper: 'a4' }), 50);
    // A bigger sheet takes a bigger drawing of the same plot.
    assert.ok(chosenScale({ paper: 'a3' }) < chosenScale({ paper: 'a4' }));
    // And turning the sheet changes which dimension runs out first.
    assert.notEqual(chosenScale({ paper: 'a4', orientation: 'portrait' }), chosenScale({ paper: 'a4' }));
  });

  it('draws a plot a hundred times bigger a hundred times smaller', () => {
    const huge = toSvg({ ...doc, abDistance: 400 }, { paper: 'a4' });
    assert.equal(Number(huge.match(/1:(\d+)/)[1]), 50 * 100);
  });

  it('states the scale on the drawing, and only when there is one', () => {
    assert.match(toSvg(doc, { paper: 'a4', scale: 100 }), /1:100 {2}·/);
    assert.doesNotMatch(toSvg(doc), /1:\d/);
  });

  it('falls back to a fitted picture rather than refusing to export', () => {
    // No scale to print at: the drawing is still produced, just not on paper.
    const unscaled = toSvg({ ...doc, abDistance: 0 }, { paper: 'a4' });
    assert.doesNotMatch(unscaled, /mm"/);
    assertBalancedTags(unscaled);
  });

  it('still draws a grid, points and the baseline on paper', () => {
    const sheet = toSvg(doc, { paper: 'a4', annotate: true });
    assert.equal(sheet.match(/<circle/g).length, doc.points.length + 2);
    assert.ok(sheet.match(/stroke="#e5e5ea"/g).length > 4);
    assert.match(sheet, /labelled along, across/);
    assertBalancedTags(sheet);
  });
});

describe('rasterSize', () => {
  it('gives a pixel sheet a retina multiplier', () => {
    const size = rasterSize(toSvg(doc, { width: 1000 }), { pixelRatio: 2, dpi: 300 });
    assert.equal(size.width, 2000);
  });

  it('rasterizes a paper sheet at print resolution', () => {
    // A4 landscape at 300 dpi is 3508 x 2480 px -- a printable image, not a
    // screenshot of one.
    const size = rasterSize(toSvg(doc, { paper: 'a4' }), { pixelRatio: 2, dpi: 300 });
    assert.deepEqual(size, { width: 3508, height: 2480 });
  });

  it('refuses a factor that would make an empty canvas', () => {
    // `scale` means the drawing ratio elsewhere in this module; passing it here
    // by mistake used to yield a 0x0 canvas and an unexplained encoding failure.
    const fitted = toSvg(doc, { width: 1000 });
    assert.throws(() => rasterSize(fitted, { pixelRatio: null, dpi: 300 }), /Cannot rasterize/);
    assert.throws(() => rasterSize(fitted, { pixelRatio: 0, dpi: 300 }), /Cannot rasterize/);
    assert.throws(() => rasterSize(toSvg(doc, { paper: 'a4' }), { pixelRatio: 2, dpi: 0 }), /Cannot rasterize/);
  });
});

describe('planContentSize', () => {
  it('is what the renderer actually lays out, so a prediction cannot drift', () => {
    for (const annotate of [false, true]) {
      for (const paper of ['a4', 'a3', 'letter']) {
        const content = planContentSize(doc, { annotate });
        const predicted = fitScale(content, drawingArea(paper, 'landscape'));
        const drawn = Number(toSvg(doc, { paper, annotate }).match(/1:(\d+)/)[1]);
        assert.equal(predicted, drawn, `${paper}${annotate ? ' annotated' : ''}`);
      }
    }
  });

  it('leaves room for the labels it will have to draw', () => {
    const plain = planContentSize(doc);
    const labelled = planContentSize(doc, { annotate: true });
    assert.ok(labelled.heightMeters > plain.heightMeters);
  });

  it('is null without a scale to measure in', () => {
    assert.equal(planContentSize({ ...doc, abDistance: 0 }), null);
  });
});
