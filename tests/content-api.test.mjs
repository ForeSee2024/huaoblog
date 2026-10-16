import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { createContentStore, CONTENT_SCHEMA } from '../src/server/storage/content-store.js';
const api = await import('../src/server/api.js').catch(() => ({}));
const canonical = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const article = { slug: 'hello-world', data: { title: '新文章', description: '简介', category: '软件工程与系统', pubDate: '2026-10-15', tags: [] }, body: '正文 Cloudflare' };
async function fixture(t) {
  assert.equal(typeof api.createContentHandler, 'function');
  const database = createNodeDatabase(':memory:'); t.after(() => database.close()); await database.exec(CONTENT_SCHEMA);
  await database.exec(await readFile(new URL('../migrations/002_sessions.sql', import.meta.url), 'utf8'));
  const store = createContentStore(database); await store.saveSettings(canonical);
  const objects = new Map();
  const blobs = { async put(key, bytes) { objects.set(key, bytes); }, async get(key) { const bytes = objects.get(key); return bytes ? { body: new Blob([bytes]).stream(), size: bytes.length, contentType: 'image/png' } : null; }, async delete(key) { objects.delete(key); } };
  const runtime = { store, database, blobs, config: { deployment: 'node', siteUrl: 'http://127.0.0.1:4321', devAuth: true, githubUserId: '160737293' } };
  return { ...runtime, objects, runtime, call: api.createContentHandler(runtime) };
}
function request(path, { method = 'GET', data, origin = 'http://127.0.0.1:4321', headers = {}, anonymous = false } = {}) {
  return new Request(`${anonymous ? 'https://huaoblog.cn' : 'http://127.0.0.1:4321'}/api/v1/${path}`, { method, headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
test('anonymous workspace exposes no draft content; authenticated write and body reads are direct', async t => {
  const { call } = await fixture(t);
  const saved = await call(request('posts', { method: 'POST', data: { post: article, publish: false } }));
  assert.equal(saved.status, 200); const draft = (await saved.json()).post;
  const anonymous = await (await call(request('content', { anonymous: true }))).json();
  assert.deepEqual(anonymous.posts, []); assert.equal(anonymous.connection.authenticated, false);
  assert.equal((await call(request(`posts/${article.slug}?status=draft`, { anonymous: true }))).status, 401);
  const body = await (await call(request(`posts/${article.slug}?status=draft`))).json();
  assert.equal(body.post.body, article.body);
  const published = await (await call(request('posts', { method: 'POST', data: { post: draft, publish: true } }))).json();
  assert.equal(published.post.status, 'published'); assert.equal(published.state.posts[0].bodyLoaded, false);
  assert.equal(published.state.releases.length, 0);
  assert.equal((await call(request('content'))).headers.get('cache-control'), 'private, no-store');
});
test('cross-origin requests, unauthenticated writes and stale revisions are rejected', async t => {
  const { call } = await fixture(t);
  assert.equal((await call(request('posts', { method: 'POST', origin: 'https://evil.invalid', data: { post: article } }))).status, 403);
  assert.equal((await call(request('posts', { method: 'POST', anonymous: true, origin: 'https://huaoblog.cn', data: { post: article } }))).status, 401);
  const draft = (await (await call(request('posts', { method: 'POST', data: { post: article } }))).json()).post;
  await call(request('posts', { method: 'POST', data: { post: draft, publish: true } }));
  assert.equal((await call(request('posts', { method: 'POST', data: { post: draft, publish: true } }))).status, 409);
  assert.equal((await call(request('posts/delete', { method: 'POST', data: { posts: Array.from({ length: 4 }, () => draft) } }))).status, 400);
});
test('media stays private until referenced by a publication and soft deletion is immediately enforced', async t => {
  const { call, runtime } = await fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.set('file', new File([png], 'pixel.png', { type: 'image/png' }));
  const response = await call(new Request('http://127.0.0.1:4321/api/v1/media', { method: 'POST', headers: { Origin: 'http://127.0.0.1:4321' }, body: form }));
  assert.equal(response.status, 200); const image = (await response.json()).media;
  const imageRequest = new Request(`https://huaoblog.cn${image.publicUrl}`);
  assert.equal((await api.serveMedia(imageRequest, runtime, image.name)).status, 404);
  await call(request('posts', { method: 'POST', data: { post: { ...article, body: `![图](${image.publicUrl})` }, publish: true } }));
  const fetched = await api.serveMedia(imageRequest, runtime, image.name); assert.equal(fetched.status, 200); assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), png);
  const blocked = await (await call(request('media/delete', { method: 'POST', data: { media: [(await runtime.store.getWorkspace()).media[0]] } }))).json();
  assert.equal(blocked.failed[0].code, 'referenced_media');
});
test('bulk deletion and recovery work without a GitHub release and validate known routes', async t => {
  const { call } = await fixture(t);
  const saved = (await (await call(request('posts', { method: 'POST', data: { post: article, publish: true } }))).json()).post;
  const result = await (await call(request('posts/delete', { method: 'POST', data: { posts: [saved] } }))).json();
  assert.equal(result.deleted.length, 1); assert.equal(result.state.posts.length, 0);
  const trash = await (await call(request('trash'))).json(); assert.equal(trash.posts.length, 1);
  const restored = await (await call(request('trash/restore', { method: 'POST', data: { kind: 'post', item: trash.posts[0] } }))).json();
  assert.equal(restored.state.posts.length, 1);
  assert.equal((await call(request('nonexistent'))).status, 404);
  assert.equal((await call(request('settings', { method: 'POST', data: {} }))).status, 405);
});
