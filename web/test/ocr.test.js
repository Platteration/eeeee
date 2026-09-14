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
