import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join, resolve } from 'node:path';

import { resolveRequestPath } from '../tools/serve.js';

const root = resolve('test-fixture-root');

describe('resolveRequestPath', () => {
  it('serves index.html for the root and for directories', () => {
    assert.equal(resolveRequestPath(root, '/'), join(root, 'index.html'));
    assert.equal(resolveRequestPath(root, '/sub/'), join(root, 'sub', 'index.html'));
  });

  it('resolves files, ignoring the query string', () => {
    assert.equal(resolveRequestPath(root, '/src/app.js'), join(root, 'src', 'app.js'));
    assert.equal(resolveRequestPath(root, '/styles.css?v=2'), join(root, 'styles.css'));
    assert.equal(resolveRequestPath(root, '/my%20plot.json'), join(root, 'my plot.json'));
  });

  it('refuses to escape the served directory', () => {
    for (const path of ['/../secrets', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/sub/../../outside']) {
      const resolved = resolveRequestPath(root, path);
      assert.ok(
        resolved === null || resolved.startsWith(root),
        `${path} escaped to ${resolved}`,
      );
    }
  });

  it('rejects paths it cannot decode or that hide a null byte', () => {
    assert.equal(resolveRequestPath(root, '/%E0%A4%A'), null);
    assert.equal(resolveRequestPath(root, '/a%00b'), null);
  });
});

it('rejects Windows separators, drive paths, and alternate streams', () => {
  for (const path of ['/..%5Cprivate', '/C:/secret', '/app.js:stream', '/sub/../private', '/%5C%5Cserver/share']) {
    assert.equal(resolveRequestPath(root, path), null);
  }
});
