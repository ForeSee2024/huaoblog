import { exportBackup } from '../src/server/backup.js';
import { openContentRuntime, options } from './content-runtime.mjs';
import { writeArchive } from './archive-file.mjs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
const args = options();
if (!args['data-dir'] || !args.out) throw new Error('Usage: npm run content:backup -- --data-dir /path/to/data --out backup.tar');
await access(resolve(args['data-dir'], 'content.sqlite'));
const runtime = await openContentRuntime(args['data-dir']);
try { console.log(JSON.stringify({ archive: await writeArchive(await exportBackup(runtime), args.out) })); }
finally { runtime.database.close(); }
