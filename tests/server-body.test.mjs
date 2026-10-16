import test from 'node:test';
import assert from 'node:assert/strict';
const body = await import('../src/server/body.js').catch(() => ({}));
test('JSON reading checks media type, syntax and actual streamed size rather than trusting Content-Length', async () => {
  assert.equal(typeof body.readJson, 'function');
  assert.deepEqual(await body.readJson(new Request('https://local/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' }), 20), { ok: true });
  await assert.rejects(body.readJson(new Request('https://local/', { method: 'POST', body: '{}' }), 20), e => e.status === 415);
  await assert.rejects(body.readJson(new Request('https://local/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }), 20), e => e.status === 400);
  await assert.rejects(body.readJson(new Request('https://local/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: JSON.stringify({ text: 'x'.repeat(100) }) }), 20), e => e.status === 413);
});
