import { aggregateReferences } from './references.js';
import { metadataOnly } from './post-bodies.js';
import { storedRowBytes } from './common.js';

const MAX_PARAMETER_BYTES = 1_500_000;
const byteLength = value => new TextEncoder().encode(value).length;

function chunks(rows) {
  const result = [], large = [];
  let values = [], size = 2;
  for (const row of rows) {
    const json = JSON.stringify(row), bytes = byteLength(json);
    if (bytes + 2 > MAX_PARAMETER_BYTES) { large.push(row); continue; }
    if (size + bytes + 1 > MAX_PARAMETER_BYTES && values.length) { result.push(`[${values.join(',')}]`); values = []; size = 2; }
    values.push(json); size += bytes + 1;
  }
  if (values.length) result.push(`[${values.join(',')}]`);
  return { result, large };
}

export function planSnapshotImport(snapshot, token) {
  const guard = 'EXISTS (SELECT 1 FROM content_import_guards WHERE token = ?)';
  const statements = [{ sql: 'INSERT INTO content_import_guards (token) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM content_documents) AND NOT EXISTS (SELECT 1 FROM content_history) AND NOT EXISTS (SELECT 1 FROM content_media_refs) AND NOT EXISTS (SELECT 1 FROM content_post_bodies)', params: [token] }];
  const documents = [...snapshot.posts.map(value => ['post', value.slug, value]), ...snapshot.media.map(value => ['media', value.name, value]), ...(snapshot.settings ? [['settings', 'site', snapshot.settings]] : [])];
  const bodyMap = new Map(), references = [];
  function addBodies(value) {
    for (const status of ['published', 'draft']) if (value[status]) bodyMap.set(`${value.slug}:${value.revision}:${status}`, { id: value.slug, revision: value.revision, status, body: value[status].body });
  }
  const metadata = documents.map(([kind, id, value]) => {
    if (kind === 'post') addBodies(value);
    references.push(...aggregateReferences(kind, value).map(ref => ({ kind, id, ...ref })));
    return { kind, id, revision: value.revision, payload_json: JSON.stringify(metadataOnly(kind, value)), updated_at: value.updatedAt };
  });
  const history = snapshot.history.map(item => {
    if (item.kind === 'post') addBodies(item.snapshot);
    return { kind: item.kind, id: item.id, revision: item.revision, snapshot_json: JSON.stringify(metadataOnly(item.kind, item.snapshot)), actor: item.actor, created_at: item.createdAt };
  });
  const tables = [
    ['content_documents', ['kind', 'id', 'revision', 'payload_json', 'updated_at'], metadata],
    ['content_history', ['kind', 'id', 'revision', 'snapshot_json', 'actor', 'created_at'], history],
    ['content_media_refs', ['kind', 'id', 'status', 'name'], references],
    ['content_post_bodies', ['id', 'revision', 'status', 'body'], [...bodyMap.values()]],
  ];
  for (const [table, columns, rows] of tables) {
    const { result, large } = chunks(rows);
    for (const json of result) statements.push({ sql: `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.map(column => `json_extract(value, '$.${column}')`).join(', ')} FROM json_each(?) WHERE ${guard}`, params: [json, token] });
    // Worst-case JSON escaping can double a 1 MiB body; bind that body directly.
    for (const row of large) statements.push({ sql: `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.map(() => '?').join(', ')} WHERE ${guard}`, params: [...columns.map(column => row[column]), token] });
  }
  statements.push({ sql: 'DELETE FROM content_import_guards WHERE token = ?', params: [token] });
  return statements;
}

export function inspectImportPlan(snapshot, statements, maxStatements = Infinity, maxRowBytes = Infinity) {
  let maxParameterBytes = 0, largestRowBytes = 0;
  for (const statement of statements) for (const value of statement.params) if (typeof value === 'string') maxParameterBytes = Math.max(maxParameterBytes, byteLength(value));
  function measure(kind, value) {
    largestRowBytes = Math.max(largestRowBytes, storedRowBytes(JSON.stringify(metadataOnly(kind, value))));
    if (kind === 'post') for (const status of ['published', 'draft']) if (value[status]) largestRowBytes = Math.max(largestRowBytes, storedRowBytes(value[status].body));
  }
  for (const value of snapshot.posts) measure('post', value);
  for (const value of snapshot.media) measure('media', value);
  if (snapshot.settings) measure('settings', snapshot.settings);
  for (const item of snapshot.history) measure(item.kind, item.snapshot);
  const withinStatementLimit = statements.length <= maxStatements, withinRowLimit = largestRowBytes <= maxRowBytes;
  return { counts: { posts: snapshot.posts.length, media: snapshot.media.length, settings: snapshot.settings ? 1 : 0, history: snapshot.history.length }, statements: statements.length, maxStatements: Number.isFinite(maxStatements) ? maxStatements : null, maxParameterBytes, largestRowBytes, maxRowBytes: Number.isFinite(maxRowBytes) ? maxRowBytes : null, withinStatementLimit, withinRowLimit, withinLimit: withinStatementLimit && withinRowLimit };
}
