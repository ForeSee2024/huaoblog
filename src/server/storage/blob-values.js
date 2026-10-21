import { ContentError } from '../../admin/content-model.js';

export function blobBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new ContentError('对象内容必须为字节数据。');
}

export function blobContentType(value = 'application/octet-stream') {
  if (typeof value !== 'string' || !value || value.length > 200 || /[^\x20-\x7e]/.test(value)) throw new ContentError('对象内容类型无效。');
  return value;
}
