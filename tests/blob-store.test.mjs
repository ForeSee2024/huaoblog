import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
const filesystem = await import('../src/server/storage/filesystem.js').catch(() => ({}));
const r2 = await import('../src/server/storage/r2.js').catch(() => ({}));
const bytes = new TextEncoder().encode('image-bytes');
async function temporary(t) { const root = await mkdtemp(path.join(tmpdir(), 'huaovo-blobs-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('filesystem blob storage persists nested keys atomically and returns metadata', async t => {
  assert.equal(typeof filesystem.createFileBlobStore, 'function', 'file blob storage is not implemented');
  const root = await temporary(t), store = filesystem.createFileBlobStore(root);
  assert.equal(await store.get('media/missing.png'), null);
  await store.put('media/one.png', bytes, { contentType: 'image/png' });
  const result = await store.get('media/one.png');
  assert.deepEqual(new Uint8Array(await new Response(result.body).arrayBuffer()), bytes);
  assert.equal(result.size, bytes.length);
  assert.equal(result.contentType, 'image/png');
  assert.ok(result.etag);
  const reopened = filesystem.createFileBlobStore(root);
  assert.equal((await reopened.get('media/one.png')).etag, result.etag);
  await reopened.put('media/one.png', new Uint8Array([1, 2]), { contentType: 'image/webp' });
  assert.equal((await reopened.get('media/one.png')).size, 2);
  assert.equal((await reopened.get('media/one.png')).contentType, 'image/webp');
  await reopened.delete('media/one.png');
  assert.equal(await reopened.get('media/one.png'), null);
  await reopened.delete('media/one.png');
});

test('filesystem rejects traversal and symlink escapes for every operation', async t => {
  assert.equal(typeof filesystem.createFileBlobStore, 'function', 'file blob storage is not implemented');
  const root = await temporary(t), outside = await temporary(t), store = filesystem.createFileBlobStore(root);
  await writeFile(path.join(outside, 'sentinel.png'), 'unchanged');
  await symlink(outside, path.join(root, 'escape'));
  await mkdir(path.join(root, 'media'));
  await symlink(path.join(outside, 'sentinel.png'), path.join(root, 'media/link.png'));
  const unsafe = ['/tmp/absolute.png', '../escape.png', 'a/../../escape.png', 'a\\b.png', 'a//b.png', 'a/%2e%2e/b.png', 'escape/sentinel.png', 'media/link.png'];
  for (const key of unsafe) {
    await assert.rejects(store.put(key, bytes, { contentType: 'image/png' }));
    await assert.rejects(store.get(key));
    await assert.rejects(store.delete(key));
  }
  assert.equal(await readFile(path.join(outside, 'sentinel.png'), 'utf8'), 'unchanged');
});

test('R2 blob storage delegates binding metadata and validates portable object keys', async () => {
  assert.equal(typeof r2.createR2BlobStore, 'function', 'R2 blob storage is not implemented');
  const objects = new Map(), calls = [];
  const bucket = { async put(key, body, options) { calls.push({ key, options }); objects.set(key, { body, size: body.byteLength, etag: 'opaque', httpMetadata: options.httpMetadata }); }, async get(key) { return objects.get(key) ?? null; }, async delete(key) { objects.delete(key); } };
  const store = r2.createR2BlobStore(bucket);
  await store.put('media/one.png', bytes, { contentType: 'image/png' });
  assert.deepEqual(calls[0], { key: 'media/one.png', options: { httpMetadata: { contentType: 'image/png' } } });
  assert.deepEqual(await store.get('media/one.png'), { body: bytes, size: bytes.length, etag: 'opaque', contentType: 'image/png' });
  for (const key of ['../escape', '/absolute', 'a/%2fetc', 'a\\b']) {
    await assert.rejects(store.put(key, bytes, { contentType: 'image/png' }));
    await assert.rejects(store.get(key));
    await assert.rejects(store.delete(key));
  }
  await store.delete('media/one.png');
  assert.equal(await store.get('media/one.png'), null);
});

test('actual R2 binding preserves bytes and metadata', { skip: !process.env.HUAOVO_TEST_BINDINGS, timeout: 60000 }, async t => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', compatibilityDate: '2026-10-15', r2Buckets: ['MEDIA'] }));
  t.after(() => mf.dispose());
  const store = r2.createR2BlobStore(await mf.getR2Bucket('MEDIA'));
  await store.put('media/one.png', bytes, { contentType: 'image/png' });
  const object = await store.get('media/one.png');
  assert.equal(object.size, bytes.length);
  assert.equal(object.contentType, 'image/png');
  assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()), bytes);
  await store.delete('media/one.png');
  assert.equal(await store.get('media/one.png'), null);
});
