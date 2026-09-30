import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recognizeLocal, loadPhoto } from '../src/ocr.js';

test('unsupported photos fail before allocating a decoder', async () => {
  await assert.rejects(loadPhoto({ type: 'image/svg+xml', size: 2 }), /JPEG/);
  await assert.rejects(loadPhoto({ type: 'image/png', size: 11 * 1024 * 1024 }), /10 MB/);
});
test('OCR worker failure is reported and resources terminate', async () => {
  let terminated = 0;
  await assert.rejects(recognizeLocal(new Blob(), { createWorker: async () => ({ recognize: async () => { throw Error('worker failed'); }, terminate: async () => { terminated++; } }) }), /worker failed/);
  assert.equal(terminated, 1);
});
test('cancelled worker initialization never recognizes the image', async () => {
  const controller = new AbortController(); let called = false, terminated = 0;
  const result = recognizeLocal(new Blob(), { signal: controller.signal, createWorker: async () => {
    controller.abort(); return { recognize: async () => { called = true; }, terminate: async () => { terminated++; } };
  } });
  await assert.rejects(result, /cancelled/); assert.equal(called, false); assert.ok(terminated >= 1);
});

test('prepared image sizes never exceed the 4 megapixel budget or a 4000 px side', async () => {
  const { preparedSize, MAX_PREPARED_PIXELS, MAX_PREPARED_SIDE } = await import('../src/ocr.js');
  const scaleFor = (w, h) => Math.min(1, Math.sqrt(MAX_PREPARED_PIXELS / (w * h)), MAX_PREPARED_SIDE / Math.max(w, h));
  const worst = { pixels: 0, size: null };
  for (let w = 50; w <= 6000; w += 7) {
    for (let h = 50; h <= 6000; h += 11) {
      const { width, height } = preparedSize(w, h, scaleFor(w, h));
      if (width * height > worst.pixels) worst.pixels = width * height, worst.size = `${w}x${h} -> ${width}x${height}`;
      if (width * height > MAX_PREPARED_PIXELS || width > MAX_PREPARED_SIDE || height > MAX_PREPARED_SIDE) assert.fail(`${w}x${h} prepared as ${width}x${height}`);
    }
  }
  const uhd = preparedSize(3840, 2160, scaleFor(3840, 2160));
  assert.ok(uhd.width * uhd.height <= MAX_PREPARED_PIXELS, `3840x2160 -> ${uhd.width}x${uhd.height}`);
  assert.deepEqual(preparedSize(1000, 600, scaleFor(1000, 600)), { width: 1000, height: 600 }, 'small images keep their size');
  assert.ok(worst.pixels > MAX_PREPARED_PIXELS * 0.99, `the budget is still used: worst ${worst.size}`);
});

test('API replies that are not JSON become plain messages instead of parse errors', async () => {
  const { apiResult } = await import('../src/ocr.js');
  const reply = (status, body, type) => new Response(body, { status, headers: { 'content-type': type } });
  await assert.rejects(apiResult(reply(413, '<html>413 Request Entity Too Large</html>', 'text/html'), 'fallback'), /too large for the online service/);
  await assert.rejects(apiResult(reply(502, '<html>bad gateway</html>', 'text/html'), 'Online recognition failed.'), /^Error: Online recognition failed\.$/);
  await assert.rejects(apiResult(reply(418, 'teapot', 'text/plain'), 'Nope'), /Nope \(HTTP 418\)/);
  await assert.rejects(apiResult(reply(401, JSON.stringify({ error: { message: 'Code rejected' } }), 'application/json'), 'fallback'), /Code rejected/);
  assert.deepEqual(await apiResult(reply(200, JSON.stringify({ text: 'P1 1 2' }), 'application/json; charset=utf-8'), 'fallback'), { text: 'P1 1 2' });
  await assert.rejects(apiResult(reply(200, 'not json', 'text/html'), 'Unexpected reply'), /Unexpected reply/);
});
