import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../tools/serve.js';

test('release HTTP server supports probes and HEAD, rejects writes and private files', async t => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/healthz`); assert.deepEqual(await health.json(), { status: 'ok' });
  const page = await fetch(base); assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const head = await fetch(base, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  const write = await fetch(base, { method: 'POST', body: 'nothing' }); assert.equal(write.status, 405);
  for (const path of ['/server/ocr-api.js', '/.env', '/package.json', '/data/ocr-usage.json']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(`${base}/privacy.html`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/ocr/config`)).json(), { enabled: false });
});
