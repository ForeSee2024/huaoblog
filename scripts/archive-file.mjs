import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Local files have a known bound; streams retain the conservative default unless explicitly raised. */
export async function archiveReadOptions(path, requestedLimit) {
  if (requestedLimit !== undefined) {
    if (!/^[1-9]\d*$/.test(requestedLimit) || !Number.isSafeInteger(Number(requestedLimit))) throw new Error('--max-total-bytes must be a positive safe integer.');
    return { maxTotalBytes: Number(requestedLimit) };
  }
  const file = await stat(path);
  return { maxTotalBytes: Math.max(1024 ** 3, file.isFile() ? file.size : 0) };
}

export async function writeArchive(response, output) {
  const path = resolve(output); await mkdir(dirname(path), { recursive: true });
  const target = createWriteStream(path, { flags: 'wx', mode: 0o600 }); let created = false;
  target.once('open', () => { created = true; });
  try { await pipeline(Readable.fromWeb(response.body), target); }
  catch (error) { if (created) await rm(path, { force: true }); throw error; }
  return path;
}
