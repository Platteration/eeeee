/**
 * The measuring grid: lines of constant `s` and constant `t`, i.e. parallel and
 * perpendicular to the A-B baseline, spaced at a round real-world interval.
 *
 * Aligning the grid to the baseline rather than to the screen is what makes it
 * a measuring aid: every square is the same real distance on the ground, and
 * the two lines through A are the axes every measurement in the table is
 * quoted against.
 *
 * Shared by the on-screen canvas and the SVG export so a printout is gridded
 * exactly like the editor.
 */

import { abCoordinates, canvasPoint } from './plotMath.js';
import { abDistanceMeters } from './plotDocument.js';
import { metersPerCanvasUnit } from './measurements.js';
import { niceStep } from './format.js';

/** Refuse to emit a grid finer than this; past it the lines are just noise. */
export const MAX_GRID_LINES = 240;

/**
 * Grid lines covering `box`, an axis-aligned rectangle in canvas units.
 *
 * @param {object} doc
 * @param {{x: number, y: number, w: number, h: number}} box visible canvas region
 * @param {number} minSpacing smallest acceptable line spacing, in canvas units
 * @returns {{lines: Array<{x1: number, y1: number, x2: number, y2: number, axis: boolean}>,
 *            stepMeters: number} | null} null when the plot has no scale
 */
export function abGrid(doc, box, minSpacing) {
  const scale = metersPerCanvasUnit(doc);
  if (scale === null) return null;

  const stepMeters = niceStep(minSpacing * scale);
  const step = stepMeters / abDistanceMeters(doc); // in AB-frame units

  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x, y: box.y + box.h },
    { x: box.x + box.w, y: box.y + box.h },
  ].map((corner) => abCoordinates(corner, doc.pointA, doc.pointB));
  if (corners.some((corner) => corner === null)) return null;

  // abCoordinates is a similarity transform, so the corners' (s, t) bound the
  // whole visible region -- lines spanning that box cover everything on screen.
  const extent = (key) => {
    const values = corners.map((corner) => corner[key]);
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  const s = extent('s');
  const t = extent('t');
  if ((s.max - s.min) / step > MAX_GRID_LINES || (t.max - t.min) / step > MAX_GRID_LINES) return null;

  const lines = [];
  const push = (from, to, axis) => {
    const p = canvasPoint(from, doc.pointA, doc.pointB);
    const q = canvasPoint(to, doc.pointA, doc.pointB);
    lines.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, axis });
  };
  if (![s.min / step, s.max / step, t.min / step, t.max / step].every(n => Number.isSafeInteger(Math.ceil(n)))) return null;
  let count = 0;
  for (let i = Math.ceil(s.min / step); i * step <= s.max && count++ < MAX_GRID_LINES; i += 1) {
    push({ s: i * step, t: t.min }, { s: i * step, t: t.max }, i === 0);
  }
  count = 0;
  for (let i = Math.ceil(t.min / step); i * step <= t.max && count++ < MAX_GRID_LINES; i += 1) {
    push({ s: s.min, t: i * step }, { s: s.max, t: i * step }, i === 0);
  }
  return { lines, stepMeters };
}
