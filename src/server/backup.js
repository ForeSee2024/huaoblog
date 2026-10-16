import { ContentError, MAX_IMAGE_BYTES, inspectMediaBytes, stringifyPost } from '../admin/content-model.js';
import { validateSnapshot } from './storage/content-store.js';
import { sha256 } from './auth.js';
import { readBytes } from './body.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const SNAPSHOT = 'content/snapshot.json';
const MANIFEST = 'manifest.json';
const MAX_METADATA = 16 * 1024 * 1024;
const jsonBytes = value => encoder.encode(JSON.stringify(value, null, 2) + '\n');
const blobPath = (item, index) => `media/${String(index).padStart(6, '0')}-${item.name.slice(0, 60)}`;
function documentFiles(snapshot) {
  const files = [{ path: SNAPSHOT, bytes: jsonBytes(snapshot) }];
  if (snapshot.settings) for (const status of ['published', 'draft']) {
    if (snapshot.settings[status]) files.push({ path: `content/settings-${status}.json`, bytes: jsonBytes(snapshot.settings[status]) });
  }
  snapshot.posts.forEach((entry, index) => {
    for (const status of ['published', 'draft']) if (entry[status]) files.push({ path: `posts/${status}/${String(index).padStart(6, '0')}-${entry.slug.slice(0, 60)}.md`, bytes: encoder.encode(stringifyPost({ ...entry[status], slug: entry.slug, status })) });
  });
  return files;
}
function tarHeader(path, size) {
  if (!/^[\w./-]{1,100}$/.test(path) || path.includes('..') || path.startsWith('/') || !Number.isSafeInteger(size) || size < 0) throw new ContentError('备份文件路径或大小无效。');
  const bytes = new Uint8Array(512);
  const write = (offset, length, value) => bytes.set(encoder.encode(value).slice(0, length), offset);
  write(0, 100, path); write(100, 8, '0000600\0'); write(108, 8, '0000000\0'); write(116, 8, '0000000\0');
  write(124, 12, size.toString(8).padStart(11, '0') + '\0'); write(136, 12, '00000000000\0');
  bytes.fill(32, 148, 156); bytes[156] = 48; write(257, 6, 'ustar\0'); write(263, 2, '00');
  const sum = bytes.reduce((a, b) => a + b, 0); write(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return bytes;
}
function parseHeader(bytes) {
  const string = (offset, length) => decoder.decode(bytes.subarray(offset, offset + length)).split('\0')[0];
  const declared = string(148, 8).trim();
  const checksum = bytes.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
  if (!/^[0-7]+$/.test(declared) || parseInt(declared, 8) !== checksum || string(257, 5) !== 'ustar' || ![0, 48].includes(bytes[156])) throw new ContentError('备份归档头无效或已损坏。', 400, 'backup_corrupt');
  const path = string(0, 100), rawSize = string(124, 12).trim();
  if (!/^[\w./-]{1,100}$/.test(path) || path.includes('..') || path.startsWith('/') || !/^[0-7]+$/.test(rawSize) || string(345, 155)) throw new ContentError('备份包含不安全的路径或格式。', 400, 'backup_corrupt');
  const size = parseInt(rawSize, 8);
  if (!Number.isSafeInteger(size) || size > MAX_METADATA) throw new ContentError('备份单个文件超过读取限制。', 413, 'payload_too_large');
  return { path, size };
}
function streamFrom(iterator) {
  return new ReadableStream({ async pull(controller) { try { const { done, value } = await iterator.next(); if (done) controller.close(); else controller.enqueue(value); } catch (error) { controller.error(error); } }, async cancel() { await iterator.return?.(); } });
}

/** Standard uncompressed TAR. Export is streamed; at most one image is buffered for verification. */
export async function exportBackup({ store, blobs }, options = {}) {
  const snapshot = validateSnapshot(options.snapshot || await store.exportSnapshot());
  const documents = documentFiles(snapshot);
  if (documents.some(file => file.bytes.length > MAX_METADATA) || documents.length + snapshot.media.length > 20000) throw new ContentError('内容超过网页备份限制，请使用命令行备份。', 413, 'backup_limit');
  async function* archive() {
    const manifest = { format: 'huaovo-backup', formatVersion: 1, exportedAt: snapshot.exportedAt, snapshot: SNAPSHOT, files: [], media: [] };
    async function* entry(path, bytes) {
      manifest.files.push({ path, size: bytes.length, sha256: await sha256(bytes) });
      yield tarHeader(path, bytes.length); yield bytes;
      if (bytes.length % 512) yield new Uint8Array(512 - bytes.length % 512);
    }
    for (const file of documents) yield* entry(file.path, file.bytes);
    for (let index = 0; index < snapshot.media.length; index++) {
      const media = snapshot.media[index];
      const object = await blobs.get(media.objectKey);
      if (!object || object.size > MAX_IMAGE_BYTES) throw new ContentError(`备份图片缺失：${media.name}`, 500, 'backup_missing_media');
      const bytes = await readBytes({ headers: new Headers(), body: object.body instanceof Uint8Array ? new Blob([object.body]).stream() : object.body }, MAX_IMAGE_BYTES);
      if (bytes.length !== media.size || await sha256(bytes) !== media.checksum) throw new ContentError(`备份图片校验失败：${media.name}`, 500, 'backup_corrupt');
      const path = blobPath(media, index); manifest.media.push({ objectKey: media.objectKey, path });
      yield* entry(path, bytes);
    }
    const bytes = jsonBytes(manifest); yield tarHeader(MANIFEST, bytes.length); yield bytes;
    if (bytes.length % 512) yield new Uint8Array(512 - bytes.length % 512);
    yield new Uint8Array(1024);
  }
  const date = snapshot.exportedAt.replace(/[:.]/g, '-');
  return new Response(streamFrom(archive()), { headers: { 'Content-Type': 'application/x-tar', 'Content-Disposition': `attachment; filename="huaovo-${date}.tar"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/** Read incrementally; CLI restore can persist verified blobs without retaining an entire archive. */
export async function readBackup(stream, { retainMedia = true, onMedia, onSnapshot, maxTotalBytes = 1024 * 1024 * 1024 } = {}) {
  const reader = stream.getReader(); let remaining = new Uint8Array(), total = 0, snapshot, manifest, ended = false;
  const hashes = new Map(), files = new Map(); let expectedMedia = new Map(), expectedDocuments;
  async function take(size) {
    const result = new Uint8Array(size); let offset = 0;
    while (offset < size) {
      if (!remaining.length) {
        const { done, value } = await reader.read();
        if (done) throw new ContentError('备份文件不完整。', 400, 'backup_corrupt');
        total += value.byteLength; if (total > maxTotalBytes) throw new ContentError('备份文件超过读取限制。', 413, 'payload_too_large');
        remaining = value;
      }
      const count = Math.min(size - offset, remaining.length); result.set(remaining.subarray(0, count), offset); remaining = remaining.subarray(count); offset += count;
    }
    return result;
  }
  try {
    for (let count = 0; count < 20002; count++) {
      const header = await take(512);
      if (header.every(value => value === 0)) { if (!(await take(512)).every(value => value === 0)) throw new ContentError('备份结束标记损坏。'); ended = true; break; }
      if (manifest) throw new ContentError('备份清单之后包含额外文件。');
      const { path, size } = parseHeader(header);
      if (hashes.has(path) || (count === 0 && path !== SNAPSHOT)) throw new ContentError('备份包含重复文件或缺少内容快照。');
      if (path !== SNAPSHOT && path !== MANIFEST && !expectedMedia.has(path) && !expectedDocuments.has(path)) throw new ContentError('备份包含未知文件。');
      const bytes = await take(size);
      if (size % 512 && !(await take(512 - size % 512)).every(value => value === 0)) throw new ContentError('备份填充数据损坏。');
      if (path === MANIFEST) { try { manifest = JSON.parse(decoder.decode(bytes)); } catch { throw new ContentError('备份清单无法解析。'); } continue; }
      hashes.set(path, { path, size, sha256: await sha256(bytes) });
      if (path === SNAPSHOT) {
        try { snapshot = validateSnapshot(JSON.parse(decoder.decode(bytes))); } catch (error) { throw new ContentError(`备份内容无效：${error.message}`); }
        await onSnapshot?.(snapshot);
        expectedMedia = new Map(snapshot.media.map((item, index) => [blobPath(item, index), item]));
        expectedDocuments = new Set(documentFiles(snapshot).map(file => file.path));
      } else if (expectedMedia.has(path)) {
        const item = expectedMedia.get(path);
        if (size !== item.size || hashes.get(path).sha256 !== item.checksum || inspectMediaBytes(bytes, item.name).mime !== item.mime) throw new ContentError(`图片校验失败：${item.name}`);
        if (retainMedia) files.set(item.objectKey, bytes);
        await onMedia?.(item, bytes);
      }
    }
    if (!ended || !snapshot || manifest?.format !== 'huaovo-backup' || manifest.formatVersion !== 1 || manifest.snapshot !== SNAPSHOT || !Array.isArray(manifest.files) || !Array.isArray(manifest.media)) throw new ContentError('不支持此备份格式，或备份缺少完整清单。');
    const expectedCount = expectedDocuments.size + expectedMedia.size;
    if (hashes.size !== expectedCount || manifest.files.length !== hashes.size || new Set(manifest.files.map(file => file.path)).size !== hashes.size) throw new ContentError('备份文件数量不匹配。');
    for (const file of manifest.files) if (JSON.stringify(hashes.get(file.path)) !== JSON.stringify({ path: file.path, size: file.size, sha256: file.sha256 })) throw new ContentError('备份 SHA-256 清单不匹配。');
    const mediaMap = snapshot.media.map((item, index) => ({ objectKey: item.objectKey, path: blobPath(item, index) }));
    if (JSON.stringify(manifest.media) !== JSON.stringify(mediaMap)) throw new ContentError('备份图片映射不匹配。');
    if (remaining.some(value => value !== 0)) throw new ContentError('备份包含尾随数据。');
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxTotalBytes || value.some(byte => byte !== 0)) throw new ContentError('备份包含额外或超限数据。'); }
    return { snapshot, files, summary: { posts: snapshot.posts.length, media: snapshot.media.length, history: snapshot.history.length, settings: Boolean(snapshot.settings), pendingSettings: Boolean(snapshot.settings?.draft), exportedAt: snapshot.exportedAt, verifiedFiles: hashes.size } };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Restore to an empty database using isolated object keys; failed validation cannot overwrite a live blob. */
export async function restoreBackup({ store, blobs }, stream, options = {}) {
  const before = await store.exportSnapshot();
  if (before.settings || before.posts.length || before.media.length || before.history.length) throw new ContentError('只能向空数据库恢复。', 409, 'nonempty');
  const prefix = `imports/${crypto.randomUUID()}/`, written = [], keys = new Map();
  try {
    const checked = await readBackup(stream, { ...options, retainMedia: false, onSnapshot: snapshot => {
      const inspection = store.inspectSnapshot(snapshot);
      if (!inspection.withinLimit) throw new ContentError('备份超过当前数据库的单次原子恢复限制，请迁往 Node 进行恢复或使用分阶段迁移。', 413, 'import_limit');
    }, onMedia: async (media, bytes) => {
      const key = `${prefix}${keys.size}-${media.name}`; keys.set(media.name, key); written.push(key);
      await blobs.put(key, bytes, { contentType: media.mime });
    } });
    const mapped = structuredClone(checked.snapshot);
    for (const media of mapped.media) media.objectKey = keys.get(media.name);
    for (const version of mapped.history) if (version.kind === 'media') version.snapshot.objectKey = keys.get(version.snapshot.name);
    const result = await store.importSnapshot(mapped, { onlyIfEmpty: true });
    return { ...result, summary: checked.summary };
  } catch (error) {
    for (const key of written) await blobs.delete(key).catch(() => {});
    throw error;
  }
}
