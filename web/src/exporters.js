/**
 * Getting the plot back out: JSON for the phone, CSV for a spreadsheet, SVG and
 * PNG for a printout you can carry to the site.
 *
 * The string builders are pure so they can be tested without a browser; only
 * the `download*` helpers touch the DOM.
 */

import { abDistanceMeters, serializeDocument, UNITS } from './plotDocument.js';
import { measurePoints, metersPerCanvasUnit, plotExtent } from './measurements.js';
import { abGrid } from './grid.js';
import { MM_PER_PX, drawingArea, fitScale, formatScale, mmPerMeter, sheetSize } from './paper.js';
import { formatCompact, formatLength, formatSigned, fromMeters, niceStep } from './format.js';
import { validateGeometry } from './validation.js';
import { withTimeout } from './operations.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const escapeXml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** "5 m" for the scale bar, plus the grid interval when a grid is drawn. */
function scaleLabel(doc, barMeters, grid) {
  const symbol = UNITS[doc.unit].symbol;
  const bar = `${formatCompact(fromMeters(barMeters, doc.unit))} ${symbol}`;
  if (!grid) return bar;
  return `${bar}  ·  grid ${formatCompact(fromMeters(grid.stepMeters, doc.unit))} ${symbol}`;
}

/** Bounding box of everything in the plot, in canvas units. */
function contentBounds(doc) {
  const xs = [doc.pointA.x, doc.pointB.x, ...doc.points.map((p) => p.position.x)];
  const ys = [doc.pointA.y, doc.pointB.y, ...doc.points.map((p) => p.position.y)];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Escape the four fields a CSV cell can hide a delimiter in. Labels are free
 * text, so this is not decoration.
 */
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The measurement table as CSV, in the document's own unit.
 *
 * Columns mirror what the app shows: position on the canvas, the dimensionless
 * `(s, t)` pair, and the real-world offsets that follow from the declared A-B
 * distance.
 */
export function toCsv(doc) {
  validateGeometry(doc);
  const unit = UNITS[doc.unit].symbol;
  const rows = measurePoints(doc);
  const header = [
    'label',
    'canvas_x',
    'canvas_y',
    's_along_ab',
    't_perpendicular',
    `along_${unit}`,
    `perpendicular_${unit}`,
    `from_a_${unit}`,
    `from_b_${unit}`,
  ];
  const number = (meters) => (meters === null ? '' : fromMeters(meters, doc.unit).toFixed(4));
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.label),
        row.position.x.toFixed(2),
        row.position.y.toFixed(2),
        row.s === null ? '' : row.s.toFixed(6),
        row.t === null ? '' : row.t.toFixed(6),
        number(row.along),
        number(row.perp),
        number(row.fromA),
        number(row.fromB),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * How much ground a plan of this plot has to cover, in metres, measured along
 * the canvas axes the sheet is aligned to.
 *
 * Annotated points hang below their dots and the A/B handles sit proud of the
 * extremes, so it asks for a little more room than the bare content bounds.
 * Exported because the panel predicts the scale of the next export with it: if
 * it guessed the content size differently from the renderer, the two would
 * disagree at exactly the boundary where it matters.
 */
export function planContentSize(doc, { annotate = false } = {}) {
  const metersPerUnit = metersPerCanvasUnit(doc);
  if (metersPerUnit === null) return null;
  const bounds = contentBounds(doc);
  const slack = (annotate ? 34 : 18) * metersPerUnit;
  return {
    widthMeters: (bounds.maxX - bounds.minX) * metersPerUnit + slack,
    heightMeters: (bounds.maxY - bounds.minY) * metersPerUnit + slack,
  };
}

/**
 * Fit the plot to a given output width: the drawing is whatever size suits the
 * screen, and the scale is whatever falls out of that.
 *
 * `px` is canvas units per output pixel, which is what every drawn size is
 * expressed in, so the rest of the renderer never has to know which layout it
 * is working with.
 */
function fittedLayout(doc, { width, padding, footer }) {
  const bounds = contentBounds(doc);
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const px = spanX / (width - padding * 2);
  const height = Math.round(spanY / px) + padding * 2 + footer;
  return {
    widthAttribute: String(width),
    heightAttribute: String(height),
    px,
    footerPx: footer,
    viewBox: { x: bounds.minX - padding * px, y: bounds.minY - padding * px, w: width * px, h: height * px },
  };
}

/**
 * Lay the plot on a sheet of paper at a true scale: at 1:100 a metre on the
 * ground is 10 mm on the page, whatever size the file is displayed at.
 *
 * The sheet is declared in millimetres and the viewBox in canvas units, so the
 * two together fix the scale; `px` stays canvas units per CSS pixel, since SVG
 * defines a pixel as 1/96 in and that is what makes a 12 px dot 3.2 mm of ink.
 *
 * Returns null when the plot has no scale, or none of the standard ratios fits.
 */
function paperLayout(doc, { paper, orientation, ratio, margin, footer, annotate }) {
  const metersPerUnit = metersPerCanvasUnit(doc);
  const content = planContentSize(doc, { annotate });
  if (content === null) return null;

  const bounds = contentBounds(doc);
  const area = drawingArea(paper, orientation, { margin, footer });
  const scale = ratio ?? fitScale(content, area);
  if (!scale) return null;

  const sheet = sheetSize(paper, orientation);
  const mmPerUnit = metersPerUnit * mmPerMeter(scale);
  const px = MM_PER_PX / mmPerUnit; // canvas units per CSS pixel
  const viewWidth = sheet.width / mmPerUnit;
  const viewHeight = sheet.height / mmPerUnit;

  return {
    widthAttribute: `${round(sheet.width)}mm`,
    heightAttribute: `${round(sheet.height)}mm`,
    px,
    footerPx: footer / MM_PER_PX,
    scale,
    fits:
      content.widthMeters * mmPerMeter(scale) <= area.width &&
      content.heightMeters * mmPerMeter(scale) <= area.height,
    viewBox: {
      // Centre the plot across the sheet, and in the space above the footer.
      x: (bounds.minX + bounds.maxX) / 2 - viewWidth / 2,
      y: (bounds.minY + bounds.maxY) / 2 - (viewHeight - footer / mmPerUnit) / 2,
      w: viewWidth,
      h: viewHeight,
    },
  };
}

const round = (value) => Number(value.toFixed(2));

/**
 * A standalone SVG of the plot -- self-contained (inline styling, no external
 * fonts or CSS) so it prints, embeds and opens anywhere.
 *
 * The grid, scale bar and caption make it a drawing that can be measured on
 * paper, not just looked at. Pass `paper` (and optionally `orientation` and a
 * `scale` ratio, or leave the scale to be chosen) to lay it on a real sheet at
 * a true scale instead of fitting it to a pixel width.
 *
 * With `annotate`, each point carries its own measurements on the drawing, so
 * setting out a plot on site needs no table to cross-reference.
 *
 * @param {object} doc
 * @param {{width?: number, padding?: number, title?: string, showGrid?: boolean,
 *          annotate?: boolean, paper?: string, orientation?: string,
 *          scale?: number|null}} [options]
 */
export function toSvg(
  doc,
  {
    width = 1000,
    padding = 48,
    title = 'AB plot',
    showGrid = true,
    annotate = false,
    paper = null,
    orientation = 'landscape',
    scale = null,
  } = {},
) {
  validateGeometry(doc);
  // A named plot gets a title line, and the strip beneath the drawing grows to
  // hold it.
  const name = doc.name?.trim() ?? '';
  const layout =
    (paper &&
      paperLayout(doc, {
        paper,
        orientation,
        ratio: scale,
        margin: 12,
        footer: name ? 24 : 16,
        annotate,
      })) ||
    // Falling back keeps a plot exportable even when it has no scale to print
    // at, or is too large for any standard ratio on the chosen sheet.
    fittedLayout(doc, { width, padding, footer: name ? 108 : 78 });

  const { viewBox, px } = layout;
  if (![...Object.values(viewBox), px].every(Number.isFinite) || px <= 0) throw new Error('This plot cannot be laid out at the selected scale.');
  // The drawing occupies everything above the footer strip; the grid is built
  // for exactly that region and clipped to it so it cannot run under the
  // scale bar and caption.
  const plotArea = { x: viewBox.x, y: viewBox.y, w: viewBox.w, h: viewBox.h - layout.footerPx * px };
  const grid = showGrid ? abGrid(doc, plotArea, 40 * px) : null;
  const footer = layout.footerPx;
  const parts = [];

  parts.push(
    `<svg xmlns="${SVG_NS}" width="${layout.widthAttribute}" height="${layout.heightAttribute}" ` +
      `viewBox="${viewBox.x.toFixed(3)} ${viewBox.y.toFixed(3)} ${viewBox.w.toFixed(3)} ${viewBox.h.toFixed(3)}" ` +
      `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`,
  );
  parts.push(`<title>${escapeXml(name || title)}</title>`);
  parts.push(`<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.w}" height="${viewBox.h}" fill="#ffffff"/>`);

  // The same baseline-aligned grid the editor draws: without it a printout can
  // be looked at but not measured.
  if (grid) {
    parts.push(
      `<defs><clipPath id="abplot-plot-area">` +
        `<rect x="${plotArea.x}" y="${plotArea.y}" width="${plotArea.w}" height="${plotArea.h}"/>` +
        `</clipPath></defs>`,
      '<g clip-path="url(#abplot-plot-area)">',
    );
    for (const line of grid.lines) {
      parts.push(
        `<line x1="${line.x1.toFixed(2)}" y1="${line.y1.toFixed(2)}" x2="${line.x2.toFixed(2)}" ` +
          `y2="${line.y2.toFixed(2)}" stroke="${line.axis ? '#b8b8be' : '#e5e5ea'}" ` +
          `stroke-width="${(line.axis ? 1.4 : 0.8) * px}"/>`,
      );
    }
    parts.push('</g>');
  }

  parts.push(
    `<line x1="${doc.pointA.x}" y1="${doc.pointA.y}" x2="${doc.pointB.x}" y2="${doc.pointB.y}" ` +
      `stroke="#8a8a8e" stroke-width="${2 * px}" stroke-dasharray="${6 * px} ${4 * px}"/>`,
  );

  const annotations = annotate ? new Map(measurePoints(doc).map((row) => [row.id, row])) : null;
  for (const point of doc.points) {
    parts.push(
      `<circle cx="${point.position.x}" cy="${point.position.y}" r="${12 * px}" fill="#0a84ff" ` +
        `stroke="#ffffff" stroke-width="${1.5 * px}"/>`,
      `<text x="${point.position.x}" y="${point.position.y}" font-size="${11 * px}" fill="#ffffff" ` +
        `text-anchor="middle" dominant-baseline="central">${escapeXml(point.label)}</text>`,
    );

    const row = annotations?.get(point.id);
    if (row && row.along !== null) {
      // Set below the dot rather than beside it, so a column of points does not
      // overwrite its neighbours' numbers.
      const text = `${formatSigned(row.along, doc.unit, { withUnit: false })}, ` +
        `${formatSigned(row.perp, doc.unit, { withUnit: false })}`;
      parts.push(
        `<text x="${point.position.x}" y="${point.position.y + 26 * px}" font-size="${11 * px}" ` +
          `fill="#3a3a3c" text-anchor="middle" ` +
          `paint-order="stroke" stroke="#ffffff" stroke-width="${3 * px}" stroke-linejoin="round">` +
          `${escapeXml(text)}</text>`,
      );
    }
  }

  for (const [name, position, fill] of [
    ['A', doc.pointA, '#34c759'],
    ['B', doc.pointB, '#ff3b30'],
  ]) {
    parts.push(
      `<circle cx="${position.x}" cy="${position.y}" r="${15 * px}" fill="${fill}" stroke="#ffffff" ` +
        `stroke-width="${2 * px}"/>`,
      `<text x="${position.x}" y="${position.y}" font-size="${13 * px}" fill="#ffffff" font-weight="700" ` +
        `text-anchor="middle" dominant-baseline="central">${name}</text>`,
    );
  }

  // Footer: scale bar on the left, summary on the right, both in output pixels
  // mapped back into canvas units so they sit at a fixed size on the page.
  const footerY = viewBox.y + viewBox.h - (footer - 30) * px;
  const left = viewBox.x + padding * px;
  const extent = plotExtent(doc);
  const abMeters = abDistanceMeters(doc);
  const scaleMetersPerPx = abMeters / Math.hypot(doc.pointB.x - doc.pointA.x, doc.pointB.y - doc.pointA.y) * px;

  if (Number.isFinite(scaleMetersPerPx) && scaleMetersPerPx > 0) {
    const barMeters = niceStep(140 * scaleMetersPerPx);
    const barWidth = (barMeters / scaleMetersPerPx) * px;
    parts.push(
      `<line x1="${left}" y1="${footerY}" x2="${left + barWidth}" y2="${footerY}" stroke="#1c1c1e" ` +
        `stroke-width="${2 * px}"/>`,
      `<line x1="${left}" y1="${footerY - 5 * px}" x2="${left}" y2="${footerY + 5 * px}" stroke="#1c1c1e" ` +
        `stroke-width="${2 * px}"/>`,
      `<line x1="${left + barWidth}" y1="${footerY - 5 * px}" x2="${left + barWidth}" y2="${footerY + 5 * px}" ` +
        `stroke="#1c1c1e" stroke-width="${2 * px}"/>`,
      `<text x="${left}" y="${footerY + 20 * px}" font-size="${13 * px}" fill="#1c1c1e">` +
        `${escapeXml(scaleLabel(doc, barMeters, grid))}</text>`,
    );
  }

  if (name) {
    parts.push(
      `<text x="${left}" y="${footerY - 18 * px}" font-size="${16 * px}" font-weight="700" ` +
        `fill="#1c1c1e">${escapeXml(name)}</text>`,
    );
  }

  const summary = [
    layout.scale ? formatScale(layout.scale) : null,
    `A–B ${formatLength(abMeters, doc.unit)}`,
    `${doc.points.length} point${doc.points.length === 1 ? '' : 's'}`,
    // Only claim the labels when some were actually drawn: with no scale there
    // is nothing to label, however the option is set.
    annotations && [...annotations.values()].some((row) => row.along !== null)
      ? 'labelled along, across'
      : null,
    extent
      ? `extent ${formatLength(extent.along, doc.unit)} × ${formatLength(extent.perp, doc.unit)}`
      : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  parts.push(
    `<text x="${viewBox.x + viewBox.w - padding * px}" y="${footerY + 20 * px}" font-size="${13 * px}" ` +
      `fill="#48484a" text-anchor="end">${escapeXml(summary)}</text>`,
  );

  parts.push('</svg>');
  return parts.join('\n');
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadText(filename, text, type) {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; one turn of
  // the event loop is enough for the click to have been consumed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(doc, filename = 'plot.json') {
  downloadText(filename, `${serializeDocument(doc)}\n`, 'application/json');
}

export function downloadCsv(doc, filename = 'plot-measurements.csv') {
  downloadText(filename, toCsv(doc), 'text/csv');
}

export function downloadSvg(doc, { filename = 'plot.svg', ...options } = {}) {
  downloadText(filename, toSvg(doc, options), 'image/svg+xml');
}

/**
 * The pixel size to rasterize a sheet at.
 *
 * A fitted export is already sized in pixels and just gets a retina multiplier.
 * A paper sheet is sized in millimetres, so it is rasterized at a print
 * resolution instead -- 300 dpi, which is what makes an A4 plan come out as a
 * usable 3508 px image rather than a 1123 px screenshot of one.
 */
export function rasterSize(markup, { pixelRatio, dpi }) {
  const matchWidth = markup.match(/width="([\d.]+)(mm)?"/);
  const matchHeight = markup.match(/height="([\d.]+)(?:mm)?"/);
  if (!matchWidth || !matchHeight) throw new Error('Invalid image dimensions');
  const [, width, unit] = matchWidth;
  const [, height] = matchHeight;
  const factor = unit === 'mm' ? dpi / 25.4 : pixelRatio;
  // A zero or missing factor would make a 0x0 canvas, which encodes to nothing
  // and reports itself only as "could not encode". Say what is actually wrong.
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Cannot rasterize at ${unit === 'mm' ? `${dpi} dpi` : `a pixel ratio of ${pixelRatio}`}`);
  }
  const result = { width: Math.round(Number(width) * factor), height: Math.round(Number(height) * factor) };
  if (!Object.values(result).every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384) || result.width * result.height > 24000000) {
    throw new Error('PNG exceeds the 24 megapixel limit. Choose a paper sheet or export SVG.');
  }
  return result;
}

/**
 * Rasterize the export SVG and download it as a PNG.
 *
 * The multiplier is `pixelRatio`, deliberately not `scale`: `scale` already
 * means the drawing ratio in {@link toSvg}, and the two travel together in the
 * same options object.
 */
export async function downloadPng(doc, { filename = 'plot.png', pixelRatio = 2, dpi = 300, ...options } = {}) {
  const markup = toSvg(doc, options);
  const { width, height } = rasterSize(markup, { pixelRatio, dpi });
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await withTimeout(new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error('Could not render the plot to an image')), { once: true });
      image.src = url;
    }));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create an image canvas. Export SVG instead.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await withTimeout(new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
    if (!blob) throw new Error('Could not encode the PNG');
    downloadBlob(filename, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
