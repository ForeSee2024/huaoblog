import { ContentError } from '../../admin/content-model.js';

function plainText(source) {
  return source.replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_#>~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function createSearchMethods({ database }) {
  return {
    async searchPublishedPosts(query, { limit = 20 } = {}) {
      if (typeof query !== 'string' || query.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new ContentError('搜索内容或结果数量无效。');
      if (!query.trim()) return [];
      const text = query.trim();
      const rows = await database.all(`SELECT post.id, json_extract(post.payload_json, '$.published.data.title') AS title, substr(body.body, 1, 1500) AS excerpt FROM content_documents AS post JOIN content_post_bodies AS body ON body.id = post.id AND body.revision = post.revision AND body.status = 'published' WHERE post.kind = 'post' AND json_extract(post.payload_json, '$.published') IS NOT NULL AND json_extract(post.payload_json, '$.publishedDeletedAt') IS NULL AND (instr(lower(json_extract(post.payload_json, '$.published.data')), lower(?)) > 0 OR instr(lower(body.body), lower(?)) > 0) ORDER BY json_extract(post.payload_json, '$.published.data.pubDate') DESC, post.id LIMIT ?`, [text, text, limit]);
      return rows.map(row => ({ url: `/posts/${row.id}/`, title: row.title, excerpt: plainText(row.excerpt) }));
    },
  };
}
