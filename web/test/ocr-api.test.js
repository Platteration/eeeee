import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOcrHandler, dailyQuota, azureProvider } from '../server/ocr-api.js';

const code = 'test-pilot-code-only', origin = 'https://plot.example';
const png = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12); png.writeUInt32BE(100, 16); png.writeUInt32BE(100, 20);
async function host(t, options = {}) {
  const handler = createOcrHandler(options), server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, cookie, extra = {}) => fetch(base + path, { method: 'POST', body, headers: { origin, 'Content-Type': path.endsWith('session') ? 'application/json' : 'image/png', ...(cookie ? { cookie } : {}), ...extra } });
  return { request, base, login: async () => (await request('/api/ocr/session', JSON.stringify({ code }))).headers.get('set-cookie').split(';')[0] };
}
const configured = extra => ({ code, secret: 'secret-used-only-by-tests-with-no-access', origin, quota: { reserve() {} }, provider: async () => ({ text: 'P1 1 2', words: [] }), ...extra });

test('OCR is disabled without configuration and keeps credentials out of config', async t => {
  const { base, request } = await host(t);
  assert.deepEqual(await (await fetch(`${base}/api/ocr/config`)).json(), { enabled: false });
  assert.equal((await request('/api/ocr', png)).status, 503);
});
test('pilot requires access code, same origin, valid PNG and session cookie', async t => {
  let calls = 0;
  const { request, login } = await host(t, configured({ provider: async () => { calls++; return { text: 'P1 1 2', words: [] }; } }));
  assert.equal((await request('/api/ocr', png)).status, 401);
  assert.equal((await request('/api/ocr/session', JSON.stringify({ code: 'wrong' }))).status, 401);
  const cookie = await login(); assert.match(cookie, /abplot_ocr=/);
  assert.equal((await request('/api/ocr', png, cookie, { origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await request('/api/ocr', Buffer.from('not an image'), cookie)).status, 415);
  const result = await request('/api/ocr', png, cookie);
  assert.equal(result.status, 200); assert.equal((await result.json()).text, 'P1 1 2'); assert.equal(calls, 1);
});
test('concurrent job rejection does not release the first job lock', async t => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const { request, login } = await host(t, configured({ provider: async () => { started(); return new Promise(resolve => { finish = resolve; }); } }));
  const cookie = await login(), first = request('/api/ocr', png, cookie); await ready;
  assert.equal((await request('/api/ocr', png, cookie)).status, 409);
  assert.equal((await request('/api/ocr', png, cookie)).status, 409);
  finish({ text: 'done' }); assert.equal((await first).status, 200);
});
test('provider failures are sanitized and timeout releases session', async t => {
  const { request, login } = await host(t, configured({ timeout: 10, provider: () => new Promise(() => {}) }));
  const cookie = await login();
  assert.equal((await request('/api/ocr', png, cookie)).status, 504);
  assert.equal((await request('/api/ocr', png, cookie)).status, 504);
  const failing = await host(t, configured({ provider: async () => { throw Error('secret credential'); } }));
  const response = await failing.request('/api/ocr', png, await failing.login());
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret credential'));
});
test('daily reservation survives restart, rolls over and rejects corrupt accounting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abplot-quota-'));
  let date = new Date('2026-09-14T12:00:00Z');
  dailyQuota(dir, 1, () => date).reserve();
  const restarted = dailyQuota(dir, 1, () => date);
  assert.throws(() => restarted.reserve(), /daily image limit/);
  date = new Date('2026-09-15T12:00:00Z'); restarted.reserve();
  await writeFile(join(dir, 'ocr-usage.json'), '{corrupt');
  assert.throws(() => dailyQuota(dir), /cannot be read/);
});
test('Azure submission occurs once, polls results and validates operation origin', async () => {
  let calls = 0;
  const provider = azureProvider({ endpoint: 'https://azure.example', key: 'test', pollInterval: 0, fetchImpl: async (_, init) => {
    calls++; if (init.method === 'POST') return new Response('', { status: 202, headers: { 'operation-location': 'https://azure.example/result' } });
    return Response.json({ status: 'succeeded', analyzeResult: { content: 'P1 1 2', pages: [{ words: [{ content: 'P1', confidence: 0.9, polygon: [1, 2] }] }] } });
  } });
  assert.equal((await provider(png, new AbortController().signal)).text, 'P1 1 2'); assert.equal(calls, 2);
  const bad = azureProvider({ endpoint: 'https://azure.example', key: 'test', fetchImpl: async () => new Response('', { status: 202, headers: { 'operation-location': 'https://other.example/steal' } }) });
  await assert.rejects(bad(png, new AbortController().signal), /invalid location/);
});
