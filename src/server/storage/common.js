import { ContentError } from '../../admin/content-model.js';
import { bodyStatements, loadPostBodies, metadataOnly } from './post-bodies.js';
import { aggregateReferences, appendReferenceStatements, mediaCondition } from './references.js';
export { referenceNames, aggregateReferences, missingMedia } from './references.js';

export const conflict = () => new ContentError('内容已更新或已存在，请刷新后重试。', 409, 'conflict');
export const missing = () => new ContentError('内容不存在。', 404, 'not_found');
export const clone = value => structuredClone(value);
// Leave room for keys, revision, timestamps, actor and SQLite record overhead.
export const ROW_OVERHEAD_BYTES = 4096;
export const storedRowBytes = payload => new TextEncoder().encode(payload).byteLength + ROW_OVERHEAD_BYTES;
function checkRows(database, payloads) {
  if (!Number.isFinite(database.maxRowBytes)) return;
  if (payloads.some(payload => storedRowBytes(payload) > database.maxRowBytes)) throw new ContentError('内容或历史版本超过数据库单行大小限制，请缩减配置，或使用 Node / SQLite 存储。', 413, 'row_limit');
}
export const withoutRevision = ({ revision: _revision, branch: _branch, ...value }) => value;
export const activePost = (aggregate, status) => aggregate?.[status] && !aggregate[`${status}DeletedAt`];
export function validateKind(kind) { if (!['post', 'settings', 'media'].includes(kind)) throw new ContentError('历史记录类型无效。'); return kind; }
export function revision(value) { if (typeof value !== 'string' || !value || value.length > 200) throw conflict(); return value; }

export function createPersistence(database, { now: clock = () => new Date(), uuid = () => crypto.randomUUID() } = {}) {
  const now = () => new Date(clock()).toISOString();
  const read = async (kind, id) => {
    const [row] = await database.all('SELECT payload_json FROM content_documents WHERE kind = ? AND id = ?', [kind, id]);
    if (!row) return null;
    const value = JSON.parse(row.payload_json);
    return kind === 'post' ? (await loadPostBodies(database, [value]))[0] : value;
  };
  const list = async kind => {
    const values = (await database.all('SELECT payload_json FROM content_documents WHERE kind = ? ORDER BY id', [kind])).map(row => JSON.parse(row.payload_json));
    return kind === 'post' ? loadPostBodies(database, values) : values;
  };
  async function write(kind, id, value, previous, { actor = null, guard = '', guardParams = [] } = {}) {
    const refs = aggregateReferences(kind, value), media = mediaCondition(database, refs);
    const json = JSON.stringify(metadataOnly(kind, value)), safeActor = actor == null ? null : String(actor).slice(0, 200);
    const snapshots = [previous, value].filter(Boolean).map(snapshot => ({ snapshot, json: JSON.stringify(metadataOnly(kind, snapshot)) }));
    checkRows(database, [json, ...snapshots.map(item => item.json), ...(kind === 'post' ? ['published', 'draft'].filter(status => value[status]).map(status => value[status].body) : [])]);
    await media.check();
    const params = [value.revision, json, value.updatedAt, kind, id];
    const keyCondition = kind === 'media' ? "AND NOT EXISTS (SELECT 1 FROM content_documents AS other WHERE other.kind = 'media' AND other.id <> ? AND json_extract(other.payload_json, '$.objectKey') = ?)" : '';
    const condition = `${guard} ${media.sql} ${keyCondition}`, conditionParams = [...guardParams, ...media.params, ...(kind === 'media' ? [id, value.objectKey] : [])];
    const statements = previous ? [{ sql: `UPDATE content_documents SET revision = ?, payload_json = ?, updated_at = ? WHERE kind = ? AND id = ? AND revision = ? ${condition}`, params: [...params, previous.revision, ...conditionParams] }] : [{ sql: `INSERT INTO content_documents (revision, payload_json, updated_at, kind, id) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM content_documents WHERE kind = ? AND id = ?) ${condition}`, params: [...params, kind, id, ...conditionParams] }];
    const success = 'EXISTS (SELECT 1 FROM content_documents WHERE kind = ? AND id = ? AND revision = ?)';
    const successParams = [kind, id, value.revision];
    if (kind === 'post') statements.push(...bodyStatements(value, success, successParams));
    for (const entry of snapshots) statements.push({ sql: `INSERT OR IGNORE INTO content_history (kind, id, revision, snapshot_json, actor, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${success}`, params: [kind, id, entry.snapshot.revision, entry.json, safeActor, entry.snapshot.updatedAt, ...successParams] });
    if (kind !== 'media') appendReferenceStatements(statements, kind, id, value, refs, success, successParams, { uuid, actor: safeActor });
    const results = await database.batch(statements);
    if (results[0].changes !== 1) { await media.check(); throw conflict(); }
    return clone(value);
  }
  const next = (_previous, value) => ({ ...value, revision: uuid(), updatedAt: now() });
  return { database, read, list, write, next, now, uuid };
}
