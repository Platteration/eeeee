/**
 * Turning a sketch into numbers.
 *
 * The declared A-B distance is the only real-world dimension the user supplies;
 * every other length here follows from it and the geometry on the canvas. This
 * is what the browser can do that the phone cannot show you at a glance: the
 * whole plot as a table of real distances, before you ever stand in the room.
 */

import { abCoordinates, canvasABLength, canvasPoint, hasValidBaseline, worldOffset } from './plotMath.js';
import { abDistanceMeters } from './plotDocument.js';

/** Whether the document has enough information for real-world measurements. */
export function isMeasurable(doc) {
  return hasValidBaseline(doc.pointA, doc.pointB) && abDistanceMeters(doc) > 0;
}

/**
 * Meters per canvas unit -- the scale the declared A-B distance implies.
 * Returns null when the baseline is degenerate or unscaled.
 */
export function metersPerCanvasUnit(doc) {
  if (!isMeasurable(doc)) return null;
  return abDistanceMeters(doc) / canvasABLength(doc.pointA, doc.pointB);
}

/** Real-world distance in meters between two canvas points, or null. */
export function distanceMeters(doc, p, q) {
  const scale = metersPerCanvasUnit(doc);
  if (scale === null) return null;
  return Math.hypot(q.x - p.x, q.y - p.y) * scale;
}

/**
 * Every point measured against the baseline.
 *
 * Each row carries the normalized `(s, t)` plus meters `along` the baseline,
 * `perp`endicular to it, and straight-line distances `fromA` and `fromB`. When
 * the plot has no usable baseline the geometry fields are null and the caller
 * shows dashes rather than lies.
 *
 * @param {object} doc
 * @param {{x: number, y: number} | null} [reference] point to measure `fromReference` against
 */
export function measurePoints(doc, reference = null) {
  const abMeters = abDistanceMeters(doc);
  const measurable = isMeasurable(doc);
  const scale = metersPerCanvasUnit(doc);

  return doc.points.map((point) => {
    const ab = measurable ? abCoordinates(point.position, doc.pointA, doc.pointB) : null;
    if (!ab) {
      return {
        id: point.id,
        label: point.label,
        position: point.position,
        s: null,
        t: null,
        along: null,
        perp: null,
        fromA: null,
        fromB: null,
        fromReference: null,
      };
    }
    const { along, perp } = worldOffset(ab.s, ab.t, abMeters);
    return {
      id: point.id,
      label: point.label,
      position: point.position,
      s: ab.s,
      t: ab.t,
      along,
      perp,
      fromA: Math.hypot(along, perp),
      fromB: Math.hypot(along - abMeters, perp),
      fromReference:
        reference === null
          ? null
          : Math.hypot(point.position.x - reference.x, point.position.y - reference.y) * scale,
    };
  });
}

/**
 * The canvas position for a point sitting `along` meters down the baseline from
 * A and `perp` meters across it -- the exact inverse of the `along` and `perp`
 * a row reports, so a distance read off a tape can be entered as a number
 * instead of aimed at with the mouse.
 *
 * Returns null when the plot has no scale to place it against.
 */
export function positionForOffsets(doc, { along, perp }) {
  if (!isMeasurable(doc)) return null;
  const abMeters = abDistanceMeters(doc);
  return canvasPoint({ s: along / abMeters, t: perp / abMeters }, doc.pointA, doc.pointB);
}

/**
 * Bounding box of the plot in real-world meters, measured in the baseline's
 * frame: how much ground the whole sketch covers along and across A->B.
 * Returns null when there is nothing to measure.
 */
export function plotExtent(doc) {
  const rows = measurePoints(doc);
  const measured = rows.filter((row) => row.along !== null);
  if (measured.length === 0) return null;
  const abMeters = abDistanceMeters(doc);
  // A and B are part of the plot's footprint even when no point reaches them.
  const alongs = [0, abMeters, ...measured.map((row) => row.along)];
  const perps = [0, ...measured.map((row) => row.perp)];
  return {
    along: Math.max(...alongs) - Math.min(...alongs),
    perp: Math.max(...perps) - Math.min(...perps),
    count: measured.length,
  };
}
