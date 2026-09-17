import { nextLabel } from './plotDocument.js';
import { reviewMeasurements } from './measurementImport.js';
import { normalizePointDescription } from './pointNames.js';

export function setupQuickEntry({ store, editor, setStatus }) {
  const host = document.getElementById('quick-entry');
  host.innerHTML = `<form id="quick-form"><div class="measurement-pair"><label>Point number / code<input id="quick-label" type="text" maxlength="40" required /></label><label>Description (optional)<input id="quick-description" type="text" maxlength="120" placeholder="Deep-end corner" /></label></div><div class="measurement-pair"><label>Distance from A<input id="quick-a" type="text" inputmode="decimal" required /></label><label>Distance from B<input id="quick-b" type="text" inputmode="decimal" required /></label></div><label>Side of A → B<select id="quick-side"><option value="above">Above the baseline on the plan</option><option value="below">Below the baseline on the plan</option></select></label><label>Walking sequence<select id="quick-insert"><option value="">Add at the end</option></select></label><p id="quick-status" class="note" role="status"></p><div class="button-grid"><button id="quick-save" type="submit" class="primary" disabled>Add &amp; next</button><button id="quick-reset" type="button">Clear fields</button></div></form>`;
  const $ = id => document.getElementById(`quick-${id}`);
  let dirty = false, context = '';
  const fingerprint = () => JSON.stringify([store.document.pointA, store.document.pointB, store.document.abDistance, store.document.unit]);
  const preview = () => {
    if (dirty && context !== fingerprint()) throw Error('The baseline or units changed. Clear these fields and re-enter the readings in the new context.');
    if ($('insert').value && !store.document.points.some(p => p.id === $('insert').value)) throw Error('The insertion point was removed. Choose a new position in the walking sequence.');
    const result = reviewMeasurements([{ label: $('label').value, first: $('a').value.replace(',', '.'), second: $('b').value.replace(',', '.'), side: $('side').value }], store.document, { mode: 'distances' });
    if (!result.valid) throw Error(result.rows[0].error);
    const point = result.rows[0].point;
    const description = normalizePointDescription($('description').value);
    if (description) point.description = description;
    return point;
  };
  function render() {
    if (!dirty) $('label').value = nextLabel(store.document.points);
    const anchor = $('insert').value;
    const options = [new Option('Add at the end', ''), ...store.document.points.map(p => new Option(`Insert after ${p.label}${p.description ? ` · ${p.description}` : ''}`, p.id))];
    if (anchor && !store.document.points.some(p => p.id === anchor)) options.push(new Option('Previous insertion point was removed', anchor));
    $('insert').replaceChildren(...options); $('insert').value = anchor;
    $('save').disabled = true;
    if (!dirty) {
      $('status').textContent = store.document.abDistance > 0 ? `Readings in ${store.document.unit}. Add & next keeps you ready for the next point.` : 'Set and apply a positive A–B distance above first.';
      $('status').dataset.tone = 'ok'; return;
    }
    try { preview(); $('save').disabled = false; $('status').textContent = 'These readings form a possible triangle. Ready to add this point.'; $('status').dataset.tone = 'ok'; }
    catch (error) { $('status').textContent = error.message; $('status').dataset.tone = 'error'; }
  }
  function discard() { dirty = false; context = ''; for (const key of ['a', 'b', 'description']) $(key).value = ''; render(); }
  $('form').addEventListener('input', () => { if (!dirty) context = fingerprint(); dirty = true; render(); });
  $('form').addEventListener('change', render);
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const point = preview(), after = $('insert').value;
      store.apply(doc => { const index = after ? doc.points.findIndex(p => p.id === after) + 1 : doc.points.length; doc.points.splice(index, 0, point); });
      store.select(point.id); if (after) $('insert').value = point.id;
      discard(); editor.fit(); setStatus(`Added point ${point.label}. Enter the next A/B readings.`); $('a').focus();
    } catch (error) { $('status').textContent = error.message; $('status').dataset.tone = 'error'; }
  });
  $('reset').addEventListener('click', discard);
  host.addEventListener('keydown', event => event.stopPropagation());
  store.subscribe(render); render();
  return { get hasDraft() { return dirty; }, discard, focus() { $('a').focus(); } };
}
