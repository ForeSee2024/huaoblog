import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { createContentStore, CONTENT_SCHEMA } from '../src/server/storage/content-store.js';
import { readFile } from 'node:fs/promises';
import { sha256 } from '../src/server/auth.js';
const backup = await import('../src/server/backup.js').catch(() => ({}));
const settings = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
async function fixture(t) {
  const database = createNodeDatabase(':memory:'); t.after(() => database.close()); await database.exec(CONTENT_SCHEMA);
  const store = createContentStore(database); await store.saveSettings(settings);
  await store.addMedia({ name: 'pixel.png', objectKey: 'media/pixel.png', size: png.length, mime: 'image/png', checksum: await sha256(png) });
  await store.savePost({ slug: 'real-post', data: { title: '真实文章', description: '描述', category: '生活随笔与杂项', pubDate: '2026-10-15', tags: [] }, body: '![图](/images/posts/pixel.png)' }, { publish: true });
  const blobs = { get: async key => key === 'media/pixel.png' ? { body: new Blob([png]).stream(), size: png.length, contentType: 'image/png' } : null };
  return { store, blobs };
}
test('a streaming portable archive round trips articles, history and exact media bytes', async t => {
  assert.equal(typeof backup.exportBackup, 'function');
  const runtime = await fixture(t);
  const response = await backup.exportBackup(runtime);
  assert.match(response.headers.get('Content-Disposition'), /huaovo-.*\.tar/);
  const archive = new Uint8Array(await response.arrayBuffer());
  const checked = await backup.readBackup(new Blob([archive]).stream());
  assert.equal(checked.snapshot.posts[0].published.body, '![图](/images/posts/pixel.png)');
  assert.ok(checked.snapshot.history.length);
  assert.deepEqual(checked.files.get('media/pixel.png'), png);
  const target = createNodeDatabase(':memory:'); t.after(() => target.close()); await target.exec(CONTENT_SCHEMA);
  const restored = createContentStore(target);
  await restored.importSnapshot(checked.snapshot, { onlyIfEmpty: true });
  assert.deepEqual(await restored.exportSnapshot().then(s => s.posts), checked.snapshot.posts);
  assert.ok(!new TextDecoder().decode(archive).includes('auth_sessions'));
});
test('preflight rejects corrupt, truncated or unexpected archives before any restore', async t => {
  assert.equal(typeof backup.readBackup, 'function');
  const runtime = await fixture(t);
  const archive = new Uint8Array(await (await backup.exportBackup(runtime)).arrayBuffer());
  const corrupt = archive.slice(); corrupt[512] ^= 1;
  await assert.rejects(backup.readBackup(new Blob([corrupt]).stream()));
  await assert.rejects(backup.readBackup(new Blob([archive.slice(0, -1024)]).stream()));
  await assert.rejects(backup.readBackup(new Blob([new TextEncoder().encode('not tar')]).stream()));
});
