export function metadataOnly(kind, value) {
  if (kind !== 'post' || !value) return value;
  return { ...value, ...Object.fromEntries(['published', 'draft'].map(status => [status, value[status] ? Object.fromEntries(Object.entries(value[status]).filter(([key]) => key !== 'body')) : null])) };
}

export async function loadPostBodies(database, values) {
  if (!values.length) return values;
  const identities = JSON.stringify(values.map(value => ({ id: value.slug, revision: value.revision })));
  const rows = await database.all("SELECT id, revision, status, body FROM content_post_bodies WHERE EXISTS (SELECT 1 FROM json_each(?) WHERE json_extract(value, '$.id') = content_post_bodies.id AND json_extract(value, '$.revision') = content_post_bodies.revision)", [identities]);
  return attachPostBodies(values, rows);
}

export function attachPostBodies(values, rows) {
  const bodies = new Map(rows.map(row => [`${row.id}:${row.revision}:${row.status}`, row.body]));
  return values.map(value => ({ ...value, ...Object.fromEntries(['published', 'draft'].map(status => [status, value[status] ? { ...value[status], body: bodies.get(`${value.slug}:${value.revision}:${status}`) ?? '' } : null])) }));
}

export function bodyStatements(value, guard, params) {
  return ['published', 'draft'].filter(status => value[status]).map(status => ({ sql: `INSERT OR IGNORE INTO content_post_bodies (id, revision, status, body) SELECT ?, ?, ?, ? WHERE ${guard}`, params: [value.slug, value.revision, status, value[status].body, ...params] }));
}
