import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
const auth = await import('../src/server/auth.js').catch(() => ({}));

async function setup(t, overrides = {}) {
  assert.equal(typeof auth.createAuth, 'function', 'session service must be implemented');
  const database = createNodeDatabase(':memory:'); t.after(() => database.close());
  await database.exec(await readFile(new URL('../migrations/002_sessions.sql', import.meta.url), 'utf8'));
  const config = { deployment: 'node', siteUrl: 'https://huaoblog.cn', githubUserId: '160737293', sessionTtlSeconds: 3600, ...overrides };
  let clock = Date.parse('2026-10-15T10:00:00Z');
  const service = auth.createAuth(database, config, { now: () => clock, fetch: async () => Response.json({ id: 160737293, login: 'ForeSee2024' }) });
  return { service, database, config, tick: seconds => { clock += seconds * 1000; } };
}
const req = (cookie = '', origin = 'https://huaoblog.cn') => new Request(`${origin}/api/v1/content`, { headers: cookie ? { Cookie: cookie } : {} });

test('GitHub identity is exchanged for an opaque hashed, expiring HttpOnly session', async t => {
  const { service, database, tick } = await setup(t);
  const login = await service.login('gho_' + 'a'.repeat(40), req());
  assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /Secure/); assert.match(login.cookie, /SameSite=Lax/);
  const cookie = login.cookie.split(';')[0];
  assert.equal((await service.authenticate(req(cookie))).id, '160737293');
  const rows = await database.all('SELECT * FROM auth_sessions');
  assert.equal(rows.length, 1); assert.equal(rows[0].token_hash.length, 64);
  assert.ok(!JSON.stringify(rows).includes(cookie.split('=')[1]));
  assert.ok(!JSON.stringify(rows).includes('gho_'));
  tick(3601); assert.equal(await service.authenticate(req(cookie)), null);
});

test('writes require the exact request origin and logout revokes the session', async t => {
  const { service } = await setup(t);
  for (const origin of [null, 'https://evil.invalid', 'https://huaoblog.cn.evil.invalid']) {
    const request = new Request('https://huaoblog.cn/api/v1/posts', { method: 'POST', headers: origin ? { Origin: origin } : {} });
    assert.throws(() => service.assertSameOrigin(request), error => error.status === 403);
  }
  service.assertSameOrigin(new Request('https://huaoblog.cn/api/v1/posts', { method: 'POST', headers: { Origin: 'https://huaoblog.cn' } }));
  const login = await service.login('gho_' + 'a'.repeat(40), req());
  const request = req(login.cookie.split(';')[0]);
  await service.logout(request); assert.equal(await service.authenticate(request), null);
});

test('non-owner GitHub users are denied and local bypass cannot cross to Cloudflare or a public host', async t => {
  const { service, database, config } = await setup(t);
  const denied = auth.createAuth(database, config, { fetch: async () => Response.json({ id: 99, login: 'other' }) });
  await assert.rejects(denied.login('gho_' + 'b'.repeat(40), req()), error => error.status === 403);
  assert.equal(await service.authenticate(req()), null);
  const local = auth.createAuth(database, { ...config, siteUrl: 'http://127.0.0.1:4321', devAuth: true });
  assert.equal((await local.authenticate(req('', 'http://127.0.0.1:4321'))).id, '160737293');
  assert.equal(await local.authenticate(req()), null);
  const worker = auth.createAuth(database, { ...config, deployment: 'cloudflare', devAuth: true });
  assert.equal(await worker.authenticate(req('', 'http://127.0.0.1:4321')), null);
});

test('the native fetch receiver is preserved in strict Worker runtimes', async t => {
  const { database, config } = await setup(t);
  const original = globalThis.fetch;
  globalThis.fetch = function (_url, options) { assert.equal(this, globalThis); assert.equal(options.redirect, 'manual'); return Promise.resolve(Response.json({ id: 160737293, login: 'ForeSee2024' })); };
  try { await auth.createAuth(database, config).login('gho_' + 'a'.repeat(40), req()); }
  finally { globalThis.fetch = original; }
});
