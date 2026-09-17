/** A portable paper checklist; plain document data never becomes active markup. */
import { abDistanceMeters, UNITS } from './plotDocument.js';
import { measurePoints } from './measurements.js';
import { formatLength } from './format.js';
import { reviewOutline } from './plotReview.js';
import { validateGeometry } from './validation.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

/** Standalone, script-free HTML for browser printing or Save as PDF. */
export function toFieldSheetHtml(doc) {
  validateGeometry(doc);
  const title = doc.name?.trim() || 'Untitled pool';
  const warnings = reviewOutline(doc).warnings;
  const warningIds = new Set(warnings.flatMap(warning => warning.ids));
  const measured = measurePoints(doc);
  const rows = doc.points.map((point, index) => {
    const row = measured[index];
    const status = [point.needsRemeasure ? '☐ Remeasure' : null, warningIds.has(point.id) ? 'Check outline' : null].filter(Boolean).join('\n');
    return `<tr><td>${index + 1}</td><th scope="row">${escapeHtml(point.label)}${point.description ? `<span class="description">${escapeHtml(point.description)}</span>` : ''}</th>` +
      `<td class="distance">${escapeHtml(formatLength(row.fromA, doc.unit, { digits: 3, withUnit: false }))}</td>` +
      `<td class="distance">${escapeHtml(formatLength(row.fromB, doc.unit, { digits: 3, withUnit: false }))}</td>` +
      `<td class="notes">${escapeHtml(status)}${status && point.note ? '\n' : ''}${escapeHtml(point.note)}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} — ABPlot field sheet</title>
<style>
@page { margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #18202b; background: white; font: 11pt/1.45 system-ui, -apple-system, sans-serif; }
h1 { margin: 0 0 3mm; font-size: 21pt; overflow-wrap: anywhere; }
h2 { font-size: 12pt; margin: 6mm 0 2mm; }
p { margin: 0 0 3mm; }
.muted { color: #4d5664; font-size: 9pt; }
.baseline { margin: 5mm 0; padding: 3mm; border: 1px solid #aab1bd; break-inside: avoid; }
.notes { white-space: pre-wrap; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 1px solid #aab1bd; padding: 2.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
thead th { background: #eef2f6; font-weight: 650; }
.description { display: block; margin-top: 1mm; font-weight: 400; }
.distance { text-align: right; font-variant-numeric: tabular-nums; }
ul { padding-left: 5mm; }
li { margin-bottom: 2mm; }
footer { margin-top: 5mm; border-top: 1px solid #aab1bd; padding-top: 3mm; }
</style></head><body>
<header><p class="muted">ABPlot · Field sheet</p><h1>${escapeHtml(title)}</h1><p>Keep this sheet with your measurements. Tick and annotate points as you check them.</p></header>
<section class="baseline" aria-label="Reference measurement"><strong>A–B reference: ${escapeHtml(formatLength(abDistanceMeters(doc), doc.unit, { digits: 3 }))}</strong>
${doc.baselineNeedsRemeasure ? '<p>☐ Remeasure A–B reference distance</p>' : ''}${doc.baselineNote ? `<p class="notes">${escapeHtml(doc.baselineNote)}</p>` : ''}</section>
<p class="muted">${doc.points.length} point${doc.points.length === 1 ? '' : 's'} in walking order · Distances in ${escapeHtml(UNITS[doc.unit].label.toLowerCase())} (${escapeHtml(UNITS[doc.unit].symbol)}). Readings are calculated from the current plan.</p>
<table aria-label="Point measurements"><colgroup><col style="width:8%"><col style="width:27%"><col style="width:13%"><col style="width:13%"><col style="width:39%"></colgroup>
<thead><tr><th scope="col">Order</th><th scope="col">Point / description</th><th scope="col">From A (${escapeHtml(UNITS[doc.unit].symbol)})</th><th scope="col">From B (${escapeHtml(UNITS[doc.unit].symbol)})</th><th scope="col">Checks and notes</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">No points added yet.</td></tr>'}</tbody></table>
${warnings.length ? `<section><h2>Outline checks</h2><ul>${warnings.map(warning => `<li>${escapeHtml(warning.message)}</li>`).join('')}</ul><p class="muted">Check point order before remeasuring. These checks cannot identify a wrong reading with certainty.</p></section>` : ''}
<footer class="muted">Site / date: ____________________ &nbsp; Checked by: ____________________<br>Save the complete ABPlot project to keep an editable copy with its notes and any attached photo.</footer>
</body></html>`;
}

/**
 * Print a separate document in a same-origin frame, avoiding a blocked popup and
 * leaving the editor, its selection, history, and browser recovery untouched.
 * The frame survives asynchronous print dialogs until afterprint, or five minutes.
 */
export async function printFieldSheet(doc) {
  const html = toFieldSheetHtml(doc);
  const frame = document.createElement('iframe');
  frame.title = 'ABPlot printable field sheet';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;';
  const previousFocus = document.activeElement;
  document.body.append(frame);
  let expiry;
  const cleanup = () => {
    clearTimeout(expiry);
    const restoreFocus = document.activeElement === frame;
    frame.remove();
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  try {
    const view = frame.contentWindow;
    if (!view || !frame.contentDocument) throw new Error('The print document could not be opened. Try exporting CSV instead.');
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    await frame.contentDocument.fonts?.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    view.addEventListener('afterprint', cleanup, { once: true });
    expiry = setTimeout(cleanup, 5 * 60 * 1000);
    view.focus();
    view.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
