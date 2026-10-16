import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { restoreBackup, readBackup } from '../src/server/backup.js';
import { openContentRuntime, options } from './content-runtime.mjs';
import { archiveReadOptions } from './archive-file.mjs';
const args = options();
if (!args.archive || (!args['data-dir'] && args.mode !== 'validate')) throw new Error('Usage: npm run content:import -- --archive backup.tar --data-dir /path/to/empty-data (or --mode validate) [--max-total-bytes bytes]');
const limits = await archiveReadOptions(args.archive, args['max-total-bytes']);
const stream = () => Readable.toWeb(createReadStream(args.archive));
if (args.mode === 'validate') {
  const result = await readBackup(stream(), { ...limits, retainMedia: false }); console.log(JSON.stringify({ valid: true, summary: result.summary }, null, 2));
} else {
  const runtime = await openContentRuntime(args['data-dir']);
  try { console.log(JSON.stringify(await restoreBackup(runtime, stream(), limits), null, 2)); }
  finally { runtime.database.close(); }
}
