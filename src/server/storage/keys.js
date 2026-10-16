import { ContentError } from '../../admin/content-model.js';

export function validateObjectKey(key) {
  if (typeof key !== 'string' || !key || key.length > 1024 || key.startsWith('/') || key.includes('\\') || /[\u0000-\u0020\u007f%?#:]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ContentError('对象存储路径不安全。');
  }
  return key;
}
