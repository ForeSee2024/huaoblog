import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHttpRepository } from '../src/admin/http-repository.js';
import { loadEditorPost } from '../src/admin/editor-state.js';
import { createContentHandler } from '../src/server/api.js';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { CONTENT_SCHEMA, createContentStore } from '../src/server/storage/content-store.js';
import { readBackup } from '../src/server/backup.js';

const settings = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const newPost = () => ({ slug: 'adapter-contract', data: { title: '接口契约', description: '完整编辑流程', pubDate: '2026-10-15', category: '软件工程与系统', tags: [] }, body: '草稿正文' });
async function setup(t) {
  const database = createNodeDatabase(':memory:');
  t.after(() => database.close());
  await database.exec(CONTENT_SCHEMA);
  const store = createContentStore(database), objects = new Map();
  const blobs = { async put(key, bytes) { objects.set(key, bytes); }, async get(key) { const body = objects.get(key); return body ? { body, size: body.length } : null; }, async delete(key) { objects.delete(key); } };
  const config = { backend: 'api', direct: true, apiUrl: '/api/v1', deployment: 'node', devAuth: true, siteUrl: 'http://127.0.0.1:4321', githubUserId: '160737293' };
  const handler = createContentHandler({ database, store, blobs, config });
  const requests = [];
  const repo = createHttpRepository(config, { async fetch(path, options) {
    requests.push([options.method, path]);
    const headers = new Headers(options.headers);
    if (options.method !== 'GET') headers.set('Origin', config.siteUrl);
    return handler(new Request(config.siteUrl + path, { ...options, headers }));
  } });
  await repo.saveSettings(settings);
  return { repo, store, objects, requests };
}

test('the browser adapter and real SQLite API preserve drafts, revision conflicts and recovery', async t => {
  const { repo, store, requests } = await setup(t);
  let saved = await repo.savePost(newPost());
  assert.deepEqual(await store.getPublishedPosts(), []);
  const workspace = await repo.load();
  assert.equal(workspace.posts[0].bodyLoaded, false);
  const editable = await loadEditorPost(repo, workspace.posts, 'adapter-contract', 'draft');
  assert.equal(editable.body, '草稿正文');
  saved = await repo.savePost(editable, { publish: true });
  const published = saved.post;
  const draft = (await repo.savePost({ ...published, body: '新的未发布修订' })).post;
  assert.equal((await store.getPost(published.slug, 'published')).body, '草稿正文');
  await assert.rejects(repo.savePost({ ...published, body: '旧窗口的修订' }), error => error.status === 409 && error.code === 'conflict');
  const deleted = await repo.deletePosts([{ ...published, revision: draft.revision }]);
  assert.equal(deleted.deleted.length, 1);
  assert.equal(deleted.state.posts.length, 1);
  assert.equal(deleted.state.posts[0].status, 'draft');
  const trash = await repo.getTrash();
  const restored = await repo.restoreTrash('post', trash.posts[0]);
  assert.equal(restored.state.posts.length, 2);
  const history = await repo.getHistory('post', published.slug);
  assert.ok(history.versions.length >= 3);
  const original = history.versions.find(version => version.snapshot.published?.body === '草稿正文' && !version.snapshot.draft);
  assert.ok(original);
  const reverted = await repo.restoreRevision('post', published.slug, original.revision, restored.state.posts[0].revision);
  assert.equal(reverted.state.posts.length, 1);
  assert.equal((await store.getPost(published.slug, 'published')).body, '草稿正文');
  assert.ok(requests.every(([_method, path]) => path.startsWith('/api/v1/')));
});

test('the adapter downloads and validates a complete TAR with actual media bytes', async t => {
  const { repo, objects } = await setup(t);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const uploaded = await repo.uploadMedia(new File([bytes], 'contract.png', { type: 'image/png' }));
  assert.equal(objects.size, 1);
  const article = await repo.savePost({ ...newPost(), body: `![完整图片](${uploaded.media.publicUrl})` }, { publish: true });
  assert.equal(article.state.media[0].public, true);
  const exported = await repo.exportBackup();
  assert.match(exported.filename, /\.tar$/);
  const checked = await readBackup(exported.blob.stream());
  assert.equal(checked.summary.posts, 1);
  assert.equal(checked.summary.media, 1);
  assert.deepEqual(Buffer.from(checked.files.get(uploaded.media.objectKey)), bytes);
  const validation = await repo.validateBackup(new File([exported.blob], exported.filename, { type: 'application/x-tar' }));
  assert.equal(validation.valid, true);
  assert.equal(validation.importable, false);
  assert.equal(validation.summary.media, 1);
  const blocked = await repo.deleteMediaBatch([article.state.media[0]]);
  assert.equal(blocked.deleted.length, 0);
  assert.equal(blocked.failed[0].code, 'referenced_media');
});
