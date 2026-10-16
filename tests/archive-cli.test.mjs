import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { archiveReadOptions } from '../scripts/archive-file.mjs';
import { exportBackup } from '../src/server/backup.js';

test('Node restore supports an exported file larger than the HTTP default without buffering it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'huaovo-archive-limit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'large.tar'), length = 1024 ** 3 + 8192;
  const sparse = await open(path, 'wx'); await sparse.truncate(length); await sparse.close();
  assert.deepEqual(await archiveReadOptions(path), { maxTotalBytes: length });
  assert.deepEqual(await archiveReadOptions('/dev/stdin', String(2 * 1024 ** 3)), { maxTotalBytes: 2 * 1024 ** 3 });
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '9007199254740992']) await assert.rejects(archiveReadOptions(path, value), /positive safe integer/);
});

test('shipped import CLI passes the selected read budget to validation and restoration', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'huaovo-archive-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'content.tar');
  const snapshot = { format: 'huaovo-content', formatVersion: 1, exportedAt: '2026-10-16T00:00:00.000Z', settings: null, posts: [], media: [], history: [] };
  await writeFile(path, new Uint8Array(await (await exportBackup({ store: { exportSnapshot: async () => snapshot } })).arrayBuffer()));
  const invoke = args => execFileSync(process.execPath, ['scripts/import-content.mjs', '--archive', path, ...args], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.throws(() => invoke(['--mode', 'validate', '--max-total-bytes', '512']), /Command failed/);
  assert.equal(JSON.parse(invoke(['--mode', 'validate', '--max-total-bytes', String(2 * 1024 ** 3)])).valid, true);
  assert.throws(() => invoke(['--data-dir', join(dir, 'data'), '--max-total-bytes', '512']), /Command failed/);
  assert.equal(JSON.parse(invoke(['--data-dir', join(dir, 'data'), '--max-total-bytes', String(2 * 1024 ** 3)])).imported.posts, 0);
});
