import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { stringifyPost } from '../src/admin/content-model.js';
const { createContentServer } = await import('../scripts/content-server.mjs').catch(() => ({}));
const canonical = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const post = () => ({ slug: 'new-post', status: 'draft', data: { title: '新文章', description: '这是摘要。', pubDate: '2026-10-13', category: '软件工程与系统', tags: [] }, body: '## 正文\n\n测试内容。' });
async function fixture(t) {
  assert.equal(typeof createContentServer, 'function', 'local content server is not implemented');
  const root = await mkdtemp(path.join(tmpdir(), 'huaovo-content-'));
  await mkdir(path.join(root, 'src/data'), { recursive: true });
  await writeFile(path.join(root, 'src/data/site.json'), JSON.stringify(canonical));
  const server = await createContentServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const request = async (pathname, method = 'GET', body, origin = 'http://127.0.0.1:4321') => {
    const response = await fetch(url + pathname, { method, headers: { ...(origin === null ? {} : { Origin: origin }), ...(body == null ? {} : { 'Content-Type': 'application/json' }) }, ...(body == null ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { root, url, request };
}

test('local draft save and publication preserve the original until explicitly published', async t => {
  const { root, request } = await fixture(t);
  let saved = await request('/api/posts', 'POST', { post: post() });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.post.status, 'draft');
  await assert.rejects(readFile(path.join(root, 'src/content/posts/new-post.md')));
  let published = await request('/api/posts', 'POST', { post: saved.body.post, publish: true });
  assert.equal(published.status, 200);
  const original = await readFile(path.join(root, 'src/content/posts/new-post.md'), 'utf8');
  assert.match(original, /draft: false/);
  saved = await request('/api/posts', 'POST', { post: { ...published.body.post, body: '未完成的改稿' } });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(path.join(root, 'src/content/posts/new-post.md'), 'utf8'), original);
  const loaded = await request('/api/content');
  assert.equal(loaded.body.posts.filter(item => item.slug === 'new-post').length, 2);
  assert.equal(loaded.body.posts.find(item => item.status === 'draft').body, '未完成的改稿');
  assert.equal((await request('/api/posts/new-post', 'DELETE', { post: saved.body.post })).status, 200);
  assert.equal(await readFile(path.join(root, 'src/content/posts/new-post.md'), 'utf8'), original);
});

test('stale post and settings revisions reject destructive overwrites', async t => {
  const { request } = await fixture(t);
  const first = await request('/api/posts', 'POST', { post: post() });
  const second = await request('/api/posts', 'POST', { post: { ...first.body.post, body: '修改后' } });
  assert.equal(second.status, 200);
  assert.equal((await request('/api/posts', 'POST', { post: first.body.post })).status, 409);
  const loaded = await request('/api/content');
  const settings = loaded.body.settings;
  assert.equal((await request('/api/settings', 'PUT', { settings: { ...settings, identity: { ...settings.identity, brand: '新品牌' } } })).status, 200);
  assert.equal((await request('/api/settings', 'PUT', { settings })).status, 409);
});

test('media writes verify file bytes and referenced media cannot be deleted', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/media', 'POST', { name: 'wrong.jpg', content: png, mime: 'image/jpeg' })).status, 400);
  const upload = await request('/api/media', 'POST', { name: 'one.png', content: png, mime: 'image/png' });
  assert.equal(upload.status, 200);
  assert.equal(upload.body.media.publicUrl, '/images/posts/one.png');
  const article = await request('/api/posts', 'POST', { post: { ...post(), body: '100% complete\n\n![图](/images/posts/%6fne.png)' } });
  assert.equal((await request('/api/media/one.png', 'DELETE', { media: upload.body.media })).status, 409);
  await request('/api/posts/new-post', 'DELETE', { post: article.body.post });
  const loaded = await request('/api/content');
  const settings = { ...loaded.body.settings, identity: { ...loaded.body.settings.identity, avatar: '/images/posts/one.png' } };
  await request('/api/settings', 'PUT', { settings });
  assert.equal((await request('/api/media/one.png', 'DELETE', { media: upload.body.media })).status, 409);
});

test('local mutations deny missing or foreign origins, traversal and excessive bodies', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/posts', 'POST', { post: post() }, null)).status, 403);
  assert.equal((await request('/api/posts', 'POST', { post: post() }, 'https://evil.example')).status, 403);
  assert.equal((await request('/api/posts', 'POST', { post: { ...post(), slug: '../escape' } })).status, 400);
  assert.equal((await request('/api/posts', 'POST', { post: { ...post(), body: 'x'.repeat(2 * 1024 * 1024) } })).status, 413);
  assert.equal((await request('/api/media', 'POST', { name: '../escape.png', content: png })).status, 400);
});

test('local storage refuses symlink escapes', async t => {
  const { root, request } = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), 'huaovo-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/content'), { recursive: true });
  await symlink(outside, path.join(root, 'src/content/drafts'));
  const response = await request('/api/posts', 'POST', { post: post() });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /符号链接/);
  await assert.rejects(readFile(path.join(outside, 'new-post.md')));
});

test('publishing a legacy draft inside posts retains the published file', async t => {
  const { root, request } = await fixture(t);
  await mkdir(path.join(root, 'src/content/posts'), { recursive: true });
  await writeFile(path.join(root, 'src/content/posts/new-post.md'), stringifyPost(post()));
  const loaded = await request('/api/content');
  const result = await request('/api/posts', 'POST', { post: loaded.body.posts[0], publish: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.post?.status, 'published');
  assert.match(await readFile(path.join(root, 'src/content/posts/new-post.md'), 'utf8'), /draft: false/);
  assert.equal((await request('/api/content')).body.posts[0].body, post().body);
});

test('saving a legacy draft migrates it out of the published directory', async t => {
  const { root, request } = await fixture(t);
  await mkdir(path.join(root, 'src/content/posts'), { recursive: true });
  await writeFile(path.join(root, 'src/content/posts/new-post.md'), stringifyPost(post()));
  const loaded = await request('/api/content');
  const result = await request('/api/posts', 'POST', { post: { ...loaded.body.posts[0], body: '迁移后正文' } });
  assert.equal(result.status, 200);
  await assert.rejects(readFile(path.join(root, 'src/content/posts/new-post.md')));
  assert.match(await readFile(path.join(root, 'src/content/drafts/new-post.md'), 'utf8'), /迁移后正文/);
});
