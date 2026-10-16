import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { createContentStore, CONTENT_SCHEMA } from '../src/server/storage/content-store.js';
import { runScheduledBackup } from '../src/server/scheduled-backup.js';
import { readBackup } from '../src/server/backup.js';
import { sha256 } from '../src/server/auth.js';
import { crc32 } from 'node:zlib';

async function fixture(t) {
  const database = createNodeDatabase(':memory:'); t.after(() => database.close());
  await database.exec(CONTENT_SCHEMA);
  await database.exec(await readFile(new URL('../migrations/003_operations.sql', import.meta.url), 'utf8'));
  const store = createContentStore(database);
  const settings = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
  await store.saveSettings(settings);
  // Two real-size image objects ensure multipart boundaries are exercised.
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const text = Buffer.from('Comment\0' + 'x'.repeat(3 * 1024 * 1024));
  const chunk = Buffer.alloc(text.length + 12); chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const bytes = Buffer.concat([pixel.subarray(0, -12), chunk, pixel.subarray(-12)]);
  for (const name of ['one.png', 'two.png']) await store.addMedia({ name, objectKey: `media/${name}`, size: bytes.length, mime: 'image/png', checksum: await sha256(bytes) });
  return { database, store, blobs: { get: async () => ({ size: bytes.length, body: new Blob([bytes]).stream() }) } };
}

test('scheduled archive streams multipart, verifies content and retains seven successful backups', async t => {
  const runtime = await fixture(t);
  const old = Array.from({ length: 7 }, (_, i) => ({ id: `old-${i}`, key: `backups/old-${i}.tar` }));
  await runtime.database.batch(old.map((item, i) => ({ sql: "INSERT INTO backup_runs (id,object_key,started_at,status) VALUES (?,?,?,'success')", params: [item.id, item.key, `2026-01-0${i + 1}T00:00:00Z`] })));
  const parts = [], deleted = []; let completed, objectKey;
  const bucket = {
    async createMultipartUpload(key) {
      objectKey = key;
      return {
        async uploadPart(partNumber, bytes) { parts.push(Uint8Array.from(bytes)); return { partNumber, etag: `part-${partNumber}` }; },
        async complete(uploaded) { completed = uploaded; },
        async abort() { assert.fail('successful archive must not abort'); },
      };
    },
    async delete(key) { deleted.push(key); },
  };
  const result = await runScheduledBackup(runtime, bucket);
  assert.equal(result.status, 'success');
  assert.equal(parts.length, 2); assert.equal(parts[0].length, 5 * 1024 * 1024);
  assert.deepEqual(completed.map(part => part.partNumber), [1, 2]);
  const checked = await readBackup(new Blob(parts).stream(), { retainMedia: false });
  assert.equal(checked.summary.media, 2); assert.equal(checked.summary.settings, true);
  assert.match(objectKey, /^backups\/\d{4}-\d{2}-\d{2}\/[\w-]+\.tar$/);
  assert.deepEqual(deleted, [old[0].key]);
  assert.equal((await runtime.database.all("SELECT * FROM backup_runs WHERE status='success'")).length, 7);
});

test('failed multipart upload aborts and records failure without pruning successful backups', async t => {
  const runtime = await fixture(t); let aborted = false;
  const bucket = {
    async createMultipartUpload() { return { async uploadPart() { throw new Error('storage unavailable'); }, async complete() { assert.fail('incomplete archive'); }, async abort() { aborted = true; } }; },
    async delete() { assert.fail('failed upload must not prune'); },
  };
  await assert.rejects(runScheduledBackup(runtime, bucket), /storage unavailable/);
  assert.equal(aborted, true);
  const [run] = await runtime.database.all('SELECT status,error_code FROM backup_runs');
  assert.deepEqual(run, { status: 'failed', error_code: 'backup_failed' });
});
