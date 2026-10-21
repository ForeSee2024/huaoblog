import { ContentError, MAX_IMAGE_BYTES, validateMediaName } from '../../admin/content-model.js';
import { mediaSelection } from '../../admin/bulk-model.js';
import { clone, conflict, missing } from './common.js';
import { validateObjectKey } from './keys.js';

export function validateMediaRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContentError('图片信息格式不正确。');
  const name = validateMediaName(input.name);
  const path = `public/images/posts/${name}`, publicUrl = `/images/posts/${name}`;
  if (input.path != null && input.path !== path || input.publicUrl != null && input.publicUrl !== publicUrl) throw new ContentError('图片存储路径不安全。');
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_IMAGE_BYTES) throw new ContentError('图片大小必须在 1 字节至 10 MB 之间。', 413);
  const extension = name.split('.').at(-1).toLowerCase().replace('jpg', 'jpeg');
  const mime = input.mime ?? input.contentType;
  if (mime !== `image/${extension}` || input.contentType != null && input.contentType !== mime) throw new ContentError('图片格式与文件名不符。');
  if (typeof input.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(input.checksum)) throw new ContentError('图片 SHA-256 校验值无效。');
  if (input.public != null && typeof input.public !== 'boolean') throw new ContentError('图片公开状态无效。');
  return { name, objectKey: validateObjectKey(input.objectKey), path, publicUrl, size: input.size, mime, contentType: mime, checksum: input.checksum.toLowerCase(), public: input.public ?? false };
}

export const mediaView = value => value ? { ...clone(value), url: value.publicUrl, previewPending: false } : null;
export const referenced = () => new ContentError('图片仍被文章或站点设置引用，请先移除引用。', 409, 'referenced_media');
export async function mediaHasReferences(database, name) {
  return (await database.all('SELECT name FROM content_media_refs WHERE name = ? LIMIT 1', [name])).length > 0;
}

export function createMediaMethods(persistence) {
  const { read, write, next, now, database } = persistence;
  return {
    async addMedia(record) {
      const clean = validateMediaRecord(record);
      if (await read('media', clean.name)) throw conflict();
      const value = next(null, { ...clean, deletedAt: null, createdAt: now() });
      await write('media', clean.name, value, null);
      return { media: mediaView(value) };
    },
    async getMedia(name, { includeDeleted = false } = {}) {
      validateMediaName(name);
      const value = await read('media', name);
      return value && (includeDeleted || !value.deletedAt) ? mediaView(value) : null;
    },
    async deleteMedia(input, { actor } = {}) {
      const items = mediaSelection(input), deleted = [], failed = [];
      for (const item of items) {
        try {
          const previous = await read('media', item.name);
          if (!previous || previous.deletedAt) throw missing();
          if (!item.revision || item.revision !== previous.revision) throw conflict();
          if (await mediaHasReferences(database, item.name)) throw referenced();
          const value = next(previous, { ...previous, deletedAt: now() });
          try { await write('media', item.name, value, previous, { actor, guard: 'AND NOT EXISTS (SELECT 1 FROM content_media_refs WHERE name = ?)', guardParams: [item.name] }); }
          catch (error) { if (error.code === 'conflict' && await mediaHasReferences(database, item.name)) throw referenced(); throw error; }
          deleted.push(mediaView(value));
        } catch (error) { failed.push({ ...item, error: error.message, code: error.code ?? 'storage_error', statusCode: error.status ?? 500 }); }
      }
      return { deleted, failed };
    },
    async restoreMedia(item, { actor } = {}) {
      validateMediaName(item?.name);
      const previous = await read('media', item.name);
      if (!previous) throw missing();
      if (!previous.deletedAt || item.revision !== previous.revision) throw conflict();
      const value = next(previous, { ...previous, ...validateMediaRecord(previous), deletedAt: null });
      await write('media', item.name, value, previous, { actor });
      return { media: mediaView(value) };
    },
  };
}
