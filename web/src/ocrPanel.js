import { loadPhoto, preparePhoto, recognizeLocal, recognizeOnline } from './ocr.js';
import { LatestOperation } from './operations.js';

export function setupOcrPanel(panel) {
  const host = document.getElementById('ocr-panel');
  host.innerHTML = `<details><summary>Read a photo or screenshot</summary>
    <p>Start with local recognition. Handwriting may need corrections. Online recognition is an optional access-code pilot.</p>
    <label>Choose image <input id="ocr-file" type="file" accept="image/jpeg,image/png,image/webp" /></label>
    <label>Take photo <input id="ocr-camera" type="file" accept="image/*" capture="environment" /></label>
    <div id="ocr-image-controls" hidden><button id="ocr-rotate" type="button">Rotate 90°</button>
      <div class="entry-options">${['left', 'top', 'right', 'bottom'].map(side => `<label>Trim ${side} (%) <input id="ocr-${side}" type="number" min="0" max="99" value="0" /></label>`).join('')}</div>
      <img id="ocr-preview" alt="Cropped source image for checking recognized measurements" />
      <button id="ocr-local" type="button">Read on this device</button><button id="ocr-cancel" type="button" hidden>Cancel recognition</button>
      <div id="ocr-online-controls" hidden><label>Pilot access code <input id="ocr-code" type="password" autocomplete="off" /></label>
        <p>Online recognition sends this cropped image to Microsoft Azure. Use it only when you are ready to upload the image.</p>
        <button id="ocr-online" type="button">Send image for online recognition</button></div>
      <p id="ocr-notes" role="status"></p>
    </div></details>`;
  const $ = id => document.getElementById(`ocr-${id}`);
  let bitmap, rotation = 0, blob, url, controller, online = false;
  const preparation = new LatestOperation(), jobs = new LatestOperation();
  const note = text => { $('notes').textContent = text; };
  const busy = value => { $('local').disabled = value || !blob; $('online').disabled = value || !blob; $('cancel').hidden = !value; };
  const cancel = () => { jobs.cancel(); controller?.abort(); controller = null; busy(false); };
  async function prepare() {
    cancel(); const current = preparation.start(); blob = null; busy(false); panel.invalidate();
    try {
      const prepared = await preparePhoto(bitmap, { rotation, ...Object.fromEntries(['left', 'top', 'right', 'bottom'].map(side => [side, Number($(side).value)])) });
      if (!current()) return;
      blob = prepared; if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob); $('preview').src = url; busy(false);
      note('Check the crop, then choose recognition. Images stay on your device unless you choose online recognition.');
    } catch (error) { if (current()) note(error.message); }
  }
  async function select(event) {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    cancel(); const current = preparation.start(); blob = null; busy(false); panel.invalidate();
    $('image-controls').hidden = false;
    try {
      const next = await loadPhoto(file); if (!current()) { next.close(); return; }
      bitmap?.close(); bitmap = next; rotation = 0;
      for (const side of ['left', 'top', 'right', 'bottom']) $(side).value = '0';
      await prepare();
      $('online-controls').hidden = !online;
    } catch (error) { if (current()) note(error.message); }
  }
  for (const id of ['file', 'camera']) $(id).addEventListener('change', select);
  for (const side of ['left', 'top', 'right', 'bottom']) $(side).addEventListener('change', () => { if (bitmap) void prepare(); });
  $('rotate').addEventListener('click', () => { if (bitmap) { rotation = (rotation + 90) % 360; void prepare(); } });
  $('cancel').addEventListener('click', () => { cancel(); note('Recognition cancelled. You can still enter measurements manually.'); });
  async function recognize(remote) {
    if (!blob) return; cancel(); const current = jobs.start(); controller = new AbortController();
    const signal = controller.signal; busy(true); panel.invalidate(); note('Preparing recognition…');
    const draftRevision = panel.draftRevision;
    const timeout = setTimeout(() => controller?.abort(), 65000);
    try {
      if (remote && $('code').value) {
        const response = await fetch('/api/ocr/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }), signal });
        $('code').value = '';
        if (!response.ok) { const result = await response.json(); throw new Error(result.error?.message ?? 'Access code rejected.'); }
      }
      const result = await (remote ? recognizeOnline(blob, { signal }) : recognizeLocal(blob, { signal, progress: (status, fraction) => { if (current()) note(`${status} ${Math.round((fraction ?? 0) * 100)}%`); } }));
      if (!current()) return;
      if (panel.draftRevision !== draftRevision) throw new Error('Your measurement draft changed during recognition. Run recognition again when ready; your edits were kept.');
      if (!result.text?.trim()) throw new Error('No text found. Try a closer crop or enter the measurements manually.');
      panel.acceptText(result.text, true);
      const uncertain = (result.words ?? []).filter(word => word.confidence < 0.85).map(word => word.text);
      note(uncertain.length ? `Check these uncertain words especially: ${uncertain.slice(0, 30).join(', ')}. All values still need review.` : 'Recognition finished. Check every measurement against the image before applying.');
    } catch (error) { if (current()) note(signal.aborted ? 'Recognition stopped or timed out. Try a smaller crop, or enter text manually.' : error.message); }
    finally { clearTimeout(timeout); if (current()) busy(false); }
  }
  $('local').addEventListener('click', () => void recognize(false));
  $('online').addEventListener('click', () => void recognize(true));
  panel.dialog.addEventListener('close', () => { cancel(); preparation.cancel(); });
  fetch('/api/ocr/config').then(r => r.ok ? r.json() : null).then(config => { online = config?.enabled === true; $('online-controls').hidden = !online; }).catch(() => {});
}
