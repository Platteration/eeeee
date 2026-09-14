import { withTimeout } from './operations.js';

export async function loadPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 24000000) { bitmap.close(); throw new Error('Choose an image up to 24 megapixels.'); }
  return bitmap;
}

export async function preparePhoto(bitmap, { rotation = 0, left = 0, top = 0, right = 0, bottom = 0 } = {}) {
  if (![left, top, right, bottom].every(n => Number.isFinite(n) && n >= 0 && n < 100) || left + right >= 100 || top + bottom >= 100) throw new Error('Crop must leave some of the image visible.');
  const sourceWidth = bitmap.width * (1 - (left + right) / 100), sourceHeight = bitmap.height * (1 - (top + bottom) / 100);
  let scale = Math.min(1, Math.sqrt(4000000 / (sourceWidth * sourceHeight)), 4000 / Math.max(sourceWidth, sourceHeight));
  for (let attempt = 0; attempt < 5; attempt++, scale *= 0.75) {
    const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = rotation % 180 ? height : width; canvas.height = rotation % 180 ? width : height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
    context.drawImage(bitmap, bitmap.width * left / 100, bitmap.height * top / 100, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height);
    const blob = await withTimeout(new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    if (!blob) throw new Error('Could not prepare the image.');
    if (blob.size <= 4 * 1024 * 1024) return blob;
  }
  throw new Error('Crop the image further to fit the 4 MB recognition limit.');
}

export async function recognizeLocal(blob, { signal, progress = () => {}, createWorker } = {}) {
  let worker, cancelled = false;
  const stop = () => { cancelled = true; if (worker) void worker.terminate(); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    if (signal?.aborted) throw new Error('Recognition cancelled.');
    const factory = createWorker ?? (await import('../vendor/ocr/tesseract.esm.min.js')).default.createWorker;
    const pending = factory('eng', 1, {
      workerPath: new URL('../vendor/ocr/worker.min.js', import.meta.url).href,
      corePath: new URL('../vendor/ocr/core/', import.meta.url).href,
      langPath: new URL('../vendor/ocr/lang/', import.meta.url).href,
      logger: event => { if (!cancelled) progress(event.status, event.progress); },
      errorHandler: () => {},
    }).then(value => { worker = value; if (cancelled) void worker.terminate(); return value; });
    await withTimeout(pending, 60000, 'OCR could not load. Check your connection or enter the measurements manually.');
    if (cancelled) throw new Error('Recognition cancelled.');
    const { data } = await withTimeout(worker.recognize(blob, {}, { text: true, blocks: true }), 60000, 'Recognition timed out. Crop the image or try a clearer photo.');
    if (signal?.aborted) throw new Error('Recognition cancelled.');
    const words = (data.blocks ?? []).flatMap(block => block.paragraphs ?? []).flatMap(p => p.lines ?? []).flatMap(l => l.words ?? []).map(w => ({ text: w.text, confidence: w.confidence / 100, box: w.bbox }));
    return { text: data.text, words };
  } finally { cancelled = true; signal?.removeEventListener('abort', stop); if (worker) await worker.terminate(); }
}

export async function recognizeOnline(blob, { signal } = {}) {
  const response = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob, signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'Online recognition failed. Try again later.');
  return result;
}
