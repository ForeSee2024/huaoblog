import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

test('standalone Node OAuth gateway uses its public callback and read-only identity scope', { timeout: 20000 }, async t => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['worker/node-server.mjs'], {
    cwd: new URL('../', import.meta.url), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, OAUTH_PUBLIC_URL: 'https://auth.example.invalid', OAUTH_HOST: '127.0.0.1', OAUTH_PORT: String(port), ALLOWED_ORIGINS: 'https://blog.example.invalid', GITHUB_CLIENT_ID: 'fixture-client', GITHUB_CLIENT_SECRET: 'fixture-secret' },
  });
  const exited = once(child, 'exit'); let logs = ''; child.stderr.on('data', data => { logs += data; });
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  const base = `http://127.0.0.1:${port}`; let ready = false;
  for (let tries = 0; tries < 80; tries++) {
    if (child.exitCode !== null) assert.fail(`gateway exited: ${logs}`);
    try { const response = await fetch(base); await response.body?.cancel(); ready = response.status === 200; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, logs);
  const response = await fetch(base + '/auth?origin=https%3A%2F%2Fblog.example.invalid', { redirect: 'manual' });
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.get('Location'));
  assert.equal(authorization.origin, 'https://github.com');
  assert.equal(authorization.searchParams.get('scope'), 'read:user');
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://auth.example.invalid/callback');
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await fetch(base + '/auth?origin=https%3A%2F%2Fevil.invalid')).status, 403);
  assert.equal((await fetch(base + '/callback?code=invalid&state=invalid')).status, 403);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});
