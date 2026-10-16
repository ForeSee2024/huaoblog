import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ContentError } from '../../admin/content-model.js';
import { validateObjectKey } from './keys.js';
import { blobBytes, blobContentType } from './blob-values.js';

const magic = Buffer.from('HUAOVO-BLOB-1\n');
const unsafe = () => new ContentError('对象存储路径包含符号链接或不安全的文件。');

export function createFileBlobStore(root) {
  const absoluteRoot = path.resolve(root);
  let ready;
  async function directory() {
    ready ??= mkdir(absoluteRoot, { recursive: true }).then(() => realpath(absoluteRoot));
    return ready;
  }
  async function location(key, { create = false } = {}) {
    validateObjectKey(key);
    const base = await directory(), segments = key.split('/');
    let current = base;
    for (let index = 0; index < segments.length; index++) {
      current = path.join(current, segments[index]);
      const final = index === segments.length - 1;
      if (!final && create) {
        try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      let stat;
      try { stat = await lstat(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink() || (!final && !stat.isDirectory()) || (final && !stat.isFile())) throw unsafe();
    }
    const parent = path.dirname(current);
    try { const actual = await realpath(parent); if (actual !== base && !actual.startsWith(`${base}${path.sep}`)) throw unsafe(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return current;
  }
  return {
    async put(key, input, { contentType } = {}) {
      const bytes = blobBytes(input), mime = blobContentType(contentType);
      const file = await location(key, { create: true });
      const temporary = path.join(path.dirname(file), `.huaovo-${randomUUID()}.tmp`);
      const metadata = { contentType: mime, size: bytes.length, etag: createHash('sha256').update(bytes).digest('hex') };
      // One envelope keeps bytes and metadata together through atomic replacement.
      const contents = Buffer.concat([magic, Buffer.from(`${JSON.stringify(metadata)}\n`), bytes]);
      let handle;
      try {
        handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(contents);
        await handle.sync();
        await handle.close(); handle = null;
        await location(key, { create: true });
        await rename(temporary, file);
      } finally { await handle?.close(); await rm(temporary, { force: true }); }
    },
    async get(key) {
      const file = await location(key);
      let handle;
      try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      try {
        const data = await handle.readFile();
        const boundary = data.indexOf(10, magic.length);
        if (!data.subarray(0, magic.length).equals(magic) || boundary < 0) throw new ContentError('对象存储文件格式损坏。', 500, 'storage_error');
        const metadata = JSON.parse(data.subarray(magic.length, boundary).toString('utf8'));
        const body = data.subarray(boundary + 1);
        if (metadata.size !== body.length || metadata.etag !== createHash('sha256').update(body).digest('hex')) throw new ContentError('对象存储文件校验失败。', 500, 'storage_error');
        return { body, size: body.length, etag: metadata.etag, contentType: blobContentType(metadata.contentType) };
      } finally { await handle.close(); }
    },
    async delete(key) { const file = await location(key); await rm(file, { force: true }); },
  };
}
