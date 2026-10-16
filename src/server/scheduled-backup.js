import { exportBackup } from './backup.js';

/** Multipart upload bounds memory and accepts a streaming archive without knowing its final length. */
async function uploadArchive(bucket, key, stream) {
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: 'application/x-tar' } });
  const reader = stream.getReader(), parts = []; const partSize = 5 * 1024 * 1024;
  let buffer = new Uint8Array(partSize), offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      for (let start = 0; start < value.length;) {
        const count = Math.min(partSize - offset, value.length - start); buffer.set(value.subarray(start, start + count), offset); offset += count; start += count;
        if (offset === partSize) { parts.push(await upload.uploadPart(parts.length + 1, buffer)); buffer = new Uint8Array(partSize); offset = 0; }
      }
    }
    if (offset) parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, offset)));
    await upload.complete(parts);
  } catch (error) { await upload.abort().catch(() => {}); throw error; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function runScheduledBackup(runtime, bucket) {
  const { store, database } = runtime;
  const snapshot = await store.exportSnapshot();
  if (!snapshot.settings) return { skipped: true };
  const id = crypto.randomUUID(), startedAt = new Date().toISOString(), key = `backups/${startedAt.slice(0, 10)}/${id}.tar`;
  await database.batch([{ sql: 'INSERT INTO backup_runs (id, object_key, started_at, status) VALUES (?, ?, ?, ?)', params: [id, key, startedAt, 'running'] }]);
  try {
    const response = await exportBackup(runtime, { snapshot });
    await uploadArchive(bucket, key, response.body);
    await database.batch([{ sql: 'UPDATE backup_runs SET status = ?, finished_at = ? WHERE id = ?', params: ['success', new Date().toISOString(), id] }]);
    const old = await database.all("SELECT id, object_key FROM backup_runs WHERE status = 'success' ORDER BY started_at DESC LIMIT -1 OFFSET 7");
    for (const backup of old) {
      await bucket.delete(backup.object_key);
      await database.batch([{ sql: 'DELETE FROM backup_runs WHERE id = ?', params: [backup.id] }]);
    }
    return { id, status: 'success' };
  } catch (error) {
    await database.batch([{ sql: 'UPDATE backup_runs SET status = ?, finished_at = ?, error_code = ? WHERE id = ?', params: ['failed', new Date().toISOString(), error.code || 'backup_failed', id] }]);
    throw error;
  }
}
