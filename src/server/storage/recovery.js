import { ContentError, validatePost, validateSlug } from '../../admin/content-model.js';
import { postSelection } from '../../admin/bulk-model.js';
import { validateSettings } from '../../admin/settings-model.js';
import { activePost, clone, conflict, missing, validateKind, withoutRevision } from './common.js';
import { mediaHasReferences, mediaView, referenced, validateMediaRecord } from './media.js';
import { postVersion } from './posts.js';
import { settingsVersion } from './settings.js';
import { loadPostBodies } from './post-bodies.js';

export function validateAggregate(kind, value, id) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('历史快照格式不正确。');
  if (kind === 'media') return { ...value, ...validateMediaRecord(value) };
  if (kind === 'settings') {
    if (id !== 'site' || !value.published && !value.draft) throw new ContentError('站点设置快照无效。');
    return { ...value, published: value.published ? withoutRevision(validateSettings(value.published)) : null, draft: value.draft ? withoutRevision(validateSettings(value.draft)) : null };
  }
  validateSlug(id);
  if (value.slug !== id || !value.published && !value.draft) throw new ContentError('文章快照无效。');
  return { ...value, ...Object.fromEntries(['published', 'draft'].map(status => [status, value[status] ? withoutRevision(validatePost({ ...value[status], slug: id }, { publish: status === 'published' })) : null])) };
}

export function createRecoveryMethods(persistence) {
  const { read, list, database, next, now, write } = persistence;
  return {
    async deletePosts(input, { actor } = {}) {
      const items = postSelection(input), deleted = [], failed = [];
      const groups = new Map();
      for (const item of items) { if (!groups.has(item.slug)) groups.set(item.slug, []); groups.get(item.slug).push(item); }
      for (const [slug, selected] of groups) {
        const accepted = [];
        try {
          const previous = await read('post', slug);
          for (const item of selected) {
            const error = !activePost(previous, item.status) ? missing() : !item.revision || item.revision !== previous.revision ? conflict() : null;
            if (error) failed.push({ ...item, error: error.message, code: error.code, statusCode: error.status });
            else accepted.push(item);
          }
          if (!accepted.length) continue;
          const value = next(previous, { ...previous, ...Object.fromEntries(accepted.map(item => [`${item.status}DeletedAt`, now()])) });
          await write('post', slug, value, previous, { actor });
          deleted.push(...accepted.map(item => ({ ...previous[item.status], slug, status: item.status, revision: value.revision, deletedAt: value[`${item.status}DeletedAt`] })));
        } catch (error) { failed.push(...(accepted.length ? accepted : selected).map(item => ({ ...item, error: error.message, code: error.code ?? 'storage_error', statusCode: error.status ?? 500 }))); }
      }
      return { deleted, failed };
    },
    async getTrash() {
      const [posts, media] = await Promise.all([list('post'), list('media')]);
      return { posts: posts.flatMap(value => ['published', 'draft'].filter(status => value[status] && value[`${status}DeletedAt`]).map(status => ({ ...value[status], slug: value.slug, status, revision: value.revision, deletedAt: value[`${status}DeletedAt`] }))), media: media.filter(value => value.deletedAt).map(mediaView) };
    },
    async restorePost(item, { actor } = {}) {
      validateSlug(item?.slug);
      if (!['draft', 'published'].includes(item.status)) throw new ContentError('文章版本无效。');
      const previous = await read('post', item.slug);
      if (!previous?.[item.status]) throw missing();
      if (!previous[`${item.status}DeletedAt`] || item.revision !== previous.revision) throw conflict();
      const clean = validateAggregate('post', previous, item.slug);
      const value = next(previous, { ...clean, [`${item.status}DeletedAt`]: null });
      await write('post', item.slug, value, previous, { actor });
      return { post: postVersion(value, item.status) };
    },
    async getHistory(kind, id) {
      validateKind(kind);
      const history = (await database.all('SELECT kind, id, revision, snapshot_json, actor, created_at FROM content_history WHERE kind = ? AND id = ? ORDER BY created_at DESC, rowid DESC', [kind, id])).map(row => ({ kind: row.kind, id: row.id, revision: row.revision, snapshot: JSON.parse(row.snapshot_json), actor: row.actor, createdAt: row.created_at }));
      if (kind === 'post') { const values = await loadPostBodies(database, history.map(item => item.snapshot)); values.forEach((value, index) => { history[index].snapshot = value; }); }
      return history;
    },
    async restoreRevision(kind, id, revision, expectedRevision, { actor } = {}) {
      validateKind(kind);
      const previous = await read(kind, id);
      if (!previous) throw missing();
      if (!expectedRevision || previous.revision !== expectedRevision) throw conflict();
      const [history] = await database.all('SELECT snapshot_json FROM content_history WHERE kind = ? AND id = ? AND revision = ?', [kind, id, revision]);
      if (!history) throw missing();
      const snapshot = JSON.parse(history.snapshot_json);
      const clean = validateAggregate(kind, kind === 'post' ? (await loadPostBodies(database, [snapshot]))[0] : snapshot, id);
      if (kind === 'media') {
        clean.public = previous.public || clean.public || (await database.all("SELECT name FROM content_media_refs WHERE name = ? AND status = 'published' LIMIT 1", [id])).length > 0;
        if (clean.deletedAt && await mediaHasReferences(database, id)) throw referenced();
      }
      const value = next(previous, clean);
      await write(kind, id, value, previous, { actor, ...(kind === 'media' && clean.deletedAt ? { guard: 'AND NOT EXISTS (SELECT 1 FROM content_media_refs WHERE name = ?)', guardParams: [id] } : {}) });
      return { kind, id, revision: value.revision, record: clone(value), ...(kind === 'post' ? { post: postVersion(value, activePost(value, 'draft') ? 'draft' : 'published') } : kind === 'settings' ? { settings: settingsVersion(value, { workspace: true }) } : { media: mediaView(value) }) };
    },
  };
}
