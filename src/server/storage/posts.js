import { ContentError, validatePost, validateSlug } from '../../admin/content-model.js';
import { activePost, conflict, withoutRevision } from './common.js';

export function postVersion(aggregate, status, { metadata = false } = {}) {
  if (!activePost(aggregate, status)) return null;
  const post = { ...aggregate[status], slug: aggregate.slug, status, revision: aggregate.revision, hasPublishedVersion: Boolean(activePost(aggregate, 'published')) };
  if (metadata) { delete post.body; post.bodyLoaded = false; }
  return post;
}
export function createPostMethods(persistence) {
  const { read, database, write, next } = persistence;
  return {
    async getPublishedPosts() {
      const rows = await database.all("SELECT json_remove(payload_json, '$.published.body', '$.draft.body') AS payload_json FROM content_documents WHERE kind = 'post' ORDER BY json_extract(payload_json, '$.published.data.pubDate') DESC, id");
      return rows.map(row => postVersion(JSON.parse(row.payload_json), 'published', { metadata: true })).filter(Boolean);
    },
    async getPost(slug, status = 'published') {
      validateSlug(slug); if (!['draft', 'published'].includes(status)) throw new ContentError('文章版本无效。');
      return postVersion(await read('post', slug), status);
    },
    async savePost(input, { publish = false, actor } = {}) {
      const clean = validatePost(input, { publish });
      const previous = await read('post', clean.slug);
      if (previous ? !clean.revision || clean.revision !== previous.revision : clean.revision) throw conflict();
      const status = publish ? 'published' : 'draft';
      const value = next(previous, { ...(previous ?? { slug: clean.slug, published: null, draft: null, publishedDeletedAt: null, draftDeletedAt: null }), [status]: withoutRevision(clean), [`${status}DeletedAt`]: null, ...(publish ? { draft: null, draftDeletedAt: null } : {}) });
      await write('post', clean.slug, value, previous, { actor });
      return { post: postVersion(value, status) };
    },
  };
}
