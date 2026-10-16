import { validateObjectKey } from './keys.js';
import { blobBytes, blobContentType } from './blob-values.js';

export function createR2BlobStore(bucket) {
  return {
    async put(key, bytes, { contentType } = {}) {
      validateObjectKey(key);
      await bucket.put(key, blobBytes(bytes), { httpMetadata: { contentType: blobContentType(contentType) } });
    },
    async get(key) {
      validateObjectKey(key);
      const object = await bucket.get(key);
      return object ? { body: object.body, size: object.size, ...(object.etag ? { etag: object.etag } : {}), contentType: object.httpMetadata?.contentType ?? 'application/octet-stream' } : null;
    },
    async delete(key) { validateObjectKey(key); await bucket.delete(key); },
  };
}
