/** Number and length formatting shared by the canvas, the table and the exports. */

import { UNITS } from './plotDocument.js';

/** Convert meters into `unit`. */
export function fromMeters(meters, unit) {
  return meters / UNITS[unit].toMeters;
}

/** Convert a value in `unit` into meters. */
export function toMeters(value, unit) {
  return value * UNITS[unit].toMeters;
}

/**
 * A length in meters, rendered in the document's unit -- e.g. `"3.05 m"`.
 * Returns an em dash for values that are not finite, so callers can hand
 * through the "no baseline yet" case without branching.
 */
export function formatLength(meters, unit, { digits = 2, withUnit = true } = {}) {
  if (!Number.isFinite(meters)) return '—';
  const value = fromMeters(meters, unit);
  let text = value.toFixed(digits);
  // A value that rounds to zero should read as zero: "-0.00" looks like an error.
  if (Number.parseFloat(text) === 0) text = (0).toFixed(digits);
  return withUnit ? `${text} ${UNITS[unit].symbol}` : text;
}

/**
 * A signed length, so "which side of the baseline" survives the rounding. The
 * sign comes from the *rounded* text, so a value that displays as zero is not
 * dressed up as "+0.00".
 */
export function formatSigned(meters, unit, options) {
  const text = formatLength(meters, unit, options);
  return Number.parseFloat(text) > 0 ? `+${text}` : text;
}

/**
 * The smallest "nice" step (1, 2 or 5 times a power of ten) that is at least
 * `minimum`. Grid spacing and scale bars use it so their labels land on round
 * numbers at every zoom level.
 */
export function niceStep(minimum) {
  if (!Number.isFinite(minimum) || minimum <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(minimum));
  for (const multiple of [1, 2, 5]) {
    if (magnitude * multiple >= minimum) return magnitude * multiple;
  }
  return magnitude * 10;
}

/** Strip trailing zeros so grid labels read "1 m", not "1.00 m". */
export function formatCompact(value) {
  return Number.parseFloat(value.toFixed(4)).toString();
}
