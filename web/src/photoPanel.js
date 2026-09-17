import { photoRecovery } from './photoRecovery.js';
import { loadPhoto, preparePhoto } from './ocr.js';
import { withTimeout, LatestOperation } from './operations.js';
import { changeUnit, fileStem, nextLabel, parseDocument, serializeDocument } from './plotDocument.js';
import { pointDisplayName, normalizePointDescription } from './pointNames.js';
import { reviewMeasurements } from './measurementImport.js';
import { downloadBlob, downloadText } from './exporters.js';
import { photoState, photoFromState } from './projectState.js';
import { PHOTO_PROJECT_FORMAT, photoSettings, plotLandmarks, overlayGeometry, photoOverlaySvg, serializePhotoProject, parsePhotoProject } from './photoOverlay.js';

export function setupPhotoPanel({ store, editor, onOpen = () => {}, onClose = () => {}, onRecoveryStatus = () => {}, beforeReplace = () => true }) {
  const workspace = document.createElement('section'); workspace.id = 'pool-photo'; workspace.hidden = true; workspace.setAttribute('aria-labelledby', 'pool-photo-title');
  workspace.innerHTML = `<header class="photo-header"><div><h2 id="pool-photo-title">Pool photo</h2><p>Keep your measured plan and photo together. Photo matches never change your measurements.</p></div><button id="photo-close" type="button">Back to plan</button></header>
    <div class="photo-files"><label>Choose pool photo <input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>Open project <input id="photo-project-file" type="file" accept=".json,application/json" /></label></div>
    <details class="photo-recovery"><summary>Recover work from this browser</summary><label>Recovery copies <select id="photo-recovery-list" aria-label="Saved photo recoveries"><option value="">No recovery copies found</option></select></label><button id="photo-recover" type="button" disabled>Open recovery copy</button><button id="photo-delete-recovery" type="button" disabled>Delete recovery copy</button><p id="photo-recovery-status" role="status" class="note">Save project downloads a portable copy. Browser recovery stays on this device.</p></details>
    <p id="photo-status" role="status">Choose a pool photo, then select Match to place your measured points.</p>
    <div id="photo-workspace" hidden><div class="photo-stage"><div class="photo-toolbar">
      <label>Photo tool <select id="photo-tool"><option value="select">Select</option><option value="move">Move match</option><option value="match">Match</option><option value="pan">Pan</option></select></label>
      <button id="photo-fit" type="button">Fit photo</button><button id="photo-zoom-out" type="button" aria-label="Zoom photo out">−</button><button id="photo-zoom-in" type="button" aria-label="Zoom photo in">+</button><button id="photo-undo" type="button">Undo</button></div>
      <svg id="photo-canvas" role="img" aria-label="Pool photo with measured point overlay" aria-describedby="photo-tool-note photo-fit-note" tabindex="0"></svg>
      <p id="photo-tool-note" class="note">Select a marker to inspect it. Choose Match to place points or Move match to adjust them.</p><p id="photo-fit-note" class="note"></p>
    </div><section class="photo-controls" aria-label="Photo matching controls">
      <p id="photo-progress" role="status"></p><label>Selected point <select id="photo-point"></select></label>
      <label>Measured A–B distance <input id="photo-baseline" type="number" min="0" step="any" /></label><p id="photo-baseline-status" class="note" role="status"></p><div class="button-grid"><button id="photo-baseline-apply" type="button" disabled>Apply A–B reference</button><button id="photo-baseline-reset" type="button" disabled>Reset field</button></div>
      <label>Plot units <select id="photo-unit"><option value="meters">Meters</option><option value="feet">Feet</option></select></label>
      <label>Match workflow <select id="photo-mode"><option value="match">Match an existing point</option><option value="new">Click, then enter A/B distances</option></select></label>
      <div id="photo-match-controls"><label class="checkbox"><input id="photo-next" type="checkbox" checked /> Advance to the next unmatched point</label><button id="photo-unmatch" type="button">Remove selected match</button></div>
      <form id="photo-measure-form" hidden><p id="photo-pending-note">Choose Match, then click the photo where you took a measurement.</p><label>Point number or code <input id="photo-label" type="text" maxlength="40" required /></label><label>Description (optional) <input id="photo-description" type="text" maxlength="120" placeholder="Deep-end corner" /></label><label>Distance from A <input id="photo-from-a" type="text" inputmode="decimal" required /></label><label>Distance from B <input id="photo-from-b" type="text" inputmode="decimal" required /></label><label>Side in the measured plan <select id="photo-side"><option value="above">Above A→B</option><option value="below">Below A→B</option></select></label><p class="note">Side refers to the measured plan, not the photo's vertical direction.</p><p id="photo-measure-status" role="status"></p><button id="photo-draft-reset" type="button" hidden>Review with current reference</button><button id="photo-add-measured" type="submit" disabled>Add measured point here</button></form>
      <details><summary>Overlay appearance</summary><fieldset><legend>Overlay appearance</legend><label>Opacity <input id="photo-opacity" type="range" min="0" max="1" step="0.05" value="0.9" /></label><label class="checkbox"><input id="photo-labels" type="checkbox" checked /> Point labels</label><label class="checkbox"><input id="photo-distances" type="checkbox" /> A/B measurements</label><label class="checkbox"><input id="photo-outline" type="checkbox" checked /> Connect points in plot order</label><label class="checkbox"><input id="photo-closed" type="checkbox" checked /> Close the pool outline</label><label class="checkbox"><input id="photo-project" type="checkbox" /> Project unmatched points</label><p class="note">Perspective projection needs four or more well-spaced matches on the same plane, such as the pool rim. It does not reconstruct depth or measure distances from the photo.</p></fieldset></details>
      <div class="button-grid"><button id="photo-save-project" type="button">Save project</button><button id="photo-export-png" type="button">Export overlaid PNG</button><button id="photo-export-svg" type="button">Export overlaid SVG</button><button id="photo-remove" type="button">Remove photo</button></div>
      <p id="photo-save-note" class="note">Save project includes the photo, matches and measured plot.</p>
    </section></div>`;
  (document.querySelector('main') ?? document.body).append(workspace);
  const $ = id => document.getElementById(`photo-${id}`), svg = $('canvas');
  const imageLayer = document.createElementNS('http://www.w3.org/2000/svg', 'image'), overlayLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(imageLayer, overlayLayer);
  let state = store.projectPhoto, photo = photoFromState(state), renderedAsset = null, previousDocument = store.document;
  let selected = 'A', pending = null, dirty = false, loading = false, view = null, drag = null, draftContext = null;
  let baselineDraft = null, baselineDraftUnit = null;
  let recoveryStatus = { state: 'none', message: '' }, guard = beforeReplace;
  const reads = new LatestOperation(), recovery = photoRecovery();
  let recoveryTimer, recoveryWork = Promise.resolve(), recoveryRecords = [], recoveryGeneration = 0;
  const note = text => { $('status').textContent = text; };
  function setRecoveryStatus(next) { recoveryStatus = next; $('recovery-status').textContent = next.message; onRecoveryStatus(next); }
  async function listRecoveries() {
    try {
      recoveryRecords = await recovery.list();
      $('recovery-list').replaceChildren(...(recoveryRecords.length ? recoveryRecords.map(record => new Option(`${record.name || 'Untitled pool'} · ${new Date(record.updated).toLocaleString()}`, record.id)) : [new Option('No recovery copies found', '')]));
      $('recover').disabled = $('delete-recovery').disabled = !recoveryRecords.length;
    } catch { setRecoveryStatus({ state: 'error', message: 'Browser recovery is unavailable. Save project to keep your work in a file.' }); }
  }
  function persistSnapshot(doc, snapshot) {
    if (!snapshot) return recoveryWork;
    const generation = ++recoveryGeneration, id = snapshot.recoveryId;
    const record = { id, name: doc.name || snapshot.asset.name, updated: Date.now(), text: serializePhotoProject(doc, photoFromState(snapshot)) };
    if (id === store.projectPhoto?.recoveryId) setRecoveryStatus({ state: 'saving', message: 'Saving project recovery on this browser…' });
    recoveryWork = recoveryWork.then(() => recovery.save(record)).then(() => {
      if (generation === recoveryGeneration && id === store.projectPhoto?.recoveryId) setRecoveryStatus({ state: 'saved', message: 'Plot and photo recovery saved on this browser. Save project downloads a portable copy.' });
    }).catch(() => {
      if (generation === recoveryGeneration && id === store.projectPhoto?.recoveryId) setRecoveryStatus({ state: 'error', message: 'Could not save photo recovery. The last saved copy is kept. Save project now.' });
    });
    return recoveryWork;
  }
  function saveRecovery() { clearTimeout(recoveryTimer); return persistSnapshot(store.document, store.projectPhoto); }
  function queueRecovery() {
    clearTimeout(recoveryTimer);
    if (!store.projectPhoto) return;
    // An older in-flight write may finish during this debounce. It must not
    // announce "saved" while this newer snapshot is still waiting to persist.
    recoveryGeneration++;
    setRecoveryStatus({ state: 'saving', message: 'Saving project recovery on this browser…' });
    recoveryTimer = setTimeout(saveRecovery, 400);
  }
  $('recover').addEventListener('click', async () => {
    const record = recoveryRecords.find(item => item.id === $('recovery-list').value); if (!record) return;
    try { await openProject(new File([record.text], 'browser-recovery.json', { type: 'application/json' })); } catch (error) { note(error.message); }
  });
  $('delete-recovery').addEventListener('click', async () => {
    const id = $('recovery-list').value;
    if (!id || !confirm('Delete this browser recovery copy? Save project first if you need to keep it.')) return;
    if (id === state?.recoveryId) { clearTimeout(recoveryTimer); recoveryGeneration++; }
    try { await recoveryWork; await recovery.remove(id); await listRecoveries(); setRecoveryStatus({ state: 'none', message: 'Recovery copy deleted. Further edits create a new copy.' }); }
    catch { setRecoveryStatus({ state: 'error', message: 'Could not delete the recovery copy. Try again.' }); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && photo) void saveRecovery(); });
  const referenceContext = () => JSON.stringify([store.document.pointA, store.document.pointB, store.document.abDistance, store.document.unit]);
  function measurementReview() {
    return reviewMeasurements([{ label: $('label').value, first: $('from-a').value.replace(',', '.'), second: $('from-b').value.replace(',', '.'), side: $('side').value }], store.document, { mode: 'distances' });
  }
  function validateDraft() {
    const stale = draftContext !== null && draftContext !== referenceContext();
    $('draft-reset').hidden = !stale;
    const hasReadings = !!($('from-a').value || $('from-b').value);
    let error = '';
    if (stale) error = 'The A–B reference or units changed. Your entries are kept. Review them with the current reference before adding this point.';
    else if (pending && hasReadings) { try { const result = measurementReview(); if (!result.valid) error = result.rows[0].error; } catch (reason) { error = reason.message; } }
    $('measure-status').textContent = error || (pending ? 'Check the readings, units and side, then add this point.' : 'Choose a location on the photo first.');
    $('add-measured').disabled = !pending || stale || !!error || !$('from-a').value || !$('from-b').value;
    for (const key of ['from-a', 'from-b']) $(key).setAttribute('aria-invalid', String(!!error));
    return !error;
  }
  function resetDraft() { pending = null; draftContext = null; $('from-a').value = ''; $('from-b').value = ''; $('description').value = ''; $('label').value = nextLabel(store.document.points); validateDraft(); }
  function selectionOptions() {
    const landmarks = plotLandmarks(store.document);
    if (!landmarks.some(p => p.id === selected)) selected = landmarks.find(p => !photo?.pins[p.id])?.id ?? 'A';
    $('point').replaceChildren(...landmarks.map(p => new Option(`${pointDisplayName(p)}${photo?.pins[p.id] ? ' · matched' : ''}`, p.id)));
    $('point').value = selected;
    const matched = landmarks.filter(p => Object.hasOwn(photo.pins, p.id)).length;
    $('progress').textContent = `${matched} of ${landmarks.length} points matched. Selected: ${pointDisplayName(landmarks.find(p => p.id === selected))}.`;
  }
  const fit = () => { if (!photo) return; view = { x: 0, y: 0, width: photo.width, height: photo.height }; render(); };
  function render() {
    $('workspace').hidden = !photo;
    if (!photo) { imageLayer.removeAttribute('href'); overlayLayer.replaceChildren(); renderedAsset = null; return; }
    if (!view) view = { x: 0, y: 0, width: photo.width, height: photo.height };
    selectionOptions();
    if (baselineDraft === null) $('baseline').value = store.document.abDistance;
    $('unit').value = store.document.unit;
    for (const key of ['labels', 'distances', 'outline', 'closed', 'project']) $(key).checked = photo.settings[key];
    $('opacity').value = photo.settings.opacity;
    $('match-controls').hidden = $('mode').value !== 'match'; $('measure-form').hidden = $('mode').value !== 'new';
    $('undo').disabled = !store.canUndo; $('unmatch').disabled = !Object.hasOwn(photo.pins, selected);
    const tool = $('tool').value;
    svg.dataset.tool = tool;
    $('tool-note').textContent = { select: 'Select a marker to inspect it. Choose Match to place points or Move match to adjust them.', move: 'Drag a matched marker, or select one and use arrow keys on the photo. Only its photo match moves.', match: 'Click an empty location to match the selected point. Clicking an existing marker selects it.', pan: 'Drag the background to pan. Use zoom for precise placement.' }[tool];
    const rect = svg.getBoundingClientRect(), markerSize = Math.max(view.width / Math.max(rect.width, 1), view.height / Math.max(rect.height, 1)) * 9;
    if (renderedAsset !== state.asset) { imageLayer.setAttribute('href', photo.dataUrl); imageLayer.setAttribute('width', photo.width); imageLayer.setAttribute('height', photo.height); renderedAsset = state.asset; }
    const previewPhoto = drag?.preview ? { ...photo, pins: { ...photo.pins, [drag.marker]: drag.preview } } : photo;
    const markup = photoOverlaySvg(store.document, previewPhoto, { selected, markerSize, includePhoto: false, interactive: true });
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    overlayLayer.replaceChildren(...Array.from(parsed.children).map(node => document.importNode(node, true)));
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    if (pending) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [key, value] of Object.entries({ cx: pending.x, cy: pending.y, r: markerSize * 1.5, fill: 'none', stroke: '#ffea00', 'stroke-width': markerSize / 3, 'data-pending-photo-point': '' })) circle.setAttribute(key, value);
      overlayLayer.append(circle);
    }
    $('fit-note').textContent = overlayGeometry(store.document, photo).message;
    previewBaseline();
    validateDraft();
  }
  function zoom(factor) {
    if (!view) return;
    const width = Math.max(photo.width / 20, Math.min(photo.width * 2, view.width / factor)), height = width * photo.height / photo.width;
    view = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height }; render();
  }
  const position = event => {
    const matrix = svg.getScreenCTM(); if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y };
  };
  const inside = p => p && p.x >= 0 && p.y >= 0 && p.x <= photo.width && p.y <= photo.height;
  function choose(id) { selected = id; if (id !== 'A' && id !== 'B') store.select(id); render(); }
  const cancelPointer = () => { drag = null; render(); };
  svg.addEventListener('pointerdown', event => {
    if (!photo || loading || event.button !== 0) return;
    if (drag) { cancelPointer(); return; }
    const p = position(event); if (!p) return;
    const marker = event.target.closest('[data-photo-id]')?.getAttribute('data-photo-id') ?? null;
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, position: p, moved: false, marker, tool: $('tool').value };
    if (marker) choose(marker);
    svg.focus({ preventScroll: true });
    try { svg.setPointerCapture(event.pointerId); } catch { /* pointer ended */ }
  });
  svg.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 5) return;
    drag.moved = true; const p = position(event); if (!p) return;
    if (drag.tool === 'move' && drag.marker && photo.pins[drag.marker]) {
      drag.preview = { x: Math.max(0, Math.min(photo.width, p.x)), y: Math.max(0, Math.min(photo.height, p.y)) }; render();
    } else if (drag.tool === 'pan') { view.x -= p.x - drag.position.x; view.y -= p.y - drag.position.y; render(); }
  });
  svg.addEventListener('pointercancel', cancelPointer); svg.addEventListener('lostpointercapture', () => { if (drag) cancelPointer(); });
  svg.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const previous = drag; drag = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (previous.preview) { store.applyProject(project => { project.photo.pins[previous.marker] = previous.preview; }); note('Photo match moved. Measured distances are unchanged.'); return; }
    if (previous.moved || previous.marker || previous.tool !== 'match') return;
    const p = position(event); if (!inside(p)) { note('Click inside the photo.'); return; }
    if ($('mode').value === 'new') {
      pending = p; if (draftContext === null) draftContext = referenceContext();
      $('pending-note').textContent = 'Location marked in yellow. Enter your measured distances from A and B.';
      if (!$('label').value.trim()) $('label').value = nextLabel(store.document.points);
      $('from-a').focus();
    } else {
      const id = selected, landmark = plotLandmarks(store.document).find(point => point.id === id);
      store.applyProject(project => { project.photo.pins[id] = p; });
      note(`Matched ${pointDisplayName(landmark)}. Its measured position is unchanged.`);
      if ($('next').checked) {
        const landmarks = plotLandmarks(store.document), start = landmarks.findIndex(point => point.id === id) + 1;
        selected = [...landmarks.slice(start), ...landmarks.slice(0, start)].find(point => !Object.hasOwn(photo.pins, point.id))?.id ?? id;
      }
    }
    render();
  });
  svg.addEventListener('wheel', event => { if (photo) { event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });
  svg.addEventListener('keydown', event => {
    if (!photo || event.target !== svg) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key] && $('tool').value === 'move' && photo.pins[selected]) {
      event.preventDefault(); const [x, y] = arrows[event.key], delta = event.shiftKey ? 10 : 1;
      store.applyProject(project => { const p = project.photo.pins[selected]; p.x = Math.max(0, Math.min(photo.width, p.x + x * delta)); p.y = Math.max(0, Math.min(photo.height, p.y + y * delta)); });
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? store.redo() : store.undo(); }
  });
  new ResizeObserver(() => { if (!workspace.hidden && photo) render(); }).observe(svg);
  workspace.addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('tool').value = 'select'; $('tool').dispatchEvent(new Event('change')); event.preventDefault(); }
    event.stopPropagation();
  });
  function open() { workspace.hidden = false; onOpen(); render(); void listRecoveries(); }
  function cancelOpen() { reads.cancel(); loading = false; cancelPointer(); }
  function close() { if (photo) void saveRecovery(); workspace.hidden = true; cancelOpen(); onClose(); }
  document.getElementById('pool-photo-button')?.addEventListener('click', open);
  $('close').addEventListener('click', close);
  $('fit').addEventListener('click', fit); $('zoom-in').addEventListener('click', () => zoom(1.4)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.4));
  $('point').addEventListener('change', () => choose($('point').value));
  $('tool').addEventListener('change', () => { cancelPointer(); render(); });
  let previousMode = $('mode').value;
  $('mode').addEventListener('change', () => {
    if (hasMeasurementDraft() && !confirm('Discard the unfinished photo measurement and change workflow?')) { $('mode').value = previousMode; return; }
    previousMode = $('mode').value; resetDraft(); if ($('mode').value === 'new') $('tool').value = 'match'; render();
  });
  $('undo').addEventListener('click', () => store.undo());
  $('unmatch').addEventListener('click', () => store.applyProject(project => { delete project.photo.pins[selected]; }));
  let opacityGroup;
  $('opacity').addEventListener('pointerdown', () => { opacityGroup = {}; });
  $('opacity').addEventListener('change', () => { opacityGroup = null; store.endHistoryGroup(); });
  for (const key of ['opacity', 'labels', 'distances', 'outline', 'closed', 'project']) $(key).addEventListener('input', () => store.applyProject(project => { project.photo.settings[key] = key === 'opacity' ? Number($(key).value) : $(key).checked; }, { historyGroup: key === 'opacity' ? opacityGroup : null }));
  function previewBaseline() {
    const value = Number(baselineDraft), stale = baselineDraft !== null && baselineDraftUnit !== store.document.unit;
    const valid = baselineDraft !== null && baselineDraft.trim() && Number.isFinite(value) && value > 0 && !stale;
    $('baseline-apply').disabled = !valid || value === store.document.abDistance;
    $('baseline-reset').disabled = baselineDraft === null;
    $('baseline-status').textContent = baselineDraft === null ? 'The A–B reference determines every measured distance.' : stale ? 'Units changed. Re-enter the A–B reference in the current units.' : !valid ? 'Enter the positive A–B distance you measured.' : value === store.document.abDistance ? 'This is the current reference.' : `Apply ${value} ${store.document.unit === 'feet' ? 'ft' : 'm'} to rescale every point. Photo matches stay in place.`;
  }
  $('baseline').addEventListener('input', () => { baselineDraft = $('baseline').value; baselineDraftUnit = store.document.unit; previewBaseline(); });
  function resetBaselineDraft() { baselineDraft = baselineDraftUnit = null; $('baseline').value = store.document.abDistance; previewBaseline(); }
  $('baseline-reset').addEventListener('click', resetBaselineDraft);
  $('baseline-apply').addEventListener('click', () => {
    previewBaseline(); if ($('baseline-apply').disabled) return;
    try { const value = Number(baselineDraft); store.apply(doc => { doc.abDistance = value; }); resetBaselineDraft(); note('A–B reference applied. Check the resulting measurements.'); }
    catch (error) { note(error.message); } render();
  });
  $('unit').addEventListener('change', () => { try { store.apply(doc => changeUnit(doc, $('unit').value)); } catch (error) { note(error.message); } render(); });
  for (const key of ['label', 'description', 'from-a', 'from-b', 'side']) $(key).addEventListener('input', () => { if (draftContext === null) draftContext = referenceContext(); validateDraft(); });
  $('draft-reset').addEventListener('click', () => { draftContext = referenceContext(); validateDraft(); $('from-a').focus(); });
  $('measure-form').addEventListener('submit', event => {
    event.preventDefault(); if (!pending || !validateDraft()) return;
    try {
      const result = measurementReview(); if (!result.valid) throw Error(result.rows[0].error);
      const point = result.rows[0].point, description = normalizePointDescription($('description').value); if (description) point.description = description;
      const match = pending;
      store.applyProject(project => { project.document.points.push(point); project.photo.pins[point.id] = match; });
      selected = point.id; resetDraft(); $('pending-note').textContent = 'Click the next measured location in the photo.';
      note(`Added ${pointDisplayName(point)} to the measured plot and matched it to the photo.`); render();
    } catch (error) { note(error.message); }
  });
  async function imageData(blob) { return withTimeout(new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Could not read the photo.')); reader.readAsDataURL(blob); })); }
  $('file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    if (photo && !guard()) return;
    const current = reads.start(), revision = store.revision; loading = true; note('Preparing your pool photo…');
    let bitmap, prepared;
    try {
      bitmap = await loadPhoto(file); const blob = await preparePhoto(bitmap); prepared = await createImageBitmap(blob); const dataUrl = await imageData(blob);
      if (!current()) return;
      if (store.revision !== revision) throw Error('The project changed while the photo was loading. Choose the photo again when ready.');
      const next = photoState({ name: file.name, dataUrl, width: prepared.width, height: prepared.height, pins: {}, settings: photoSettings() }, crypto.randomUUID());
      store.applyProject(project => { project.photo = next; }); selected = 'A'; resetDraft(); $('tool').value = 'select'; fit();
      note('Photo ready. Choose Match to place points, or Select to inspect existing marks. A and B are optional if they are outside the photo.');
    } catch (error) { if (current()) note(error.message); }
    finally { bitmap?.close(); prepared?.close(); if (current()) loading = false; }
  });
  function replaceDocument(doc) {
    if (!guard()) return false;
    discardDrafts();
    cancelOpen(); store.applyProject(project => { project.document = structuredClone(doc); project.photo = null; });
    selected = 'A'; resetDraft(); dirty = false; editor.fit(); return true;
  }
  async function openProject(file) {
    if (!file) return false;
    const current = reads.start(), revision = store.revision; loading = true;
    let bitmap;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error('Choose a project smaller than 8 MB.');
      const text = await withTimeout(file.text()); let raw;
      try { raw = JSON.parse(text); } catch { throw Error('This is not valid project JSON. Choose an ABPlot project or plot file.'); }
      const project = raw?.format === PHOTO_PROJECT_FORMAT ? parsePhotoProject(text) : { document: parseDocument(raw), photo: null };
      if (project.photo) {
        const bytes = Uint8Array.from(atob(project.photo.dataUrl.split(',')[1]), c => c.charCodeAt(0));
        bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        if (bitmap.width !== project.photo.width || bitmap.height !== project.photo.height) throw Error('The image dimensions do not match this project.');
      }
      if (!current()) return false;
      if (store.revision !== revision) throw Error('The project changed while loading. Open the file again when ready.');
      if (!guard()) return false;
      discardDrafts();
      store.applyProject(draft => { draft.document = project.document; draft.photo = photoState(project.photo, crypto.randomUUID()); });
      selected = 'A'; resetDraft(); dirty = false; editor.fit();
      if (photo) { open(); fit(); } else if (!workspace.hidden) close();
      $('save-note').textContent = 'Project opened. Save project downloads a new copy after your edits.'; note(`Opened ${file.name}. Undo restores the previous project.`); return true;
    } finally { bitmap?.close(); if (current()) loading = false; }
  }
  $('project-file').addEventListener('change', async event => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; try { await openProject(file); } catch (error) { note(error.message); } });
  async function exporting(button, action) { button.disabled = true; try { await action(); } catch (error) { note(`Could not export: ${error.message}`); } finally { button.disabled = false; } }
  function saveProject() {
    const filename = `${fileStem(store.document)}${photo ? '-photo-project' : ''}.json`;
    downloadText(filename, photo ? serializePhotoProject(store.document, photo) : serializeDocument(store.document), 'application/json'); dirty = false;
    $('save-note').textContent = 'Project download requested. Keep that file to reopen all the saved work.'; return filename;
  }
  $('save-project').addEventListener('click', () => exporting($('save-project'), saveProject));
  $('export-svg').addEventListener('click', () => exporting($('export-svg'), () => { downloadText(`${fileStem(store.document)}-photo.svg`, photoOverlaySvg(store.document, photo), 'image/svg+xml'); note('Overlaid SVG download requested.'); }));
  $('export-png').addEventListener('click', () => exporting($('export-png'), async () => {
    const snapshot = photo, filename = `${fileStem(store.document)}-photo.png`, url = URL.createObjectURL(new Blob([photoOverlaySvg(store.document, snapshot)], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); await withTimeout(new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('Could not render the photo overlay.')); image.src = url; }));
      const canvas = document.createElement('canvas'); canvas.width = snapshot.width; canvas.height = snapshot.height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Image export is unavailable. Try SVG.'); ctx.drawImage(image, 0, 0);
      const blob = await withTimeout(new Promise(resolve => canvas.toBlob(resolve, 'image/png'))); if (!blob) throw Error('Could not encode the overlay.');
      downloadBlob(filename, blob); note('Overlaid PNG download requested.');
    } finally { URL.revokeObjectURL(url); }
  }));
  $('remove').addEventListener('click', () => {
    if (!confirm('Remove the photo and its matches? The measured plot and earlier browser recovery will be kept. Undo can restore the photo.')) return;
    cancelOpen(); store.applyProject(project => { project.photo = null; }); resetDraft(); dirty = false; note('Photo removed. Undo restores it. Earlier recovery copies remain available.');
  });
  let revision = store.revision;
  store.subscribe(() => {
    const nextState = store.projectPhoto, assetChanged = nextState?.asset !== state?.asset;
    if (assetChanged) {
      clearTimeout(recoveryTimer); if (state) void persistSnapshot(previousDocument, state);
      view = null; pending = null; draftContext = null; drag = null; baselineDraft = baselineDraftUnit = null;
    }
    state = nextState; photo = photoFromState(state);
    if (store.revision !== revision) {
      dirty = !!photo;
      if (photo) { $('save-note').textContent = 'Project has changes. Save project downloads the photo, matches and measured plot together.'; queueRecovery(); }
      else if (assetChanged) { recoveryGeneration++; setRecoveryStatus({ state: 'none', message: 'No photo attached. Earlier photo recovery copies remain available.' }); }
    }
    previousDocument = store.document; revision = store.revision;
    if (!workspace.hidden) render();
  });
  function hasBaselineDraft() {
    if (baselineDraft === null) return false;
    const value = Number(baselineDraft);
    return !baselineDraft.trim() || !Number.isFinite(value) || value <= 0 || value !== store.document.abDistance || baselineDraftUnit !== store.document.unit;
  }
  function hasMeasurementDraft() { return !!($('from-a').value || $('from-b').value || $('description').value || pending); }
  function hasDraft() { return hasMeasurementDraft() || hasBaselineDraft(); }
  function discardDrafts() { resetBaselineDraft(); resetDraft(); render(); }
  window.addEventListener('beforeunload', event => { if ((photo && dirty) || hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
  return { open, close, cancelOpen, openProject, replaceDocument, saveProject, discardDrafts, setBeforeReplace: callback => { guard = callback; }, get hasDraft() { return hasDraft(); }, get photo() { return photo; }, get recoveryStatus() { return recoveryStatus; } };
}
