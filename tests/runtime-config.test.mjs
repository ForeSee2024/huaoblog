import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../src/server/runtime-config.js';
test('local authentication requires an explicitly loopback-bound Node service', () => {
  for (const HOST of ['', '0.0.0.0', '::', '192.168.1.10']) assert.throws(() => runtimeConfig({ APP_DEV_AUTH: '1', HOST }, 'node'), /loopback HOST/);
  assert.equal(runtimeConfig({ APP_DEV_AUTH: '1', HOST: '127.0.0.1' }, 'node').devAuth, true);
  assert.equal(runtimeConfig({ APP_DEV_AUTH: '1', HOST: '0.0.0.0' }, 'cloudflare').devAuth, false);
  assert.equal(runtimeConfig({}, 'node').devAuth, false);
});
