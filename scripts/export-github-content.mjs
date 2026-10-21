import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotFromGit } from '../src/server/git-export.js';
import { exportBackup } from '../src/server/backup.js';
import { openContentRuntime, options } from './content-runtime.mjs';
import { writeArchive } from './archive-file.mjs';
const args = options();
if (!args.out) throw new Error('Usage: npm run content:export-git -- --out archive.tar [--published-ref origin/main] [--settings-ref origin/huaovo/site-settings] [--media-ref origin/huaovo/media-branch]');
const source = await snapshotFromGit({ cwd: process.cwd(), publishedRef: args['published-ref'], settingsRef: args['settings-ref'], mediaRef: args['media-ref'] });
const temporary = await mkdtemp(join(tmpdir(), 'huaovo-git-export-')); let runtime;
try {
  runtime = await openContentRuntime(temporary);
  await runtime.store.importSnapshot(source.snapshot, { onlyIfEmpty: true });
  for (const media of source.snapshot.media) await runtime.blobs.put(media.objectKey, source.objects.get(media.objectKey), { contentType: media.mime });
  const path = await writeArchive(await exportBackup(runtime), args.out);
  if (args.provenance) await writeFile(args.provenance, JSON.stringify(source.provenance, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ archive: path, ...source.provenance }, null, 2));
} finally { runtime?.database.close(); await rm(temporary, { recursive: true, force: true }); }
