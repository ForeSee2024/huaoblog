import { ContentError } from './content-model.js';

/** A list entry must never become an editable document before its body is read. */
export async function loadEditorPost(repository, posts, slug, status) {
  const selected = posts.find(post => post.slug === slug && post.status === status) || posts.find(post => post.slug === slug);
  if (!selected) return null;
  let post = selected;
  if (selected.bodyLoaded === false || typeof selected.body !== 'string') {
    if (!repository.getPost) throw new ContentError('完整正文尚未读取，请刷新后重试。');
    post = (await repository.getPost(selected.slug, selected.status)).post;
  }
  if (!post || post.slug !== selected.slug || post.status !== selected.status || post.bodyLoaded === false || typeof post.body !== 'string') throw new ContentError('完整正文读取未完成，请刷新后重试。');
  return structuredClone({ ...post, hasPublishedVersion: posts.some(item => item.slug === slug && item.status === 'published') });
}
