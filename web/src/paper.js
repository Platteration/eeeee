/**
 * Printing a plot as a *drawing* rather than a picture.
 *
 * A picture of a plot is whatever size the file happens to be. A drawing is at
 * a stated scale: at 1:100, one metre on the ground is exactly 10 mm on the
 * page, so a ruler laid on the paper reads real distances and the sheet can be
 * checked, marked up and set out from.
 *
 * Scale ratios are dimensionless, so the same 1:100 works whether the plot is
 * declared in metres or feet.
 */

/** Millimetres per CSS pixel: SVG's own 96 dpi user-unit convention. */
export const MM_PER_PX = 25.4 / 96;

/** Paper sizes in millimetres, portrait. */
export const PAPER_SIZES = {
  a4: { label: 'A4', width: 210, height: 297 },
  a3: { label: 'A3', width: 297, height: 420 },
  letter: { label: 'Letter', width: 215.9, height: 279.4 },
  tabloid: { label: 'Tabloid', width: 279.4, height: 431.8 },
};

/** Drawing scales, finest first, so the first that fits is the largest. */
export const SCALE_RATIOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

/** Millimetres of paper per metre on the ground at `1:ratio`. */
export function mmPerMeter(ratio) {
  return 1000 / ratio;
}

/** The sheet's outside dimensions in millimetres, honouring orientation. */
export function sheetSize(paper, orientation = 'portrait') {
  const size = PAPER_SIZES[paper];
  if (!size) throw new Error(`Unknown paper size ${JSON.stringify(paper)}`);
  return orientation === 'landscape'
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * The area left for the drawing itself, in millimetres, once the margins and
 * the strip holding the scale bar and caption are taken out.
 */
export function drawingArea(paper, orientation, { margin = 12, footer = 16 } = {}) {
  const sheet = sheetSize(paper, orientation);
  return {
    width: sheet.width - margin * 2,
    height: sheet.height - margin * 2 - footer,
  };
}

/**
 * The largest standard scale at which a plot of `widthMeters` x `heightMeters`
 * fits inside `area` (millimetres). Null when even the coarsest will not do.
 */
export function fitScale({ widthMeters, heightMeters }, area) {
  for (const ratio of SCALE_RATIOS) {
    const mm = mmPerMeter(ratio);
    if (widthMeters * mm <= area.width && heightMeters * mm <= area.height) return ratio;
  }
  return null;
}

/** "1:100", as it belongs on the drawing. */
export function formatScale(ratio) {
  return `1:${ratio}`;
}
