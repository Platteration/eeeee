import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { server } from '../tools/serve.js';
import { siteBase, smoke } from '../tools/smoke.js';

test('siteBase resolves probes inside a sub-path site as well as an origin root', () => {
  assert.equal(siteBase('https://plots.example.com').href, 'https://plots.example.com/');
  assert.equal(siteBase('https://user.github.io/eeeee').href, 'https://user.github.io/eeeee/');
  assert.equal(siteBase('https://user.github.io/eeeee/?utm=1#x').href, 'https://user.github.io/eeeee/');
  assert.equal(new URL('src/app.js', siteBase('https://user.github.io/eeeee')).pathname, '/eeeee/src/app.js');
});

test('the smoke probe passes against the release server at the root and under a sub-path prefix', async t => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  // A minimal reverse proxy that mounts the site under /eeeee/, as a sub-path host would.
  const proxy = createServer((incoming, outgoing) => {
    if (!incoming.url.startsWith('/eeeee/')) { outgoing.writeHead(404); outgoing.end('outside the site'); return; }
    const upstream = httpRequest({ host: '127.0.0.1', port, path: incoming.url.slice('/eeeee'.length), method: incoming.method, headers: incoming.headers }, response => {
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { server.closeAllConnections(); proxy.closeAllConnections(); return Promise.all([new Promise(r => server.close(r)), new Promise(r => proxy.close(r))]); });

  const root = await smoke(`http://127.0.0.1:${port}`);
  assert.ok(root.includes(`http://127.0.0.1:${port}/src/app.js`));
  const nested = await smoke(`http://127.0.0.1:${proxy.address().port}/eeeee`);
  assert.ok(nested.includes(`http://127.0.0.1:${proxy.address().port}/eeeee/src/app.js`));
  assert.ok(nested.every(url => url.includes('/eeeee/')), 'every probe must stay inside the sub-path');
  // Outside the mounted path the proxy answers 404, so a probe that ignored the base would fail.
  await assert.rejects(smoke(`http://127.0.0.1:${proxy.address().port}/`), /unexpected 404/);
});
