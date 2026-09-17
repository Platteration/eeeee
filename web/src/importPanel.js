import { parseRows, reviewMeasurements } from './measurementImport.js';
import { toSvg } from './exporters.js';
import { LatestOperation, withTimeout } from './operations.js';

export function setupImportPanel({ store, editor, setStatus }) {
  const $ = id => document.getElementById(id);
  const dialog = $('measurement-import');
  let rows = [], review = null, revision = -1, recognized = false;
  let needsParsing = true, draftRevision = 0;
  const reads = new LatestOperation();
  const options = () => ({ mode: $('entry-mode').value, unit: $('entry-unit').value, decimal: $('entry-decimal').value, replace: $('entry-action').value === 'replace' });
  const message = text => { $('entry-status').textContent = text; };
  const invalidate = () => { review = null; $('entry-apply').disabled = true; $('entry-checked').checked = false; };
  function preview() {
    invalidate();
    try {
      review = reviewMeasurements(rows, store.document, options());
      rows = review.rows; revision = store.revision;
      const body = $('entry-rows'); body.replaceChildren();
      for (const [index, row] of rows.entries()) {
        const tr = document.createElement('tr');
        for (const field of ['label', 'first', 'second']) {
          const cell = document.createElement('td'), input = document.createElement('input');
          input.value = row[field]; input.setAttribute('aria-label', `${field} in row ${index + 1}`);
          if (field !== 'label') input.inputMode = 'decimal';
          input.addEventListener('change', () => { rows[index][field] = input.value; draftRevision++; preview(); });
          cell.append(input); tr.append(cell);
        }
        const sideCell = document.createElement('td');
        if (options().mode === 'distances') {
          const side = document.createElement('select');
          side.setAttribute('aria-label', `Side in row ${index + 1}`);
          side.add(new Option('Above A→B', 'above')); side.add(new Option('Below A→B', 'below')); side.value = row.side;
          side.addEventListener('change', () => { rows[index].side = side.value; draftRevision++; preview(); }); sideCell.append(side);
        }
        tr.append(sideCell);
        const error = document.createElement('td'); error.textContent = row.error ?? 'Valid'; tr.append(error);
        const removeCell = document.createElement('td'), remove = document.createElement('button'); remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove row ${index + 1}`);
        remove.addEventListener('click', () => { rows.splice(index, 1); draftRevision++; preview(); }); removeCell.append(remove); tr.append(removeCell);
        body.append(tr);
      }
      $('entry-preview').innerHTML = toSvg(review.document, { width: 600, showGrid: false });
      $('entry-review').hidden = false;
      $('entry-confirmation').hidden = !recognized;
      $('entry-apply').disabled = !review.valid || recognized;
      message(review.valid ? `${rows.length} points ready. Check the preview, units and labels before applying.` : 'Correct or explicitly remove the marked rows. No points have been imported.');
    } catch (error) { invalidate(); message(error.message); }
  }
  function acceptText(text, isOcr = false) {
    needsParsing = true; draftRevision++;
    $('entry-text').value = text; recognized = isOcr; invalidate();
    $('entry-review').hidden = true;
    message(isOcr ? 'Recognition complete. Correct the text and column mapping, then preview. Check every measurement against the image.' : 'Choose the format and columns, then preview.');
  }
  $('bulk-entry').addEventListener('click', () => { $('entry-unit').value = store.document.unit; dialog.showModal(); });
  $('entry-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { reads.cancel(); invalidate(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  $('entry-text').addEventListener('input', () => { needsParsing = true; draftRevision++; reads.cancel(); invalidate(); });
  for (const id of ['entry-mode', 'entry-unit', 'entry-decimal', 'entry-action', 'entry-delimiter', 'entry-header', 'entry-label-column', 'entry-first-column', 'entry-second-column']) $(id).addEventListener('change', () => {
    if (['entry-delimiter', 'entry-header', 'entry-label-column', 'entry-first-column', 'entry-second-column'].includes(id)) needsParsing = true;
    draftRevision++; invalidate();
  });
  $('entry-review-button').addEventListener('click', () => {
    try {
      if (needsParsing) rows = parseRows($('entry-text').value, { delimiter: $('entry-delimiter').value.replace('tab', '\t'), header: $('entry-header').checked, columns: ['entry-label-column', 'entry-first-column', 'entry-second-column'].map(id => Number($(id).value) - 1) });
      needsParsing = false;
      $('entry-first-heading').textContent = options().mode === 'distances' ? 'From A' : 'Along';
      $('entry-second-heading').textContent = options().mode === 'distances' ? 'From B' : 'Perpendicular';
      preview();
    } catch (error) { invalidate(); message(error.message); }
  });
  $('entry-checked').addEventListener('change', () => { $('entry-apply').disabled = !review?.valid || (recognized && !$('entry-checked').checked); });
  $('entry-apply').addEventListener('click', () => {
    if (!review?.valid || (recognized && !$('entry-checked').checked)) return;
    if (revision !== store.revision) { preview(); message('The plot changed. Review the recalculated preview and apply again.'); return; }
    try { store.replace(review.document); editor.fit(); dialog.close(); setStatus(`Imported ${rows.length} points. Undo restores the previous plot.`); }
    catch (error) { message(error.message); }
  });
  $('entry-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    const current = reads.start(); invalidate(); message('Reading measurements…');
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a text or CSV file smaller than 1 MB.');
      const text = await withTimeout(file.text()); if (current() && dialog.open) acceptText(text);
    } catch (error) { if (current()) message(error.message); }
  });
  store.subscribe(() => { if (review && store.revision !== revision) { $('entry-apply').disabled = true; message('The plot changed. Preview again before applying.'); } });
  return { dialog, acceptText, message, invalidate, get draftRevision() { return draftRevision; } };
}
