/**
 * Pure coordinate math for AB plotting on a 2D canvas.
 *
 * This is the JavaScript twin of `ABPlot/Models/PlotMath.swift`: same formulas,
 * same sign conventions, same minimum-separation guard, so a plot drawn in the
 * browser and the same plot opened on the phone agree to the last decimal.
 *
 * ## Canvas -> normalized AB frame
 * Canvas coordinates have y growing *down* (SVG and SwiftUI agree here). For a
 * canvas point `p` relative to reference points `a` and `b`:
 *
 *     d = p - a;  D = b - a;  L2 = D.x^2 + D.y^2
 *     s = (d.x*D.x + d.y*D.y) / L2        // fraction along A->B (A = 0, B = 1)
 *     t = (d.x*-D.y + d.y*D.x) / L2       // perpendicular fraction; + = canvas-down side
 *
 * `(s, t)` is dimensionless (units of AB-lengths), so it survives panning,
 * zooming and resizing the canvas untouched -- only geometry relative to A and
 * B matters. Multiplying by the declared real-world A-B distance turns it into
 * meters, which is all any measurement here does.
 */

/** Minimum canvas A-B separation (in canvas units) for the frame to be defined. */
export const MIN_CANVAS_AB_DISTANCE = 1.0;

/**
 * Normalized `(s, t)` coordinates of `p` in the frame defined by canvas points
 * `a` and `b`. Returns null when A and B are (nearly) coincident.
 *
 * @param {{x: number, y: number}} p
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {{s: number, t: number} | null}
 */
export function abCoordinates(p, a, b) {
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const length = Math.hypot(ux, uy);
  if (!Number.isFinite(length) || length <= MIN_CANVAS_AB_DISTANCE) return null;
  const s = (dx / length) * (ux / length) + (dy / length) * (uy / length);
  const t = (dx / length) * (-uy / length) + (dy / length) * (ux / length);
  return Number.isFinite(s) && Number.isFinite(t) ? { s, t } : null;
}

/**
 * Inverse of {@link abCoordinates}: the canvas point at normalized `(s, t)`.
 *
 * Since `d = s*D + t*D_perp` with `D_perp = (-D.y, D.x)`, this is exact -- it is
 * what draws grid lines of constant `s` or constant `t` in canvas space.
 *
 * @returns {{x: number, y: number}}
 */
export function canvasPoint({ s, t }, a, b) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  return {
    x: a.x + s * ux + t * -uy,
    y: a.y + s * uy + t * ux,
  };
}

/** Length of the A-B baseline in canvas units. */
export function canvasABLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Whether A and B are far enough apart for the AB frame to be defined. */
export function hasValidBaseline(a, b) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const length = Math.hypot(ux, uy);
  return Number.isFinite(length) && length > MIN_CANVAS_AB_DISTANCE;
}

/**
 * Real-world offsets of a point from A, in meters: `along` the A->B direction
 * and perpendicular to it (`perp`) (positive on the canvas-down side of A->B).
 *
 * These are exactly the local x and z the iOS app hands to RealityKit, so a
 * measurement read here is the position you will see standing in AR.
 */
export function worldOffset(s, t, abMeters) {
  return { along: s * abMeters, perp: t * abMeters };
}
