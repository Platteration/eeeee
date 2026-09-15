import { reviewOutline } from './plotReview.js';
import { reviewMeasurements } from './measurementImport.js';
import { measurePoints } from './measurements.js';
import { UNITS } from './plotDocument.js';

export function setupReviewPanel({ store, editor }) {
  const host = document.getElementById('point-review');
  host.innerHTML = `<details id="review-details"><summary>Review a point or A–B</summary>
    <label>Point to check <select id="review-point"><option value="baseline">A–B reference points</option></select></label>
    <p id="review-selected-help" class="note"></p>
    <div id="review-baseline"><button id="review-edit-baseline" type="button">Edit measured A–B distance</button><p class="note">Drag A or B on the plan to reposition the reference. Changing A–B changes the scale of every point.</p></div>
    <form id="remeasure-form" hidden>
      <p class="note">These are the drawing’s current distances. Replace them with your tape readings to reposition this point.</p>
      <div class="measurement-pair"><label>Measured from A <input id="remeasure-a" type="text" inputmode="decimal" aria-describedby="remeasure-status" required /></label><label>Measured from B <input id="remeasure-b" type="text" inputmode="decimal" aria-describedby="remeasure-status" required /></label></div>
      <label>Side of A → B <select id="remeasure-side"><option value="above">Above the baseline</option><option value="below">Below the baseline</option></select></label>
      <p id="remeasure-status" role="status" class="note"></p>
      <div class="button-grid"><button id="remeasure-save" type="submit">Save remeasurement</button><button id="remeasure-reset" type="button">Reset fields</button></div>
    </form>
    <label class="checkbox"><input id="review-flag" type="checkbox" /> Needs remeasurement</label>
    <label>Note to self <textarea id="review-note" rows="2" maxlength="1000" placeholder="e.g. Check B reading at the deep-end corner"></textarea></label>
    <p class="note">Notes and flags save with your plot. Save remeasurement clears this point’s flag; dragging keeps it flagged until you finish checking.</p>
    <div id="review-order" class="button-grid"><button id="review-earlier" type="button">Earlier in sequence</button><button id="review-later" type="button">Later in sequence</button></div>
  </details>`;
  const checks = document.getElementById('outline-review');
  checks.innerHTML = `<h2>Check the outline</h2><label>Walking direction <select id="outline-direction"><option value="auto">Either direction</option><option value="clockwise">Clockwise</option><option value="counterclockwise">Counterclockwise</option><option value="off">Not a closed outline</option></select></label><p id="outline-status" role="status" class="note"></p><div id="outline-warnings"></div><div class="button-grid"><button id="outline-reverse" type="button">Reverse sequence</button><button id="review-next" type="button">Next to remeasure</button></div><p id="review-remaining" class="note"></p>`;
  const $ = id => document.getElementById(id);
  let selected = 'baseline', dirty = false, context = '', rendered = null;
  let cachedPositions = '', cachedReview = null;
  const currentPoint = () => store.document.points.find(p => p.id === selected);
  const currentContext = () => JSON.stringify([store.document.pointA, store.document.pointB, store.document.abDistance, store.document.unit, currentPoint()?.position, currentPoint()?.label]);
  function choose(id, open = true) {
    selected = id; dirty = false; rendered = null;
    store.select(id === 'baseline' ? null : id);
    if (open) $('review-details').open = true;
    render();
  }
  function fillMeasurements() {
    const point = currentPoint(), row = measurePoints(store.document).find(p => p.id === point?.id), divisor = UNITS[store.document.unit].toMeters;
    $('remeasure-a').value = row?.fromA == null ? '' : String(Number((row.fromA / divisor).toPrecision(12)));
    $('remeasure-b').value = row?.fromB == null ? '' : String(Number((row.fromB / divisor).toPrecision(12)));
    $('remeasure-side').value = row?.t > 0 ? 'below' : 'above';
    context = currentContext(); dirty = false;
  }
  function preview() {
    const point = currentPoint(); if (!point) return null;
    if (dirty && context !== currentContext()) throw Error('The point, units or baseline changed while you were typing. Reset fields before entering the new measurements.');
    const result = reviewMeasurements([{ id: point.id, label: point.label, first: $('remeasure-a').value.replace(',', '.'), second: $('remeasure-b').value.replace(',', '.'), side: $('remeasure-side').value }], { ...store.document, points: store.document.points.filter(p => p.id !== point.id) }, { mode: 'distances' });
    if (!result.valid) throw Error(result.rows[0].error);
    return result.rows[0].point;
  }
  function validate() {
    if (!currentPoint()) return;
    try {
      preview(); $('remeasure-save').disabled = !dirty;
      $('remeasure-status').textContent = dirty ? 'These distances form a possible triangle. Save to move the point and clear its remeasurement flag.' : `Enter distances in ${UNITS[store.document.unit].label.toLowerCase()}. A/B readings must form a triangle with the measured baseline.`;
      $('remeasure-status').dataset.tone = 'ok';
      for (const id of ['remeasure-a', 'remeasure-b']) $(id).removeAttribute('aria-invalid');
    } catch (error) {
      $('remeasure-save').disabled = true; $('remeasure-status').textContent = error.message; $('remeasure-status').dataset.tone = 'error';
      for (const id of ['remeasure-a', 'remeasure-b']) $(id).setAttribute('aria-invalid', 'true');
    }
  }
  function renderChecks() {
    const doc = store.document, key = JSON.stringify([doc.outlineDirection, doc.points.map(p => [p.id, p.label, p.position])]);
    const changed = key !== cachedPositions;
    if (changed) { cachedPositions = key; cachedReview = reviewOutline(doc); editor.setReviewWarnings(cachedReview.warnings.flatMap(warning => warning.ids)); }
    $('outline-direction').value = doc.outlineDirection || 'auto';
    $('outline-status').textContent = cachedReview.message;
    if (changed) {
    const fragment = document.createDocumentFragment();
    for (const warning of cachedReview.warnings) {
      const item = document.createElement('div'); item.className = 'outline-warning';
      const message = document.createElement('p'); message.textContent = warning.message; item.append(message);
      for (const id of warning.ids.slice(0, 8)) {
        const point = doc.points.find(p => p.id === id); if (!point) continue;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `Check ${point.label}`;
        button.addEventListener('click', () => { choose(id); host.scrollIntoView({ block: 'nearest' }); }); item.append(button);
      }
      fragment.append(item);
    }
    $('outline-warnings').replaceChildren(fragment);
    }
    const flagged = doc.points.filter(p => p.needsRemeasure).length + Number(Boolean(doc.baselineNeedsRemeasure));
    $('review-remaining').textContent = flagged ? `${flagged} item${flagged === 1 ? '' : 's'} marked for remeasurement. Orange rings mark reminders or outline checks.` : 'No remeasurement reminders. Flag any uncertain reading and leave yourself a note.';
    $('review-next').disabled = !flagged; $('outline-reverse').disabled = doc.points.length < 2;
  }
  function render() {
    const doc = store.document;
    if (selected !== 'baseline' && !currentPoint()) { selected = 'baseline'; dirty = false; rendered = null; }
    const point = currentPoint(), newSelection = rendered !== selected;
    $('review-point').replaceChildren(new Option('A–B reference points', 'baseline'), ...doc.points.map((p, index) => new Option(`${index + 1}. Point ${p.label}${p.needsRemeasure ? ' · remeasure' : ''}`, p.id)));
    $('review-point').value = selected;
    $('review-baseline').hidden = Boolean(point); $('remeasure-form').hidden = !point; $('review-order').hidden = !point;
    $('review-selected-help').textContent = point ? `Point ${point.label} · ${doc.points.indexOf(point) + 1} of ${doc.points.length} in your walking sequence. Click or drag it on the plan, or enter fresh A/B readings below.` : 'Click the green A or red B handle on the plan to check your references.';
    $('review-flag').checked = Boolean(point ? point.needsRemeasure : doc.baselineNeedsRemeasure);
    if (newSelection || document.activeElement !== $('review-note')) $('review-note').value = (point ? point.note : doc.baselineNote) || '';
    if (point && (!dirty || newSelection)) fillMeasurements();
    rendered = selected;
    $('review-earlier').disabled = !point || doc.points.indexOf(point) === 0;
    $('review-later').disabled = !point || doc.points.indexOf(point) === doc.points.length - 1;
    validate(); renderChecks();
  }
  $('review-point').addEventListener('change', () => choose($('review-point').value));
  $('review-edit-baseline').addEventListener('click', () => { $('ab-distance').focus(); $('ab-distance').scrollIntoView({ block: 'center' }); });
  $('remeasure-form').addEventListener('input', () => { dirty = true; validate(); });
  $('remeasure-reset').addEventListener('click', () => { fillMeasurements(); validate(); });
  $('remeasure-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const update = preview(); if (!update || !dirty) return;
      dirty = false;
      store.apply(doc => { const point = doc.points.find(p => p.id === selected); point.position = update.position; delete point.needsRemeasure; });
      $('remeasure-status').textContent = 'Remeasurement saved. The point moved to your readings and its reminder is cleared.';
    } catch (error) { $('remeasure-status').textContent = error.message; $('remeasure-status').dataset.tone = 'error'; }
  });
  $('review-flag').addEventListener('change', () => {
    const checked = $('review-flag').checked;
    store.apply(doc => { const object = selected === 'baseline' ? doc : doc.points.find(p => p.id === selected), key = selected === 'baseline' ? 'baselineNeedsRemeasure' : 'needsRemeasure'; if (checked) object[key] = true; else delete object[key]; });
  });
  $('review-note').addEventListener('input', () => {
    const note = $('review-note').value.trim().slice(0, 1000);
    store.apply(doc => { const object = selected === 'baseline' ? doc : doc.points.find(p => p.id === selected), key = selected === 'baseline' ? 'baselineNote' : 'note'; if (note) object[key] = note; else delete object[key]; });
  });
  for (const [id, step] of [['review-earlier', -1], ['review-later', 1]]) $(id).addEventListener('click', () => {
    store.apply(doc => { const index = doc.points.findIndex(p => p.id === selected), next = index + step; if (index < 0 || next < 0 || next >= doc.points.length) return; [doc.points[index], doc.points[next]] = [doc.points[next], doc.points[index]]; });
  });
  $('outline-direction').addEventListener('change', () => { const value = $('outline-direction').value; store.apply(doc => { if (value === 'auto') delete doc.outlineDirection; else doc.outlineDirection = value; }); });
  $('outline-reverse').addEventListener('click', () => store.apply(doc => { doc.points.reverse(); }));
  $('review-next').addEventListener('click', () => {
    const ids = [...(store.document.baselineNeedsRemeasure ? ['baseline'] : []), ...store.document.points.filter(p => p.needsRemeasure).map(p => p.id)], index = ids.indexOf(selected);
    if (ids.length) { choose(ids[(index + 1) % ids.length]); host.scrollIntoView({ block: 'nearest' }); }
  });
  let selection = store.selectedId;
  store.subscribe(() => {
    if (selection !== store.selectedId) { selection = store.selectedId; if (selection) { selected = selection; dirty = false; rendered = null; $('review-details').open = true; } }
    render();
  });
  editor.addEventListener('reference', () => choose('baseline'));
  host.addEventListener('keydown', event => event.stopPropagation());
  render();
  return { choose };
}
