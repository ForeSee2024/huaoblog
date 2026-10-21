import { ContentError, findMediaReferences, normalizePercentEncoding, validateMediaName } from '../../admin/content-model.js';

export function referenceNames(value) {
  const source = normalizePercentEncoding(JSON.stringify(value ?? {})), names = new Set();
  for (const match of source.matchAll(/\/images\/posts\/([a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp|gif|avif))/gi)) {
    try { validateMediaName(match[1]); if (findMediaReferences(`/images/posts/${match[1]}`, [value], {}).length) names.add(match[1]); } catch { /* Not a managed image name. */ }
  }
  return [...names];
}

export function aggregateReferences(kind, value) {
  if (kind === 'media') return [];
  return ['published', 'draft'].flatMap(status => {
    if (!value[status] || (kind === 'post' && value[`${status}DeletedAt`])) return [];
    return referenceNames(value[status]).map(name => ({ status, name }));
  });
}

export const missingMedia = () => new ContentError('引用的图片不存在或已在回收站，请先恢复图片。', 409, 'missing_media');
export function mediaCondition(database, refs) {
  const names = [...new Set(refs.map(ref => ref.name))], json = JSON.stringify(names);
  return {
    sql: names.length ? "AND (SELECT COUNT(*) FROM content_documents WHERE kind = 'media' AND id IN (SELECT value FROM json_each(?)) AND json_extract(payload_json, '$.deletedAt') IS NULL) = ?" : '',
    params: names.length ? [json, names.length] : [],
    async check() {
      if (!names.length) return;
      const rows = await database.all("SELECT id FROM content_documents WHERE kind = 'media' AND id IN (SELECT value FROM json_each(?)) AND json_extract(payload_json, '$.deletedAt') IS NULL", [json]);
      if (rows.length !== names.length) throw missingMedia();
    },
  };
}

export function appendReferenceStatements(statements, kind, id, value, refs, success, successParams, { uuid, actor = null }) {
  statements.push({ sql: `DELETE FROM content_media_refs WHERE kind = ? AND id = ? AND ${success}`, params: [kind, id, ...successParams] });
  if (refs.length) statements.push({ sql: `INSERT INTO content_media_refs (kind, id, status, name) SELECT ?, ?, json_extract(value, '$.status'), json_extract(value, '$.name') FROM json_each(?) WHERE ${success}`, params: [kind, id, JSON.stringify(refs), ...successParams] });
  const published = [...new Set(refs.filter(ref => ref.status === 'published').map(ref => ref.name))];
  if (!published.length) return;
  const promotions = JSON.stringify(published.map(name => ({ name, revision: uuid() })));
  const match = "media.id = json_extract(promotion.value, '$.name')";
  statements.push({ sql: `INSERT OR IGNORE INTO content_history (kind, id, revision, snapshot_json, actor, created_at) SELECT media.kind, media.id, media.revision, media.payload_json, ?, media.updated_at FROM content_documents AS media JOIN json_each(?) AS promotion ON ${match} WHERE media.kind = 'media' AND json_extract(media.payload_json, '$.public') = 0 AND ${success}`, params: [actor, promotions, ...successParams] });
  const promotedRevision = "(SELECT json_extract(value, '$.revision') FROM json_each(?) WHERE json_extract(value, '$.name') = content_documents.id)";
  statements.push({ sql: `UPDATE content_documents SET revision = ${promotedRevision}, payload_json = json_set(payload_json, '$.public', json('true'), '$.revision', ${promotedRevision}, '$.updatedAt', ?), updated_at = ? WHERE kind = 'media' AND id IN (SELECT json_extract(value, '$.name') FROM json_each(?)) AND json_extract(payload_json, '$.public') = 0 AND ${success}`, params: [promotions, promotions, value.updatedAt, value.updatedAt, promotions, ...successParams] });
  statements.push({ sql: `INSERT OR IGNORE INTO content_history (kind, id, revision, snapshot_json, actor, created_at) SELECT media.kind, media.id, media.revision, media.payload_json, ?, media.updated_at FROM content_documents AS media JOIN json_each(?) AS promotion ON ${match} AND media.revision = json_extract(promotion.value, '$.revision') WHERE media.kind = 'media' AND ${success}`, params: [actor, promotions, ...successParams] });
}
