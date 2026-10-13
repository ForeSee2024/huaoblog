import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import worker from '../worker/index.js';

// Workers extends SubtleCrypto with this primitive; Node's native crypto provides the same comparison for unit tests.
Object.defineProperty(crypto.subtle, 'timingSafeEqual', { value: (a, b) => timingSafeEqual(a, b), configurable: true });
const env = { GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', ALLOWED_ORIGINS: 'https://blog.example,https://second.example' };
const start = () => worker.fetch(new Request('https://auth.example/auth?origin=https://blog.example'), env);
async function session() {
  const response = await start();
  return { state: new URL(response.headers.get('Location')).searchParams.get('state'), cookie: response.headers.get('Set-Cookie').split(';')[0] };
}
const callback = (state, cookie) => worker.fetch(new Request(`https://auth.example/callback?code=test-code&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } }), env);

test('an unknown origin is rejected before starting OAuth', async () => {
  const response = await worker.fetch(new Request('https://auth.example/auth?origin=https://evil.example'), env);
  assert.equal(response.status, 403);
});

test('changing origin to another allowed origin invalidates the full session state', async () => {
  const { state, cookie } = await session();
  const altered = state.split('.')[0] + '.' + btoa('https://second.example');
  assert.equal((await callback(altered, cookie)).status, 403);
});

test('a malformed cookie is rejected cleanly instead of throwing a gateway error', async () => {
  const response = await callback('state', 'oauth_session_state=%E0%A4%A');
  assert.equal(response.status, 403);
});

test('the callback only delivers a token after a message from its opener', async () => {
  const { state, cookie } = await session();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ access_token: 'test-token' });
  try {
    const html = await (await callback(state, cookie)).text();
    const sent = [];
    let receive;
    const opener = { postMessage: (...args) => sent.push(args) };
    const window = { opener, addEventListener: (_type, listener) => { receive = listener; }, removeEventListener() {}, close() {} };
    runInNewContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], { window, console });
    sent.length = 0;
    receive({ origin: 'https://blog.example', source: {}, data: 'authorizing:github' });
    assert.equal(sent.length, 0);
    receive({ origin: 'https://blog.example', source: opener, data: 'authorizing:github' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1], 'https://blog.example');
  } finally { globalThis.fetch = originalFetch; }
});

test('upstream error text remains data even when it contains quotes or closing script tags', async () => {
  const { state, cookie } = await session();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'bad_code', error_description: "user's </script><script>alert(1)</script>" }, { status: 400 });
  try {
    const html = await (await callback(state, cookie)).text();
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  } finally { globalThis.fetch = originalFetch; }
});
