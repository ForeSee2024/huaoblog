import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { createContentStore, CONTENT_SCHEMA } from '../src/server/storage/content-store.js';
import { createContentHandler, serveMedia } from '../src/server/api.js';
import { exportBackup, readBackup } from '../src/server/backup.js';
import { sha256 } from '../src/server/auth.js';
import { validateObjectKey } from '../src/server/storage/keys.js';

const origin = 'http://127.0.0.1:4321';
const settings = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

async function runtime(t) {
  const database = createNodeDatabase(':memory:');
  t.after(() => database.close());
  await database.exec(CONTENT_SCHEMA);
  await database.exec(await readFile(new URL('../migrations/002_sessions.sql', import.meta.url), 'utf8'));
  const store = createContentStore(database), objects = new Map();
  const blobs = {
    async put(key, bytes) { validateObjectKey(key); objects.set(key, new Uint8Array(bytes)); },
    async get(key) { validateObjectKey(key); const bytes = objects.get(key); return bytes ? { body: new Blob([bytes]).stream(), size: bytes.length, contentType: 'image/png' } : null; },
    async delete(key) { validateObjectKey(key); objects.delete(key); },
  };
  const result = { store, database, blobs, config: { deployment: 'node', siteUrl: origin, devAuth: true, githubUserId: '160737293' } };
  return { ...result, objects, handle: createContentHandler(result) };
}

async function sourceArchive(t, objectKey = 'media/pixel.png') {
  const source = await runtime(t);
  await source.store.saveSettings(settings);
  await source.blobs.put(objectKey, png);
  await source.store.addMedia({ name: 'pixel.png', objectKey, size: png.length, mime: 'image/png', checksum: await sha256(png) });
  await source.store.savePost({ slug: 'restored-post', data: { title: '恢复文章', description: '恢复摘要', pubDate: '2026-10-15', category: '软件工程与系统', tags: [] }, body: '![image](/images/posts/pixel.png)' }, { publish: true });
  return new Uint8Array(await (await exportBackup(source)).arrayBuffer());
}

function importRequest(archive) {
  return new Request(`${origin}/api/v1/backups/import`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-tar' }, body: archive });
}

test('a truncated import preserves existing blob objects and removes every staging object', async t => {
  const archive = await sourceArchive(t), target = await runtime(t);
  const existing = new Uint8Array([1, 2, 3]);
  await target.blobs.put('media/pixel.png', existing);
  const response = await target.handle(importRequest(archive.slice(0, -1024)));
  assert.equal(response.status, 400);
  assert.deepEqual([...target.objects.keys()], ['media/pixel.png']);
  assert.deepEqual(target.objects.get('media/pixel.png'), existing);
  assert.equal((await target.store.exportSnapshot()).media.length, 0);
});

test('a successful staged restore rewrites media history keys and can be exported and verified again', async t => {
  const archive = await sourceArchive(t), target = await runtime(t);
  const response = await target.handle(importRequest(archive));
  assert.equal(response.status, 200);
  const snapshot = await target.store.exportSnapshot(), image = snapshot.media[0];
  assert.notEqual(image.objectKey, 'media/pixel.png');
  assert.equal(image.publicUrl, '/images/posts/pixel.png');
  assert.deepEqual(target.objects.get(image.objectKey), png);
  assert.equal(snapshot.posts[0].published.body, '![image](/images/posts/pixel.png)');
  const history = snapshot.history.filter(item => item.kind === 'media');
  assert.ok(history.length > 0);
  assert.ok(history.every(item => item.snapshot.objectKey === image.objectKey));
  const verified = await readBackup((await exportBackup(target)).body);
  assert.deepEqual(verified.files.get(image.objectKey), png);
});

test('valid backup keys at the object-store limit remain restorable with bounded new keys', async t => {
  const sourceKey = `media/${'a'.repeat(1014)}.png`;
  assert.equal(sourceKey.length, 1024);
  const archive = await sourceArchive(t, sourceKey), target = await runtime(t);
  const response = await target.handle(importRequest(archive));
  assert.equal(response.status, 200);
  const image = (await target.store.exportSnapshot()).media[0];
  assert.ok(image.objectKey.length <= 1024);
  assert.deepEqual(target.objects.get(image.objectKey), png);
});

test('unauthenticated conditional image requests cannot reveal a private upload', async t => {
  const target = await runtime(t), checksum = await sha256(png);
  await target.blobs.put('media/private.png', png);
  await target.store.addMedia({ name: 'private.png', objectKey: 'media/private.png', size: png.length, mime: 'image/png', checksum });
  for (const method of ['GET', 'HEAD']) {
    const response = await serveMedia(new Request('https://huaoblog.cn/images/posts/private.png', { method, headers: { 'If-None-Match': `"${checksum}"` } }), target, 'private.png');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('ETag'), null);
  }
});

test('restoring media history cannot make a currently published article image private', async t => {
  const target = await runtime(t), checksum = await sha256(png);
  await target.store.saveSettings(settings);
  await target.blobs.put('media/pixel.png', png);
  await target.store.addMedia({ name: 'pixel.png', objectKey: 'media/pixel.png', size: png.length, mime: 'image/png', checksum });
  const original = (await target.store.getHistory('media', 'pixel.png'))[0];
  await target.store.savePost({ slug: 'published-image', data: { title: '含图文章', description: '摘要', pubDate: '2026-10-15', category: '软件工程与系统', tags: [] }, body: '![image](/images/posts/pixel.png)' }, { publish: true });
  const image = await target.store.getMedia('pixel.png');
  assert.equal(image.public, true);
  const restored = await target.handle(new Request(`${origin}/api/v1/history/restore`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'media', id: image.name, revision: original.revision, expectedRevision: image.revision }) }));
  assert.equal(restored.status, 200);
  const fetched = await serveMedia(new Request('https://huaoblog.cn/images/posts/pixel.png'), target, image.name);
  assert.equal(fetched.status, 200);
  await assert.doesNotReject(exportBackup(target));
});

test('recovery and backup metadata require authentication and reject cross-site writes before parsing', async t => {
  const target = await runtime(t);
  for (const path of ['trash', 'history?kind=post&id=secret', 'backups/export', 'posts/secret?status=draft']) {
    assert.equal((await target.handle(new Request(`https://huaoblog.cn/api/v1/${path}`))).status, 401);
  }
  for (const path of ['session', 'posts', 'settings', 'trash/restore', 'history/restore', 'backups/import']) {
    const method = path === 'settings' ? 'PUT' : 'POST';
    const response = await target.handle(new Request(`${origin}/api/v1/${path}`, { method, headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: 'not JSON' }));
    assert.equal(response.status, 403);
  }
});
