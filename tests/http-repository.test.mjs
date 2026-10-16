import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRepository } from '../src/admin/repository.js';
const adapter = await import('../src/admin/http-repository.js').catch(() => ({}));
const canonical = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const config = { backend: 'api', direct: true, local: false, apiUrl: '/api/v1', authUrl: 'https://auth.example', repo: 'test/blog' };
const post = () => ({ slug: 'first', status: 'published', revision: 'r1', data: { title: '文章', description: '摘要', pubDate: '2026-10-15', category: '软件工程与系统', tags: [] }, body: '完整正文。' });
const state = { connection: { mode: 'database', authenticated: true, writable: true }, posts: [], settings: canonical, media: [], releases: [] };
function fixture(respond = () => Response.json(state), extra = {}) {
  const calls = [];
  assert.equal(typeof adapter.createHttpRepository, 'function', 'HTTP content adapter is required');
  const repo = adapter.createHttpRepository(config, { fetch: async (url, options) => { calls.push({ url, ...options }); return respond(url, options); }, ...extra });
  return { repo, calls };
}

test('API mode takes precedence over the legacy loopback adapter and never reads token storage', async () => {
  const calls = [];
  const repo = createRepository({ ...config, local: true }, { fetch: async (url, options) => { calls.push({ url, ...options }); return Response.json(state); }, get sessionStorage() { throw new Error('tokens must not be stored'); } });
  assert.deepEqual(await repo.load(), state);
  assert.equal(calls[0].url, '/api/v1/content');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].cache, 'no-store');
});

test('workspace lists stay metadata only and editor reads the requested full version lazily', async () => {
  const metadata = { ...post(), bodyLoaded: false }; delete metadata.body;
  const { repo, calls } = fixture(url => Response.json(url.includes('/posts/') ? { post: post() } : { ...state, posts: [metadata] }));
  const loaded = await repo.load();
  assert.equal(loaded.posts[0].body, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual((await repo.getPost('first', 'published')).post, post());
  assert.equal(calls[1].url, '/api/v1/posts/first?status=published');
});

test('saving and publishing preserve revisions and use only the direct post endpoint', async () => {
  const { repo, calls } = fixture((_url, options) => { const body = JSON.parse(options.body); return Response.json({ post: body.post, state }); });
  await repo.savePost(post());
  await repo.savePost(post(), { publish: true });
  assert.deepEqual(calls.map(item => [item.method, item.url]), [['POST', '/api/v1/posts'], ['POST', '/api/v1/posts']]);
  assert.deepEqual(calls.map(item => { const body = JSON.parse(item.body); return [body.post.revision, body.publish]; }), [['r1', false], ['r1', true]]);
  assert.equal(repo.publishRelease, undefined);
  assert.equal(repo.prepareRelease, undefined);
});

test('metadata cannot be saved as an empty replacement for an unread body', async () => {
  const { repo, calls } = fixture();
  await assert.rejects(repo.savePost({ ...post(), body: '', bodyLoaded: false }), /正文|读取/);
  assert.equal(calls.length, 0);
});

test('partial bulk deletion keeps server failures and submits all selected revision guards', async () => {
  const failed = [{ slug: 'changed', status: 'draft', revision: 'old', error: '版本冲突', code: 'conflict' }];
  const { repo, calls } = fixture(() => Response.json({ deleted: [post()], failed, state, releases: [] }));
  const result = await repo.deletePosts([post(), { ...post(), slug: 'changed', status: 'draft', revision: 'old' }]);
  assert.deepEqual(result.failed, failed);
  assert.equal(result.deleted.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body).posts.map(item => item.revision), ['r1', 'old']);
  await assert.rejects(repo.deletePosts([{ ...post(), revision: undefined }]), /版本|刷新/);
  assert.equal(calls.length, 1);
});

test('bulk deletion fits three-item API batches, groups slug versions and preserves displayed guards', async () => {
  const selected = [post(), { ...post(), status: 'draft' }, ...Array.from({ length: 5 }, (_, index) => ({ ...post(), slug: `other-${index}` }))];
  let batch = 0;
  const { repo, calls } = fixture((_url, options) => {
    const items = JSON.parse(options.body).posts; batch++;
    return Response.json({ deleted: items, failed: [], state: { ...state, posts: selected.map(item => ({ ...item, revision: `confirmed-${batch}` })) }, releases: [] });
  });
  const result = await repo.deletePosts(selected);
  const bodies = calls.map(call => JSON.parse(call.body).posts);
  assert.deepEqual(bodies.map(items => items.length), [3, 3, 1]);
  assert.deepEqual(bodies[0].slice(0, 2).map(item => `${item.slug}:${item.status}`), ['first:published', 'first:draft']);
  assert.ok(bodies[1].every(item => item.revision === 'r1'));
  assert.ok(bodies[2].every(item => item.revision === 'r1'));
  assert.equal(result.deleted.length, 7);
});

test('a newer state from an earlier batch cannot authorize deletion of a concurrent edit', async () => {
  const selected = Array.from({ length: 4 }, (_, index) => ({ ...post(), slug: `item-${index}` }));
  let batch = 0;
  const { repo, calls } = fixture((_url, options) => {
    const items = JSON.parse(options.body).posts;
    const latest = { ...state, posts: [{ ...selected[3], revision: 'edited-in-another-window' }] };
    if (++batch === 1) return Response.json({ deleted: items, failed: [], state: latest });
    return Response.json(items[0].revision === 'r1'
      ? { deleted: [], failed: [{ ...items[0], error: '版本冲突', code: 'conflict' }], state: latest }
      : { deleted: items, failed: [], state: { ...state, posts: [] } });
  });
  const result = await repo.deletePosts(selected);
  assert.equal(JSON.parse(calls[1].body).posts[0].revision, 'r1');
  assert.equal(result.deleted.length, 3);
  assert.equal(result.failed[0].code, 'conflict');
  assert.equal(result.state.posts[0].revision, 'edited-in-another-window');
});

test('a failed bulk transport preserves completed batches and does not claim unknown writes succeeded', async () => {
  const selected = Array.from({ length: 7 }, (_, index) => ({ ...post(), slug: `item-${index}` }));
  let batch = 0;
  const { repo, calls } = fixture((_url, options) => {
    if (++batch === 2) throw new TypeError('response lost');
    return Response.json({ deleted: JSON.parse(options.body).posts, failed: [], state: { ...state, posts: selected }, releases: [] });
  });
  const result = await repo.deletePosts(selected);
  assert.equal(calls.length, 2);
  assert.equal(result.deleted.length, 3);
  assert.equal(result.failed.length, 4);
  assert.equal(result.refreshRequired, true);
  assert.ok(result.failed.every(item => /刷新|确认/.test(item.error)));
});

test('settings save directly publishes its revision without creating a release', async () => {
  const settings = { ...canonical, revision: 'settings-r2' };
  const { repo, calls } = fixture(() => Response.json({ settings, state }));
  assert.deepEqual((await repo.saveSettings(settings)).settings, settings);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, '/api/v1/settings');
  assert.equal(JSON.parse(calls[0].body).settings.revision, 'settings-r2');
});

test('media upload uses multipart and canonical media preview needs no repository request', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const file = new File([bytes], 'cover.png', { type: 'image/png' });
  const media = { name: 'cover.png', path: 'public/images/posts/cover.png', revision: 'm1' };
  const { repo, calls } = fixture(() => Response.json({ media, state }));
  await repo.uploadMedia(file);
  assert.equal(calls[0].url, '/api/v1/media');
  assert.ok(calls[0].body instanceof FormData);
  assert.equal(calls[0].body.get('file').name, 'cover.png');
  assert.equal(calls[0].headers['Content-Type'], undefined);
  const preview = await repo.getMediaPreview(media);
  assert.equal(preview.media.url, '/images/posts/cover.png');
  assert.equal(calls.length, 1);
  await repo.deleteMediaBatch([media]);
  assert.equal(calls[1].url, '/api/v1/media/delete');
  assert.equal(JSON.parse(calls[1].body).media[0].revision, 'm1');
});

test('trash and history restoration always carry the displayed revision guards', async () => {
  const { repo, calls } = fixture(() => Response.json({ state }));
  await repo.getTrash();
  await repo.restoreTrash('post', post());
  await repo.getHistory('post', 'first');
  await repo.restoreRevision('post', 'first', 'older-r1', 'current-r3');
  assert.deepEqual(calls.map(item => item.url), ['/api/v1/trash', '/api/v1/trash/restore', '/api/v1/history?kind=post&id=first', '/api/v1/history/restore']);
  assert.equal(JSON.parse(calls[1].body).item.revision, 'r1');
  assert.deepEqual(JSON.parse(calls[3].body), { kind: 'post', id: 'first', revision: 'older-r1', expectedRevision: 'current-r3' });
  await assert.rejects(repo.restoreRevision('post', 'first', 'older-r1', ''), /版本|刷新/);
  await assert.rejects(repo.restoreTrash('post', { ...post(), revision: '' }), /版本|刷新/);
  assert.equal(calls.length, 4);
});

test('the same-origin API boundary rejects absolute, protocol-relative and traversal URLs', async () => {
  assert.equal(typeof adapter.createHttpRepository, 'function');
  for (const apiUrl of ['https://other.example/api/v1', '//other.example/api', '/api/../private', '/api/%2e%2e/private']) {
    assert.throws(() => adapter.createHttpRepository({ ...config, apiUrl }), /同源|路径/);
  }
});

test('HTTP failures preserve conflict codes and ambiguous write failures prompt a refresh', async () => {
  const { repo } = fixture(() => Response.json({ error: '内容已更新，请刷新', code: 'conflict' }, { status: 409 }));
  await assert.rejects(repo.savePost(post()), error => error.status === 409 && error.code === 'conflict' && /刷新/.test(error.message));
  const offline = fixture(() => { throw new TypeError('offline'); }).repo;
  await assert.rejects(offline.savePost(post()), error => error.code === 'connection' && /确认|刷新/.test(error.message));
});

function browserFixture() {
  let listener;
  const popup = { closed: false, close() { this.closed = true; }, postMessage() {} };
  const browser = { location: { origin: 'https://blog.example' }, open() { return popup; }, addEventListener(_name, value) { listener = value; }, removeEventListener(_name, value) { if (listener === value) listener = undefined; } };
  return { browser, popup, send: event => listener?.(event), listening: () => Boolean(listener) };
}

test('OAuth validates origin and popup then exchanges the transient token for a cookie session', async () => {
  const fake = browserFixture();
  const { repo, calls } = fixture(() => Response.json({ connection: state.connection }), { window: fake.browser, sessionStorage: { getItem() { throw new Error('persistent token access'); }, setItem() { throw new Error('persistent token access'); } } });
  const pending = repo.login();
  const data = 'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'transient-token' });
  fake.send({ origin: 'https://evil.example', source: fake.popup, data });
  fake.send({ origin: 'https://auth.example', source: {}, data });
  assert.equal(calls.length, 0);
  fake.send({ origin: 'https://auth.example', source: fake.popup, data });
  assert.deepEqual(await pending, state.connection);
  assert.equal(calls[0].url, '/api/v1/session');
  assert.deepEqual(JSON.parse(calls[0].body), { token: 'transient-token' });
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(fake.listening(), false);
  await repo.logout();
  assert.equal(calls[1].url, '/api/v1/session');
  assert.equal(calls[1].method, 'DELETE');
});

test('logout waits for an in-flight session exchange so a late cookie cannot undo logout', async () => {
  const fake = browserFixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { repo, calls } = fixture((_url, options) => options.method === 'POST' ? gate : Response.json({ connection: { authenticated: false } }), { window: fake.browser });
  const pending = repo.login();
  const rejected = assert.rejects(pending, /取消/);
  fake.send({ origin: 'https://auth.example', source: fake.popup, data: 'authorization:github:success:' + JSON.stringify({ provider: 'github', token: 'transient-token' }) });
  await new Promise(resolve => setImmediate(resolve));
  const loggedOut = repo.logout();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'DELETE must follow the completed cookie exchange');
  release(Response.json({ connection: state.connection }));
  await loggedOut; await rejected;
  assert.equal(calls.at(-1).method, 'DELETE');
});

test('backup download preserves the complete attachment and validation is multipart preflight only', async () => {
  const fullBackup = new Uint8Array([1, 4, 5, 9, 0, 255]);
  const { repo, calls } = fixture(url => url.endsWith('/export')
    ? new Response(fullBackup, { headers: { 'Content-Type': 'application/x-tar', 'Content-Disposition': 'attachment; filename="huaovo-2026-10-15.tar"' } })
    : Response.json({ importable: false, summary: { posts: 2, media: 1 }, reason: '只能导入空库' }));
  const backup = await repo.exportBackup();
  assert.equal(backup.filename, 'huaovo-2026-10-15.tar');
  assert.deepEqual(new Uint8Array(await backup.blob.arrayBuffer()), fullBackup);
  const result = await repo.validateBackup(new File([fullBackup], 'backup.tar'));
  assert.equal(result.importable, false);
  assert.equal(calls[1].url, '/api/v1/backups/validate');
  assert.equal(calls[1].body.get('file').name, 'backup.tar');
  assert.equal(calls.some(item => item.url.includes('/import')), false);
});

test('browser backup validation rejects files larger than the documented 32 MB limit before upload', async () => {
  const { repo, calls } = fixture();
  await assert.rejects(repo.validateBackup(new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'large.tar')), /32 MB|命令/);
  assert.equal(calls.length, 0);
});

test('a metadata-only JSON response cannot be presented as a complete backup download', async () => {
  const { repo } = fixture(() => Response.json({ posts: [post()], media: [{ name: 'cover.png' }] }));
  await assert.rejects(repo.exportBackup(), /完整备份|格式/);
});
