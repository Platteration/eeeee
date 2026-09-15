import { photoRecovery } from './photoRecovery.js';
import { loadPhoto, preparePhoto } from './ocr.js';
import { withTimeout, LatestOperation } from './operations.js';
import { changeUnit, fileStem, nextLabel } from './plotDocument.js';
import { reviewMeasurements } from './measurementImport.js';
import { downloadBlob, downloadText } from './exporters.js';
import { photoSettings, plotLandmarks, overlayGeometry, photoOverlaySvg, serializePhotoProject, parsePhotoProject } from './photoOverlay.js';

export function setupPhotoPanel({ store, editor }) {
  const dialog = document.createElement('dialog'); dialog.id = 'pool-photo'; dialog.setAttribute('aria-labelledby', 'pool-photo-title');
  dialog.innerHTML = `<header class="photo-header"><div><h2 id="pool-photo-title">Pool photo overlay</h2><p>Match your measured points to their locations in a photo.</p></div><button id="photo-close" type="button">Close</button></header>
    <div class="photo-files"><label>Pool photo <input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>Open saved photo project <input id="photo-project-file" type="file" accept=".json,application/json" /></label></div>
    <div class="photo-recovery"><label>Saved on this browser <select id="photo-recovery-list" aria-label="Saved photo recoveries"><option value="">No recovery copies found</option></select></label><button id="photo-recover" type="button" disabled>Open recovery copy</button><button id="photo-delete-recovery" type="button" disabled>Delete recovery copy</button><p id="photo-recovery-status" role="status" class="note">Photo recovery saves on this browser. Download a photo project for a portable backup.</p></div>
    <p id="photo-status" role="status">Load a pool photo to start. Photo marks do not change the measured plot.</p>
    <div id="photo-workspace" hidden><div class="photo-stage"><svg id="photo-canvas" role="img" aria-label="Pool photo with measured point overlay" tabindex="0"></svg>
      <div class="photo-toolbar"><button id="photo-fit" type="button">Fit photo</button><button id="photo-zoom-out" type="button" aria-label="Zoom photo out">−</button><button id="photo-zoom-in" type="button" aria-label="Zoom photo in">+</button><button id="photo-undo" type="button">Undo photo mark</button></div>
      <p class="note">Click or tap to place a marker. Drag the background to pan; zoom for precise placement. Choose the same point and click again to correct its match.</p>
      <p id="photo-fit-note" class="note"></p>
    </div><section class="photo-controls" aria-label="Photo matching controls">
      <label>Measured A–B distance <input id="photo-baseline" type="number" min="0" step="any" /></label>
      <label>Plot units <select id="photo-unit"><option value="meters">Meters</option><option value="feet">Feet</option></select></label>
      <label>Click action <select id="photo-mode"><option value="match">Match an existing point</option><option value="new">Click, then enter A/B distances</option></select></label>
      <div id="photo-match-controls"><label>Point to match <select id="photo-point"></select></label><label class="checkbox"><input id="photo-next" type="checkbox" checked /> Advance to the next unmatched point</label><button id="photo-unmatch" type="button">Remove selected match</button></div>
      <form id="photo-measure-form" hidden><p id="photo-pending-note">Click the photo where you took a measurement.</p><label>Point label <input id="photo-label" maxlength="40" required /></label><label>Distance from A <input id="photo-from-a" inputmode="decimal" required /></label><label>Distance from B <input id="photo-from-b" inputmode="decimal" required /></label><label>Side in the measured plan <select id="photo-side"><option value="above">Above A→B</option><option value="below">Below A→B</option></select></label><p class="note">Side refers to the measured plan, not the photo's vertical direction.</p><button id="photo-add-measured" type="submit" disabled>Add measured point here</button></form>
      <fieldset><legend>Overlay appearance</legend><label>Opacity <input id="photo-opacity" type="range" min="0" max="1" step="0.05" value="0.9" /></label><label class="checkbox"><input id="photo-labels" type="checkbox" checked /> Point labels</label><label class="checkbox"><input id="photo-distances" type="checkbox" /> A/B measurements</label><label class="checkbox"><input id="photo-outline" type="checkbox" checked /> Connect points in plot order</label><label class="checkbox"><input id="photo-closed" type="checkbox" checked /> Close the pool outline</label><label class="checkbox"><input id="photo-project" type="checkbox" /> Project unmatched points</label><p class="note">Perspective projection needs four or more well-spaced matches on the same plane, such as the pool rim. It does not reconstruct depth or measure distances from the photo.</p></fieldset>
      <div class="button-grid"><button id="photo-save-project" type="button">Save photo project</button><button id="photo-export-png" type="button">Export overlaid PNG</button><button id="photo-export-svg" type="button">Export overlaid SVG</button><button id="photo-remove" type="button">Remove photo</button></div>
      <p id="photo-save-note" class="note">Download a photo project to keep a portable copy of the image, matches and measured plot together.</p>
    </section></div>`;
  document.body.append(dialog);
  const $ = id => document.getElementById(`photo-${id}`), svg = $('canvas');
  const imageLayer = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  const overlayLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(imageLayer, overlayLayer); let renderedPhoto = null;
  let photo = null, selected = 'A', pending = null, history = [], dirty = false, loading = false;
  let view = null, drag = null;
  const reads = new LatestOperation();
  const note = text => { $('status').textContent = text; };
  const changed = () => { queueRecovery(); dirty = true; $('save-note').textContent = 'Photo project has changes. Save photo project to keep the image, matches and measured plot together.'; };
  const recovery = photoRecovery(), recoveryId = crypto.randomUUID();
  let recoveryTimer, recoveryWork = Promise.resolve(), recoveryRecords = [], recoveryGeneration = 0;
  async function listRecoveries() {
    try {
      recoveryRecords = await recovery.list();
      $('recovery-list').replaceChildren(...(recoveryRecords.length ? recoveryRecords.map(record => new Option(`${record.name || 'Untitled pool'} · ${new Date(record.updated).toLocaleString()}`, record.id)) : [new Option('No recovery copies found', '')]));
      $('recover').disabled = $('delete-recovery').disabled = !recoveryRecords.length;
    } catch { $('recovery-status').textContent = 'Browser recovery is unavailable. Save a photo project file to keep your work.'; }
  }
  function queueRecovery() {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(saveRecovery, 400);
  }
  function saveRecovery() {
    clearTimeout(recoveryTimer); if (!photo) return;
    const generation = ++recoveryGeneration;
    const record = { id: recoveryId, name: store.document.name || photo.name, updated: Date.now(), text: serializePhotoProject(store.document, photo) };
    $('recovery-status').textContent = 'Saving browser recovery copy…';
    recoveryWork = recoveryWork.then(() => recovery.save(record)).then(() => {
      if (generation === recoveryGeneration && photo) $('recovery-status').textContent = 'Recovery copy saved on this browser. Download a photo project for a portable backup.';
    }).catch(() => { if (generation === recoveryGeneration && photo) $('recovery-status').textContent = 'Could not save browser recovery. Your last saved copy is kept. Download a photo project now.'; });
  }
  $('recover').addEventListener('click', () => {
    const record = recoveryRecords.find(item => item.id === $('recovery-list').value); if (!record) return;
    const files = new DataTransfer(); files.items.add(new File([record.text], 'browser-recovery.json', { type: 'application/json' }));
    $('project-file').files = files.files; $('project-file').dispatchEvent(new Event('change'));
  });
  $('delete-recovery').addEventListener('click', async () => {
    const id = $('recovery-list').value;
    if (!id || !confirm('Delete this browser recovery copy? Download a photo project first if you need to keep it.')) return;
    if (id === recoveryId) { clearTimeout(recoveryTimer); recoveryGeneration++; }
    try { await recoveryWork; await recovery.remove(id); await listRecoveries(); $('recovery-status').textContent = 'Recovery copy deleted. Further edits create a new recovery copy.'; }
    catch { $('recovery-status').textContent = 'Could not delete the recovery copy. Try again.'; }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && photo) saveRecovery(); });
  const remember = () => { history.push(structuredClone(photo.pins)); if (history.length > 100) history.shift(); };
  const selectionOptions = () => {
    const ids = plotLandmarks(store.document);
    if (!ids.some(p => p.id === selected)) selected = ids.find(p => !photo?.pins[p.id])?.id ?? 'A';
    $('point').replaceChildren(...ids.map(p => new Option(`${p.label}${photo?.pins[p.id] ? ' · matched' : ''}`, p.id)));
    $('point').value = selected;
  };
  const fit = () => { if (!photo) return; view = { x: 0, y: 0, width: photo.width, height: photo.height }; render(); };
  function render() {
    $('workspace').hidden = !photo; if (!photo) return;
    selectionOptions();
    if (document.activeElement !== $('baseline')) $('baseline').value = store.document.abDistance;
    $('unit').value = store.document.unit;
    for (const key of ['labels', 'distances', 'outline', 'closed', 'project']) $(key).checked = photo.settings[key];
    $('opacity').value = photo.settings.opacity;
    $('match-controls').hidden = $('mode').value !== 'match';
    $('measure-form').hidden = $('mode').value !== 'new';
    $('undo').disabled = !history.length;
    $('unmatch').disabled = !Object.hasOwn(photo.pins, selected);
    const rect = svg.getBoundingClientRect();
    const markerSize = Math.max(view.width / Math.max(rect.width, 1), view.height / Math.max(rect.height, 1)) * 7;
    if (renderedPhoto !== photo) {
      imageLayer.setAttribute('href', photo.dataUrl); imageLayer.setAttribute('width', photo.width); imageLayer.setAttribute('height', photo.height); renderedPhoto = photo;
    }
    // Markup is generated entirely from validated PNG data and escaped labels.
    const markup = photoOverlaySvg(store.document, photo, { selected, markerSize, includePhoto: false });
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    overlayLayer.replaceChildren(...Array.from(parsed.children).map(node => document.importNode(node, true)));
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    if (pending) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [key, value] of Object.entries({ cx: pending.x, cy: pending.y, r: markerSize * 1.5, fill: 'none', stroke: '#ffea00', 'stroke-width': markerSize / 3, 'data-pending-photo-point': '' })) circle.setAttribute(key, value);
      overlayLayer.append(circle);
    }
    $('fit-note').textContent = overlayGeometry(store.document, photo).message;
  }
  function zoom(factor) {
    if (!view) return;
    const width = Math.max(photo.width / 20, Math.min(photo.width * 2, view.width / factor)), height = width * photo.height / photo.width;
    view = { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height }; render();
  }
  const position = event => {
    const matrix = svg.getScreenCTM(); if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };
  svg.addEventListener('pointerdown', event => {
    if (!photo || loading || event.button !== 0) return;
    if (drag) { drag = null; return; }
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, position: position(event), moved: false };
    try { svg.setPointerCapture(event.pointerId); } catch { /* pointer ended */ }
  });
  svg.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 5) return;
    drag.moved = true; const here = position(event);
    view.x -= here.x - drag.position.x; view.y -= here.y - drag.position.y; render();
  });
  const cancelPointer = () => { drag = null; };
  svg.addEventListener('pointercancel', cancelPointer); svg.addEventListener('lostpointercapture', cancelPointer);
  svg.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const previous = drag; drag = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (previous.moved) return;
    const p = position(event); if (!p || p.x < 0 || p.y < 0 || p.x > photo.width || p.y > photo.height) { note('Click inside the photo.'); return; }
    if ($('mode').value === 'new') {
      pending = p; $('add-measured').disabled = false; $('pending-note').textContent = 'Location marked in yellow. Enter the distances you measured from A and B.';
      if (!$('label').value.trim()) $('label').value = nextLabel(store.document.points);
      $('from-a').focus();
    } else {
      remember(); photo.pins[selected] = p; changed();
      const label = plotLandmarks(store.document).find(point => point.id === selected)?.label;
      note(`Matched ${label}. Its measured position is unchanged.`);
      if ($('next').checked) {
        const landmarks = plotLandmarks(store.document), start = landmarks.findIndex(point => point.id === selected) + 1;
        selected = [...landmarks.slice(start), ...landmarks.slice(0, start)].find(point => !Object.hasOwn(photo.pins, point.id))?.id ?? selected;
      }
    }
    render();
  });
  svg.addEventListener('wheel', event => { if (photo) { event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });
  new ResizeObserver(() => { if (dialog.open && photo) render(); }).observe(svg);
  dialog.addEventListener('keydown', event => event.stopPropagation());
  document.getElementById('pool-photo-button').addEventListener('click', () => { dialog.showModal(); render(); void listRecoveries(); });
  $('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { reads.cancel(); loading = false; cancelPointer(); });
  $('fit').addEventListener('click', fit); $('zoom-in').addEventListener('click', () => zoom(1.4)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.4));
  $('point').addEventListener('change', () => { selected = $('point').value; render(); });
  $('mode').addEventListener('change', () => { pending = null; $('add-measured').disabled = true; $('label').value = nextLabel(store.document.points); render(); });
  $('undo').addEventListener('click', () => { if (history.length) { photo.pins = history.pop(); changed(); render(); } });
  $('unmatch').addEventListener('click', () => { remember(); delete photo.pins[selected]; changed(); render(); });
  for (const key of ['opacity', 'labels', 'distances', 'outline', 'closed', 'project']) $(key).addEventListener('input', () => { photo.settings[key] = key === 'opacity' ? Number($(key).value) : $(key).checked; changed(); render(); });
  $('baseline').addEventListener('change', () => {
    try { const value = Number($('baseline').value); if (!$('baseline').value || !Number.isFinite(value) || value <= 0) throw Error('Enter the positive A–B distance you measured.'); store.apply(doc => { doc.abDistance = value; }); changed(); }
    catch (error) { note(error.message); $('baseline').value = store.document.abDistance; } render();
  });
  $('unit').addEventListener('change', () => { try { store.apply(doc => changeUnit(doc, $('unit').value)); changed(); } catch (error) { note(error.message); } render(); });
  $('measure-form').addEventListener('submit', event => {
    event.preventDefault(); if (!pending) return;
    try {
      const result = reviewMeasurements([{ label: $('label').value, first: $('from-a').value.replace(',', '.'), second: $('from-b').value.replace(',', '.'), side: $('side').value }], store.document, { mode: 'distances' });
      if (!result.valid) throw Error(result.rows[0].error);
      const point = result.rows[0].point;
      store.apply(doc => { doc.points.push(point); }); remember(); photo.pins[point.id] = pending; selected = point.id; pending = null;
      $('add-measured').disabled = true; $('from-a').value = ''; $('from-b').value = ''; $('label').value = nextLabel(store.document.points);
      $('pending-note').textContent = 'Click the next measured location in the photo.';
      changed(); note(`Added ${point.label} to the measured plot and matched it to the photo.`); render();
    } catch (error) { note(error.message); }
  });
  async function imageData(blob) {
    return withTimeout(new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Could not read the photo.')); reader.readAsDataURL(blob); }));
  }
  $('file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    if (photo && dirty && !confirm('Replace the current photo and its matches? Save a photo project first if you need to keep them.')) return;
    const current = reads.start(); loading = true; note('Preparing your pool photo…');
    let bitmap, prepared;
    try {
      bitmap = await loadPhoto(file); const blob = await preparePhoto(bitmap); prepared = await createImageBitmap(blob); const dataUrl = await imageData(blob);
      if (!current()) return;
      photo = { name: file.name, dataUrl, width: prepared.width, height: prepared.height, pins: {}, settings: photoSettings() }; history = []; selected = 'A'; pending = null;
      $('add-measured').disabled = true; changed(); fit(); note('Choose a point, then click where it appears on the photo. Start with A and B if they are visible.');
    } catch (error) { if (current()) note(error.message); }
    finally { bitmap?.close(); prepared?.close(); if (current()) loading = false; }
  });
  $('project-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    const current = reads.start(), revision = store.revision; loading = true; note('Reading photo project…');
    let bitmap;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error('Choose a photo project smaller than 8 MB.');
      const project = parsePhotoProject(await withTimeout(file.text()));
      const bytes = Uint8Array.from(atob(project.photo.dataUrl.split(',')[1]), c => c.charCodeAt(0));
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (bitmap.width !== project.photo.width || bitmap.height !== project.photo.height) throw Error('The image dimensions do not match this project.');
      if (!current()) return;
      if (store.revision !== revision) throw Error('The plot changed while loading. Open the project again when ready.');
      if (!confirm('Open this photo project and replace the current plot and photo matches? Save your current photo project first if you need it.')) { note('Project opening cancelled.'); return; }
      store.replace(project.document); photo = project.photo; history = []; pending = null; dirty = false; selected = 'A'; $('add-measured').disabled = true; editor.fit(); fit();
      $('save-note').textContent = 'Opened photo project. Save a new copy after changing matches or measurements.'; note(`Opened ${file.name}.`); queueRecovery();
    } catch (error) { if (current()) note(error.message); }
    finally { bitmap?.close(); if (current()) loading = false; }
  });
  async function exporting(button, action) { button.disabled = true; try { await action(); } catch (error) { note(`Could not export: ${error.message}`); } finally { button.disabled = false; } }
  $('save-project').addEventListener('click', () => exporting($('save-project'), () => {
    downloadText(`${fileStem(store.document)}-photo-project.json`, serializePhotoProject(store.document, photo), 'application/json'); dirty = false;
    $('save-note').textContent = 'Photo-project download requested. Keep that file to reopen the photo and measured plot together.';
  }));
  $('export-svg').addEventListener('click', () => exporting($('export-svg'), () => { downloadText(`${fileStem(store.document)}-photo.svg`, photoOverlaySvg(store.document, photo), 'image/svg+xml'); note('Overlaid SVG download requested.'); }));
  $('export-png').addEventListener('click', () => exporting($('export-png'), async () => {
    const snapshot = photo, url = URL.createObjectURL(new Blob([photoOverlaySvg(store.document, snapshot)], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); await withTimeout(new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('Could not render the photo overlay.')); image.src = url; }));
      const canvas = document.createElement('canvas'); canvas.width = snapshot.width; canvas.height = snapshot.height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Image export is unavailable. Try SVG.'); ctx.drawImage(image, 0, 0);
      const blob = await withTimeout(new Promise(resolve => canvas.toBlob(resolve, 'image/png'))); if (!blob) throw Error('Could not encode the overlay.');
      downloadBlob(`${fileStem(store.document)}-photo.png`, blob); note('Overlaid PNG download requested.');
    } finally { URL.revokeObjectURL(url); }
  }));
  $('remove').addEventListener('click', () => { if (!confirm('Remove this photo and its matches? The measured plot will be kept.')) return; reads.cancel(); loading = false; cancelPointer(); clearTimeout(recoveryTimer); recoveryGeneration++; photo = null; renderedPhoto = null; imageLayer.removeAttribute('href'); overlayLayer.replaceChildren(); history = []; pending = null; dirty = false; render(); note('Photo removed. The measured plot is unchanged. Saved browser recovery copies remain available above.'); });
  let revision = store.revision;
  store.subscribe(() => { if (photo && store.revision !== revision) changed(); revision = store.revision; if (dialog.open) render(); });
  window.addEventListener('beforeunload', event => { if (photo && dirty) { event.preventDefault(); event.returnValue = ''; } });
  return { open: () => { dialog.showModal(); render(); }, get photo() { return photo; } };
}
