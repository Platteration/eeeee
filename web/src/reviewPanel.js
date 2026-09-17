import { reviewOutline } from './plotReview.js';
import { reviewMeasurements } from './measurementImport.js';
import { measurePoints } from './measurements.js';
import { UNITS } from './plotDocument.js';
import { labelWarnings, normalizePointDescription, pointDisplayName, validatePointLabel } from './pointNames.js';

export function setupReviewPanel({ store, editor }) {
  const host = document.getElementById('point-review');
  host.innerHTML = `<details id="review-details"><summary>Review a point or A–B</summary>
    <label>Find a point <input id="review-search" type="search" placeholder="Number or description" /></label>
    <label>Show <select id="review-filter"><option value="all">All points</option><option value="flagged">Marked for remeasurement</option><option value="warnings">Points with warnings</option></select></label>
    <label>Point to check <select id="review-point"><option value="baseline">A–B reference points</option></select></label>
    <div class="button-grid"><button id="review-previous-point" type="button">Previous point</button><button id="review-next-point" type="button">Next point</button></div>
    <p id="review-navigation-status" class="note" role="status"></p>
    <p id="review-selected-help" class="note"></p>
    <div id="review-name-fields"><label>Point number or code <input id="review-label" type="text" maxlength="40" aria-describedby="review-name-status" /></label><label>Description <input id="review-description" type="text" maxlength="120" placeholder="e.g. Shallow-end corner" /></label><p id="review-name-status" class="note" role="status"></p></div>
    <div id="review-baseline"><button id="review-edit-baseline" type="button">Edit measured A–B distance</button><p class="note">Drag A or B on the plan to reposition the reference. Changing A–B changes the scale of every point.</p></div>
    <form id="remeasure-form" hidden>
      <p class="note">These are the drawing’s current distances. Replace them with your tape readings to reposition this point. Unfinished readings stay here when you switch points.</p>
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
  const drafts = new Map(), nameDrafts = new Map(), textGroups = new Map();
  let selected = 'baseline', rendered = null, selection = store.selectedId, textEdit = 0;
  let cachedPositions = '', cachedReview = null;
  const currentPoint = () => store.document.points.find(p => p.id === selected);
  const currentContext = () => JSON.stringify([store.document.pointA, store.document.pointB, store.document.abDistance, store.document.unit, currentPoint()?.position]);
  function choose(id, open = true) {
    selected = id; rendered = null;
    selection = id === 'baseline' ? null : id;
    store.select(selection);
    if (open) { $('review-details').open = true; host.dispatchEvent(new CustomEvent('abplot:review', { bubbles: true })); }
    render();
  }
  function fillMeasurements() {
    const point = currentPoint(), row = measurePoints(store.document).find(p => p.id === point?.id), divisor = UNITS[store.document.unit].toMeters;
    $('remeasure-a').value = row?.fromA == null ? '' : String(Number((row.fromA / divisor).toPrecision(12)));
    $('remeasure-b').value = row?.fromB == null ? '' : String(Number((row.fromB / divisor).toPrecision(12)));
    $('remeasure-side').value = row?.t > 0 ? 'below' : 'above';
  }
  function showDraft() {
    const draft = drafts.get(selected);
    if (!draft) { fillMeasurements(); return; }
    $('remeasure-a').value = draft.a; $('remeasure-b').value = draft.b; $('remeasure-side').value = draft.side;
  }
  function preview() {
    const point = currentPoint(); if (!point) return null;
    const draft = drafts.get(selected);
    if (draft && draft.context !== currentContext()) throw Error('The point, units or baseline changed while you were typing. Reset fields before entering the new measurements.');
    const result = reviewMeasurements([{ id: point.id, label: point.label, first: $('remeasure-a').value.replace(',', '.'), second: $('remeasure-b').value.replace(',', '.'), side: $('remeasure-side').value }], store.document, { mode: 'distances', existingPointId: point.id });
    if (!result.valid) throw Error(result.rows[0].error);
    return result.rows[0].point;
  }
  function validate() {
    if (!currentPoint()) return;
    try {
      const dirty = drafts.has(selected);
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
    if (changed) { cachedPositions = key; cachedReview = reviewOutline(doc); cachedReview.nameWarnings = labelWarnings(doc); editor.setReviewWarnings([...cachedReview.warnings, ...cachedReview.nameWarnings].flatMap(warning => warning.ids)); }
    $('outline-direction').value = doc.outlineDirection || 'auto';
    $('outline-status').textContent = cachedReview.message + (cachedReview.nameWarnings.length ? ` ${cachedReview.nameWarnings.length} point name${cachedReview.nameWarnings.length === 1 ? '' : 's'} also need attention.` : '');
    if ($('check-count')) $('check-count').textContent = String(cachedReview.warnings.length + cachedReview.nameWarnings.length);
    if (changed) {
    const fragment = document.createDocumentFragment();
    for (const warning of [...cachedReview.warnings, ...cachedReview.nameWarnings]) {
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
  function filteredPoints() {
    const query = $('review-search').value.trim().toLowerCase(), filter = $('review-filter').value;
    const warningIds = new Set([...(cachedReview?.warnings || []), ...(cachedReview?.nameWarnings || [])].flatMap(w => w.ids));
    return store.document.points.filter(point => (!query || pointDisplayName(point).toLowerCase().includes(query)) && (filter === 'all' || filter === 'flagged' && point.needsRemeasure || filter === 'warnings' && warningIds.has(point.id)));
  }
  function renderNameStatus() {
    const point = currentPoint(); if (!point) return;
    let error = '';
    try { validatePointLabel(nameDrafts.get(selected) ?? point.label, store.document.points, selected); }
    catch (reason) { error = reason.message; }
    $('review-name-status').textContent = error || 'Numbers stay with their points when you change the walking sequence. Names save when you leave the field.';
    $('review-name-status').dataset.tone = error ? 'error' : 'ok';
    if (error) $('review-label').setAttribute('aria-invalid', 'true'); else $('review-label').removeAttribute('aria-invalid');
  }
  function render() {
    const doc = store.document;
    // A point can disappear temporarily during Undo and return on Redo.
    // Retain its unapplied fields by UUID until an explicit discard or project
    // replacement; document history alone cannot restore these field drafts.
    if (selected !== 'baseline' && !currentPoint()) { selected = 'baseline'; rendered = null; }
    renderChecks();
    const point = currentPoint(), newSelection = rendered !== selected;
    const visible = filteredPoints(), outsideFilter = point && !visible.some(p => p.id === selected);
    const options = [new Option('A–B reference points', 'baseline'), ...visible.map(p => new Option(`${pointDisplayName(p)}${p.needsRemeasure ? ' · remeasure' : ''}`, p.id))];
    if (outsideFilter) options.push(new Option(`${pointDisplayName(point)} · selected outside filter`, point.id));
    const optionKey = JSON.stringify(options.map(option => [option.value, option.textContent]));
    if ($('review-point').dataset.options !== optionKey) { $('review-point').replaceChildren(...options); $('review-point').dataset.options = optionKey; }
    $('review-point').value = selected;
    const visibleIndex = visible.findIndex(p => p.id === selected);
    $('review-previous-point').disabled = visibleIndex <= 0;
    $('review-next-point').disabled = !visible.length || visibleIndex === visible.length - 1;
    $('review-navigation-status').textContent = `${visible.length} point${visible.length === 1 ? '' : 's'} shown${outsideFilter ? '. Your selected point is outside this filter.' : '.'}`;
    $('review-baseline').hidden = Boolean(point); $('remeasure-form').hidden = !point; $('review-order').hidden = !point; $('review-name-fields').hidden = !point;
    $('review-selected-help').textContent = point ? `Point ${pointDisplayName(point)} · position ${doc.points.indexOf(point) + 1} of ${doc.points.length} in your walking sequence. Click or drag it on the plan, or enter fresh A/B readings below.` : 'Click the green A or red B handle on the plan to check your references.';
    $('review-flag').checked = Boolean(point ? point.needsRemeasure : doc.baselineNeedsRemeasure);
    if (newSelection || document.activeElement !== $('review-note')) $('review-note').value = (point ? point.note : doc.baselineNote) || '';
    if (point) {
      if (newSelection || document.activeElement !== $('review-label')) $('review-label').value = nameDrafts.get(selected) ?? point.label;
      if (newSelection || document.activeElement !== $('review-description')) $('review-description').value = point.description || '';
      if (newSelection || !drafts.has(selected)) showDraft();
      renderNameStatus();
    }
    rendered = selected;
    $('review-earlier').disabled = !point || doc.points.indexOf(point) === 0;
    $('review-later').disabled = !point || doc.points.indexOf(point) === doc.points.length - 1;
    validate();
  }
  $('review-point').addEventListener('change', () => choose($('review-point').value));
  $('review-search').addEventListener('input', render);
  $('review-filter').addEventListener('change', render);
  for (const [id, step] of [['review-previous-point', -1], ['review-next-point', 1]]) $(id).addEventListener('click', () => {
    const points = filteredPoints(), index = points.findIndex(point => point.id === selected), next = points[index + step];
    if (next) choose(next.id);
  });
  $('review-label').addEventListener('input', () => { nameDrafts.set(selected, $('review-label').value); renderNameStatus(); });
  $('review-label').addEventListener('change', () => {
    try {
      const label = validatePointLabel($('review-label').value, store.document.points, selected);
      nameDrafts.delete(selected);
      store.apply(doc => { const point = doc.points.find(p => p.id === selected); if (point) point.label = label; });
      $('review-label').value = label; renderNameStatus();
    } catch { renderNameStatus(); }
  });
  $('review-label').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('review-label').blur(); }
    if (event.key === 'Escape') { nameDrafts.delete(selected); $('review-label').value = currentPoint()?.label || ''; renderNameStatus(); }
  });
  for (const id of ['review-note', 'review-description']) $(id).addEventListener('focus', () => textGroups.set(id, `${id}:${selected}:${++textEdit}`));
  $('review-description').addEventListener('input', () => {
    const description = normalizePointDescription($('review-description').value);
    store.apply(doc => { const point = doc.points.find(p => p.id === selected); if (!point) return; if (description) point.description = description; else delete point.description; }, { historyGroup: `${textGroups.get('review-description')}:${selected}` });
  });
  $('review-edit-baseline').addEventListener('click', () => requestAnimationFrame(() => { $('ab-distance').focus(); $('ab-distance').scrollIntoView({ block: 'center' }); }));
  $('remeasure-form').addEventListener('input', () => {
    drafts.set(selected, { a: $('remeasure-a').value, b: $('remeasure-b').value, side: $('remeasure-side').value, context: drafts.get(selected)?.context ?? currentContext() });
    validate();
  });
  $('remeasure-reset').addEventListener('click', () => { drafts.delete(selected); fillMeasurements(); validate(); });
  $('remeasure-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const update = preview(); if (!update || !drafts.has(selected)) return;
      drafts.delete(selected);
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
    store.apply(doc => { const object = selected === 'baseline' ? doc : doc.points.find(p => p.id === selected), key = selected === 'baseline' ? 'baselineNote' : 'note'; if (note) object[key] = note; else delete object[key]; }, { historyGroup: `${textGroups.get('review-note')}:${selected}` });
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
  store.subscribe(() => {
    if (selection !== store.selectedId) { selection = store.selectedId; if (selection) { selected = selection; rendered = null; $('review-details').open = true; } }
    render();
  });
  editor.addEventListener('reference', () => choose('baseline'));
  host.addEventListener('keydown', event => event.stopPropagation());
  render();
  return { choose, get hasDraft() { return drafts.size > 0 || nameDrafts.size > 0; }, discardDrafts() { drafts.clear(); nameDrafts.clear(); rendered = null; render(); } };
}
