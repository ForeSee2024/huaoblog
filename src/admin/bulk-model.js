import { ContentError, validateMediaName, validateSlug } from './content-model.js';

export const postKey = post => `${post.status}:${post.slug}`;

function selection(items, normalize, key) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new ContentError('请选择 1—100 项内容进行批量操作。');
  const seen = new Set();
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ContentError('批量选择格式不正确。');
    const value = normalize(item), id = key(value);
    if (seen.has(id)) throw new ContentError('批量选择包含重复内容，请重新选择。');
    seen.add(id);
    return value;
  });
}

export function postSelection(items) {
  return selection(items, item => {
    const slug = validateSlug(item.slug);
    if (!['draft', 'published'].includes(item.status)) throw new ContentError('请选择需要删除的文章版本。');
    return { slug, status: item.status, revision: item.revision, title: String(item.data?.title || item.title || slug) };
  }, postKey);
}

export function mediaSelection(items) {
  return selection(items, item => {
    const name = validateMediaName(item.name), path = `public/images/posts/${name}`;
    if (item.path !== path) throw new ContentError('图片存储路径不安全。');
    return { name, path, revision: item.revision };
  }, item => item.path);
}
