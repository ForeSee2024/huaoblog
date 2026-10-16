import { ContentError } from '../../admin/content-model.js';
import { aggregateReferences, conflict, revision, validateKind } from './common.js';
import { validateAggregate } from './recovery.js';
import { attachPostBodies } from './post-bodies.js';
import { inspectImportPlan, planSnapshotImport } from './import-plan.js';

function timestamp(value, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ContentError('备份时间戳无效。');
  return value;
}
function array(value, label, limit = 100000) {
  if (!Array.isArray(value) || value.length > limit) throw new ContentError(`${label}格式或数量无效。`);
  return value;
}
function unique(values, key, label) {
  const found = new Set();
  for (const value of values) { const id = key(value); if (found.has(id)) throw new ContentError(`${label}包含重复内容。`); found.add(id); }
  return values;
}

function normalizeAggregate(kind, input, id) {
  const value = validateAggregate(kind, input, id);
  const base = { revision: revision(value.revision), updatedAt: timestamp(value.updatedAt) };
  if (kind === 'settings') return { ...base, published: value.published, draft: value.draft };
  if (kind === 'post') return { slug: id, ...base, published: value.published, draft: value.draft, publishedDeletedAt: timestamp(value.publishedDeletedAt, { nullable: true }), draftDeletedAt: timestamp(value.draftDeletedAt, { nullable: true }) };
  return { name: value.name, objectKey: value.objectKey, path: value.path, publicUrl: value.publicUrl, size: value.size, mime: value.mime, contentType: value.contentType, checksum: value.checksum, public: value.public, ...base, deletedAt: timestamp(value.deletedAt, { nullable: true }), createdAt: timestamp(value.createdAt) };
}

export function validateSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.format !== 'huaovo-content' || input.formatVersion !== 1) throw new ContentError('不支持的内容备份格式或版本。');
  const settings = input.settings == null ? null : normalizeAggregate('settings', input.settings, 'site');
  const posts = unique(array(input.posts, '文章').map(value => normalizeAggregate('post', value, value?.slug)), value => value.slug, '文章');
  const media = unique(array(input.media, '图片').map(value => normalizeAggregate('media', value, value?.name)), value => value.name, '图片');
  unique(media, value => value.objectKey, '图片对象键');
  const history = unique(array(input.history, '历史记录').map(item => {
    if (!item || typeof item !== 'object') throw new ContentError('历史记录格式无效。');
    const kind = validateKind(item.kind), id = item.id, snapshot = normalizeAggregate(kind, item.snapshot, id);
    if (kind === 'media' && snapshot.name !== id || item.revision !== snapshot.revision) throw new ContentError('历史记录版本或标识不一致。');
    if (item.actor != null && (typeof item.actor !== 'string' || item.actor.length > 200)) throw new ContentError('历史记录作者无效。');
    return { kind, id, revision: revision(item.revision), snapshot, actor: item.actor ?? null, createdAt: timestamp(item.createdAt) };
  }), item => `${item.kind}:${item.id}:${item.revision}`, '历史记录');
  const images = new Map(media.map(value => [value.name, value]));
  for (const [kind, aggregate] of [...posts.map(value => ['post', value]), ...(settings ? [['settings', settings]] : [])]) {
    for (const { name, status } of aggregateReferences(kind, aggregate)) {
      const image = images.get(name);
      if (!image || image.deletedAt || status === 'published' && !image.public) throw new ContentError('备份中的图片引用与公开状态不一致。');
    }
  }
  const documents = new Map([...posts.map(value => [`post:${value.slug}`, value]), ...media.map(value => [`media:${value.name}`, value]), ...(settings ? [['settings:site', settings]] : [])]);
  for (const item of history) {
    const current = documents.get(`${item.kind}:${item.id}`);
    if (!current) throw new ContentError('备份历史记录缺少对应内容。');
    if (item.kind === 'media' && ['objectKey', 'checksum', 'size', 'mime'].some(key => current[key] !== item.snapshot[key])) throw new ContentError('图片历史记录与保留的对象内容不一致。');
    if (current.revision === item.revision && JSON.stringify(current) !== JSON.stringify(item.snapshot)) throw new ContentError('相同版本的内容与历史快照不一致。');
  }
  return { format: 'huaovo-content', formatVersion: 1, exportedAt: timestamp(input.exportedAt), settings, posts, media, history };
}

export function createSnapshotMethods({ database, now, uuid }) {
  return {
    inspectSnapshot(input, { maxBatchStatements = database.maxBatchStatements, maxRowBytes = database.maxRowBytes } = {}) {
      const snapshot = validateSnapshot(input);
      return inspectImportPlan(snapshot, planSnapshotImport(snapshot, 'preflight'), maxBatchStatements, maxRowBytes);
    },
    async exportSnapshot() {
      // One SELECT gives all content/history a consistent database snapshot.
      const rows = await database.all("SELECT 'document' AS type, kind, id, revision, payload_json AS value, NULL AS actor, updated_at AS created_at FROM content_documents UNION ALL SELECT 'history' AS type, kind, id, revision, snapshot_json AS value, actor, created_at FROM content_history UNION ALL SELECT 'body' AS type, 'post' AS kind, id, revision, body AS value, status AS actor, NULL AS created_at FROM content_post_bodies ORDER BY type, kind, id, created_at, revision");
      const result = { format: 'huaovo-content', formatVersion: 1, exportedAt: now(), settings: null, posts: [], media: [], history: [] };
      const bodies = [];
      for (const row of rows) {
        if (row.type === 'body') { bodies.push({ id: row.id, revision: row.revision, status: row.actor, body: row.value }); continue; }
        const value = JSON.parse(row.value);
        if (row.type === 'history') result.history.push({ kind: row.kind, id: row.id, revision: row.revision, snapshot: value, actor: row.actor, createdAt: row.created_at });
        else if (row.kind === 'settings') result.settings = value;
        else result[row.kind === 'post' ? 'posts' : 'media'].push(value);
      }
      result.posts = attachPostBodies(result.posts, bodies);
      const postHistory = result.history.filter(item => item.kind === 'post');
      attachPostBodies(postHistory.map(item => item.snapshot), bodies).forEach((value, index) => { postHistory[index].snapshot = value; });
      return result;
    },
    async importSnapshot(input, { onlyIfEmpty = true } = {}) {
      if (onlyIfEmpty !== true) throw new ContentError('恢复仅支持空数据库，避免覆盖现有内容。', 409, 'conflict');
      const snapshot = validateSnapshot(input), token = uuid();
      const statements = planSnapshotImport(snapshot, token);
      if (!inspectImportPlan(snapshot, statements, database.maxBatchStatements, database.maxRowBytes).withinLimit) throw new ContentError('备份超出此部署的原子恢复或单行大小限制，请先恢复到 Node / SQLite，或使用分阶段离线迁移。', 413, 'import_limit');
      const exists = await database.all("SELECT kind FROM content_documents UNION ALL SELECT kind FROM content_history UNION ALL SELECT 'body' AS kind FROM content_post_bodies LIMIT 1");
      if (exists.length) throw conflict();
      const results = await database.batch(statements);
      if (results[0].changes !== 1) throw conflict();
      return { imported: { posts: snapshot.posts.length, media: snapshot.media.length, settings: snapshot.settings ? 1 : 0, history: snapshot.history.length } };
    },
  };
}
