import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';
import { createD1Database } from '../src/server/storage/d1.js';
import { CONTENT_SCHEMA, createContentStore, validateSnapshot } from '../src/server/storage/content-store.js';
import { createContentHandler } from '../src/server/api.js';
import { createAuth } from '../src/server/auth.js';
import { validateSettings } from '../src/admin/settings-model.js';

const instant = '2026-10-15T01:00:00.000Z';
const options = { now: () => instant };
const defaults = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const sessions = await readFile(new URL('../migrations/002_sessions.sql', import.meta.url), 'utf8');
const article = (slug = 'review-post', body = '原始公开正文') => ({ slug, data: { title: '独立存储审阅', description: '审阅摘要', pubDate: '2026-10-15', category: '软件工程与系统', tags: [] }, body });
const image = (name = 'review.png') => ({ name, objectKey: `media/${name}`, size: 68, mime: 'image/png', checksum: 'a'.repeat(64) });
async function setup(t) {
  const db = createNodeDatabase(':memory:');
  t.after(() => db.close());
  await db.exec(CONTENT_SCHEMA);
  return { db, store: createContentStore(db, options) };
}
const withoutExportTime = ({ exportedAt, ...snapshot }) => snapshot;

test('review: a late SQL failure rolls back bodies, history, refs and media promotion together', async t => {
  const { db, store } = await setup(t);
  await store.addMedia(image());
  const original = (await store.savePost(article(), { publish: false })).post;
  const before = await store.exportSnapshot();
  await db.exec("CREATE TRIGGER fail_media_publication BEFORE UPDATE ON content_documents WHEN NEW.kind = 'media' BEGIN SELECT RAISE(ABORT, 'review forced failure'); END;");
  await assert.rejects(store.savePost({ ...original, body: '![图](/images/posts/review.png)' }, { publish: true }), /review forced failure/);
  assert.deepEqual(withoutExportTime(await store.exportSnapshot()), withoutExportTime(before));
  assert.equal(await store.getPost(original.slug, 'published'), null);
  assert.equal((await store.getMedia('review.png')).public, false);
  assert.deepEqual(await db.all('SELECT * FROM content_media_refs'), []);
});

test('review: media deletion loses to a concurrent public reference even when its revision does not change', async t => {
  const { db, store } = await setup(t);
  await store.addMedia(image());
  const first = (await store.savePost(article('initial-reference', '![图](/images/posts/review.png)'), { publish: true })).post;
  await store.savePost({ ...first, body: '已移除引用' }, { publish: true });
  const selected = await store.getMedia('review.png');
  const beforeHistory = await store.getHistory('media', selected.name);
  let race = true;
  const deleting = createContentStore({ ...db, async batch(statements) {
    if (race) { race = false; await store.savePost(article('concurrent-reference', '![图](/images/posts/review.png)'), { publish: true }); }
    return db.batch(statements);
  } }, options);
  const result = await deleting.deleteMedia([selected]);
  assert.equal(result.deleted.length, 0);
  assert.equal(result.failed[0].code, 'referenced_media');
  const kept = await store.getMedia(selected.name);
  assert.equal(kept.revision, selected.revision, 'the reference guard, independently of media CAS, must protect an already public image');
  assert.equal(kept.deletedAt, null);
  assert.equal(kept.public, true);
  assert.deepEqual(await store.getHistory('media', selected.name), beforeHistory);
  assert.equal((await store.getPost('concurrent-reference', 'published')).body, '![图](/images/posts/review.png)');
});

test('review: restoring a deleted article loses to a concurrent image deletion without partial recovery', async t => {
  const { db, store } = await setup(t);
  await store.addMedia(image());
  const published = (await store.savePost(article('recover-race', '![图](/images/posts/review.png)'), { publish: true })).post;
  await store.deletePosts([published]);
  const selected = (await store.getTrash()).posts[0];
  const before = await store.getHistory('post', selected.slug);
  let race = true;
  const restoring = createContentStore({ ...db, async batch(statements) {
    if (race) { race = false; await store.deleteMedia([await store.getMedia('review.png')]); }
    return db.batch(statements);
  } }, options);
  await assert.rejects(restoring.restorePost(selected), error => error.code === 'missing_media');
  assert.equal(await store.getPost(selected.slug, 'published'), null);
  assert.deepEqual(await store.getHistory('post', selected.slug), before);
  assert.deepEqual(await db.all('SELECT * FROM content_media_refs'), []);
});

test('review: mixed revisions for one slug delete only the selected current version', async t => {
  const { store } = await setup(t);
  const original = (await store.savePost(article(), { publish: true })).post;
  const latest = (await store.savePost({ ...original, body: '保留的最新草稿' })).post;
  const published = await store.getPost(latest.slug, 'published');
  const result = await store.deletePosts([published, { ...latest, revision: original.revision }]);
  assert.deepEqual(result.deleted.map(value => value.status), ['published']);
  assert.deepEqual(result.failed.map(value => [value.status, value.code]), [['draft', 'conflict']]);
  assert.equal((await store.getPost(latest.slug, 'draft')).body, '保留的最新草稿');
  assert.equal(await store.getPost(latest.slug, 'published'), null);
  const trash = await store.getTrash();
  assert.equal(trash.posts.length, 1);
  assert.equal(trash.posts[0].body, original.body);
});

test('review: imported pending settings protect private media without making it public', async t => {
  const source = await setup(t);
  await source.store.addMedia(image());
  await source.store.saveSettings(defaults);
  const snapshot = await source.store.exportSnapshot();
  snapshot.settings.draft = { ...structuredClone(snapshot.settings.published), identity: { ...snapshot.settings.published.identity, brand: '尚未发布', avatar: '/images/posts/review.png' } };
  snapshot.history.find(value => value.kind === 'settings' && value.revision === snapshot.settings.revision).snapshot = structuredClone(snapshot.settings);
  const target = await setup(t);
  await target.store.importSnapshot(snapshot);
  assert.equal((await target.store.getPublishedSettings()).identity.brand, defaults.identity.brand);
  const pending = (await target.store.getWorkspace()).settings;
  assert.equal(pending.identity.brand, '尚未发布');
  assert.equal(pending.pendingPublication, true);
  const media = await target.store.getMedia('review.png');
  assert.equal(media.public, false);
  assert.equal((await target.store.deleteMedia([media])).failed[0].code, 'referenced_media');
  await target.store.saveSettings(pending);
  assert.equal((await target.store.getPublishedSettings()).identity.brand, '尚未发布');
  assert.equal((await target.store.getMedia('review.png')).public, true);
});

test('review: escaped near-limit bodies survive history, trash, restoration and chunked import', async t => {
  const { db, store } = await setup(t);
  const escaped = '"\\\n'.repeat(300000);
  const original = (await store.savePost(article(), { publish: true })).post;
  const paired = (await store.savePost({ ...original, body: escaped })).post;
  const published = (await store.savePost(paired, { publish: true })).post;
  const updated = (await store.savePost({ ...published, body: '新的草稿' })).post;
  const versions = (await store.getWorkspace()).posts.filter(value => value.slug === updated.slug);
  assert.equal((await store.deletePosts(versions)).deleted.length, 2);
  const tombstone = (await store.getTrash()).posts.find(value => value.status === 'published');
  assert.equal(tombstone.body, escaped);
  const restored = (await store.restorePost(tombstone)).post;
  await store.restoreRevision('post', restored.slug, paired.revision, restored.revision);
  assert.equal((await store.getPost(restored.slug, 'published')).body, original.body);
  assert.equal((await store.getPost(restored.slug, 'draft')).body, escaped);
  const snapshot = await store.exportSnapshot();
  assert.equal(snapshot.history.find(value => value.revision === paired.revision).snapshot.draft.body, escaped);
  const target = await setup(t);
  const plan = target.store.inspectSnapshot(snapshot);
  assert.ok(plan.maxParameterBytes <= 1_500_000, 'worst-case JSON escaping must use a direct bounded body parameter');
  await target.store.importSnapshot(snapshot);
  assert.deepEqual(withoutExportTime(await target.store.exportSnapshot()), withoutExportTime(snapshot));
  assert.equal((await target.store.getPost(restored.slug, 'draft')).body, escaped);
  const rows = await db.all('SELECT length(CAST(payload_json AS BLOB)) AS bytes FROM content_documents UNION ALL SELECT length(CAST(snapshot_json AS BLOB)) FROM content_history UNION ALL SELECT length(CAST(body AS BLOB)) FROM content_post_bodies');
  assert.ok(rows.every(row => row.bytes < 2_000_000));
});

test('review: 120 paired posts import in one guarded batch with bounded JSON parameters', async t => {
  const source = await setup(t);
  const published = (await source.store.savePost(article(), { publish: true })).post;
  await source.store.savePost({ ...published, body: '草稿' });
  const base = await source.store.exportSnapshot();
  const posts = Array.from({ length: 120 }, (_, index) => {
    const slug = `review-import-${index}`, value = structuredClone(base.posts[0]);
    return { ...value, slug, revision: `review-revision-${index}`, published: { ...value.published, slug, body: `公开-${index}-` + 'x'.repeat(10000) }, draft: { ...value.draft, slug, body: `草稿-${index}-` + 'y'.repeat(10000) } };
  });
  const snapshot = { ...base, posts, history: posts.map(value => ({ kind: 'post', id: value.slug, revision: value.revision, snapshot: structuredClone(value), actor: 'review', createdAt: value.updatedAt })) };
  const { db } = await setup(t), batches = [];
  const store = createContentStore({ ...db, maxBatchStatements: 40, async batch(statements) { batches.push(statements); return db.batch(statements); } }, options);
  const inspection = store.inspectSnapshot(snapshot);
  assert.equal(inspection.withinLimit, true);
  assert.ok(inspection.statements <= 40);
  assert.ok(inspection.maxParameterBytes <= 1_500_000);
  await store.importSnapshot(snapshot);
  assert.equal(batches.length, 1);
  assert.equal((await store.getPublishedPosts()).length, 120);
  assert.equal((await store.getPost('review-import-119', 'draft')).body, posts[119].draft.body);
  assert.equal((await store.getHistory('post', 'review-import-119'))[0].snapshot.published.body, posts[119].published.body);
  assert.deepEqual(await db.all('SELECT token FROM content_import_guards'), []);
});

test('review: a competing import after the empty check cannot leave mixed documents or bodies', async t => {
  const first = await setup(t), second = await setup(t), target = await setup(t);
  await first.store.savePost(article('import-loser', '不能导入的正文'), { publish: true });
  await second.store.savePost(article('import-winner', '并发赢家正文'), { publish: true });
  const losing = await first.store.exportSnapshot(), winner = await second.store.exportSnapshot();
  let race = true;
  const importing = createContentStore({ ...target.db, async batch(statements) {
    if (race) { race = false; await target.store.importSnapshot(winner); }
    return target.db.batch(statements);
  } }, options);
  await assert.rejects(importing.importSnapshot(losing), error => error.code === 'conflict');
  assert.deepEqual(withoutExportTime(await target.store.exportSnapshot()), withoutExportTime(winner));
  assert.deepEqual(await target.db.all('SELECT token FROM content_import_guards'), []);
});

test('review: D1 refuses a 41-statement batch before preparing any SQL', async () => {
  let prepared = 0;
  const db = createD1Database({ prepare() { prepared++; throw new Error('must not prepare'); }, async batch() { throw new Error('must not dispatch'); } });
  await assert.rejects(db.batch(Array.from({ length: 41 }, () => ({ sql: 'SELECT 1', params: [] }))), error => error.code === 'batch_limit' && error.status === 413);
  assert.equal(prepared, 0);
});

test('review: row preflight respects the explicit D1 cap while Node remains unrestricted', async t => {
  const snapshot = oversizedSettingsSnapshot(), { db, store } = await setup(t);
  assert.equal(store.inspectSnapshot(snapshot).withinLimit, true);
  assert.equal(store.inspectSnapshot(snapshot, { maxBatchStatements: 40, maxRowBytes: 2_000_000 }).withinLimit, false, 'a Node-backed preflight can explicitly inspect D1 portability without limiting Node storage');
  let batches = 0;
  const capped = createContentStore({ ...db, maxBatchStatements: 40, maxRowBytes: 2_000_000, async batch(statements) { batches++; return db.batch(statements); } }, options);
  const inspection = capped.inspectSnapshot(snapshot);
  assert.equal(inspection.withinLimit, false);
  assert.equal(inspection.withinRowLimit, false);
  assert.equal(inspection.maxRowBytes, 2_000_000);
  assert.ok(inspection.largestRowBytes > 2_000_000);
  await assert.rejects(capped.importSnapshot(snapshot), error => error.status === 413 && error.code === 'import_limit');
  assert.equal(batches, 0);
  assert.deepEqual(await db.all('SELECT kind FROM content_documents'), []);
});

test('review: a capped ordinary write rejects an oversized history payload before SQL mutation', async t => {
  const snapshot = oversizedSettingsSnapshot(), { db, store } = await setup(t);
  await store.importSnapshot(snapshot);
  const before = await store.exportSnapshot();
  let batches = 0;
  const capped = createContentStore({ ...db, maxRowBytes: 2_000_000, async batch(statements) { batches++; return db.batch(statements); } }, options);
  await assert.rejects(capped.saveSettings({ ...defaults, revision: snapshot.settings.revision }), error => error.status === 413 && error.code === 'row_limit');
  assert.equal(batches, 0);
  assert.deepEqual(withoutExportTime(await store.exportSnapshot()), withoutExportTime(before));
});

test('review: D1 rejects an oversized scalar before preparing its batch', async () => {
  let prepared = 0;
  const db = createD1Database({ prepare() { prepared++; throw new Error('must not prepare'); }, async batch() { throw new Error('must not dispatch'); } });
  assert.equal(db.maxRowBytes, 2_000_000);
  await assert.rejects(db.batch([{ sql: 'SELECT ?', params: ['x'.repeat(2_000_001)] }]), error => error.status === 413 && error.code === 'row_limit');
  assert.equal(prepared, 0);
});

async function requestBudget(t, underlying, mode) {
  await underlying.exec(CONTENT_SCHEMA);
  await underlying.exec(sessions);
  const seed = createContentStore(underlying, options);
  await seed.saveSettings(defaults);
  await seed.addMedia(image());
  const selected = [];
  for (let index = 0; index < 3; index++) {
    const published = (await seed.savePost(article(`budget-${index}`, '![公开图](/images/posts/review.png)'), { publish: true })).post;
    selected.push((await seed.savePost({ ...published, body: '![草稿图](/images/posts/review.png)' })).post);
  }
  let queries = 0, races = 0, racingEnabled = false;
  const measured = { ...underlying, async all(sql, params) { queries++; return underlying.all(sql, params); }, async batch(statements) {
    queries += statements.length;
    if (mode === 'conflict' && racingEnabled) {
      const current = await seed.getPost(`budget-${races++}`, 'draft');
      await seed.savePost({ ...current, body: '并发更新，不能误删' });
    }
    return underlying.batch(statements);
  } };
  const config = { deployment: 'cloudflare', siteUrl: 'https://review.invalid', githubUserId: '160737293' };
  const auth = createAuth(measured, config, { fetch: async () => Response.json({ id: 160737293, login: 'storage-review' }) });
  const session = await auth.login('review_github_token_abcdefghijklmnopqrstuvwxyz', new Request(config.siteUrl));
  queries = 0;
  racingEnabled = true;
  const store = createContentStore(measured, options);
  const handler = createContentHandler({ store, database: measured, blobs: {}, config }, { auth });
  const response = await handler(new Request(`${config.siteUrl}/api/v1/posts/delete`, { method: 'POST', headers: { Origin: config.siteUrl, Cookie: session.cookie.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify({ posts: selected }) }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.deleted.length, mode === 'conflict' ? 0 : 3);
  assert.equal(result.failed.length, mode === 'conflict' ? 3 : 0);
  assert.ok(queries <= 50, `one API request used ${queries} D1 SQL statements`);
  t.diagnostic(`${mode} path: ${queries} SQL statements including auth, paired bodies, refs, history and response state`);
}

test('review: full three-post API deletion and CAS-conflict paths stay within 50 SQL queries', async t => {
  for (const mode of ['success', 'conflict']) {
    const { db } = await setup(t);
    await requestBudget(t, db, mode);
  }
});

test('review: the same worst-case request budgets hold against an actual D1 binding', { skip: !process.env.HUAOVO_TEST_BINDINGS, timeout: 60000 }, async t => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', compatibilityDate: '2026-10-15', d1Databases: ['SUCCESS', 'CONFLICT'] }));
  t.after(() => mf.dispose());
  await requestBudget(t, createD1Database(await mf.getD1Database('SUCCESS')), 'success');
  await requestBudget(t, createD1Database(await mf.getD1Database('CONFLICT')), 'conflict');
});

function oversizedSettingsSnapshot() {
  const settings = structuredClone(defaults), url = 'https://example.com/' + '路'.repeat(2020);
  settings.friends = Array.from({ length: 100 }, () => ({ name: '名'.repeat(100), description: '简'.repeat(300), url, avatar: url }));
  settings.about.body = '文'.repeat(30000);
  const published = validateSettings(settings);
  return validateSnapshot({ format: 'huaovo-content', formatVersion: 1, exportedAt: instant, settings: { published, draft: structuredClone(published), revision: 'large-settings', updatedAt: instant }, posts: [], media: [], history: [] });
}

test('review: D1 preflight rejects a valid settings pair exceeding the per-row storage limit', { skip: !process.env.HUAOVO_TEST_BINDINGS, timeout: 60000 }, async t => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', compatibilityDate: '2026-10-15', d1Databases: ['LARGE'] }));
  t.after(() => mf.dispose());
  const db = createD1Database(await mf.getD1Database('LARGE'));
  await db.exec(CONTENT_SCHEMA);
  const store = createContentStore(db, options), snapshot = oversizedSettingsSnapshot(), inspection = store.inspectSnapshot(snapshot);
  if (inspection.withinLimit) {
    let outcome = 'unexpectedly imported';
    try { await store.importSnapshot(snapshot); } catch (error) { outcome = String(error.message).slice(0, 400); }
    assert.fail(`D1 preflight accepted ${inspection.maxParameterBytes} bytes in one settings row; actual result: ${outcome}`);
  }
  await assert.rejects(store.importSnapshot(snapshot), error => error.status === 413);
  assert.deepEqual(await db.all('SELECT kind FROM content_documents'), []);
});

test('review: D1 search never emits a LIKE pattern beyond the documented 50-byte limit', { skip: !process.env.HUAOVO_TEST_BINDINGS, timeout: 60000 }, async t => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', compatibilityDate: '2026-10-15', d1Databases: ['SEARCH'] }));
  t.after(() => mf.dispose());
  const raw = createD1Database(await mf.getD1Database('SEARCH'));
  await raw.exec(CONTENT_SCHEMA);
  const sqlCalls = [], database = { ...raw, async all(sql, params) { sqlCalls.push({ sql, params }); return raw.all(sql, params); } };
  const store = createContentStore(database, options), query = '中文检索'.repeat(5);
  await store.savePost(article('long-chinese-query', query), { publish: true });
  sqlCalls.length = 0;
  assert.equal((await store.searchPublishedPosts(query)).length, 1);
  await store.savePost(article('literal-query', 'CaseSensitive 100%_literal \\Path'), { publish: true });
  assert.equal((await store.searchPublishedPosts('100%_literal'))[0].url, '/posts/literal-query/');
  assert.deepEqual(await store.searchPublishedPosts('100XXliteral'), []);
  assert.equal((await store.searchPublishedPosts('casesensitive'))[0].url, '/posts/literal-query/');
  const patterns = sqlCalls.filter(call => /\bLIKE\b/i.test(call.sql)).flatMap(call => call.params.filter(value => typeof value === 'string'));
  const sizes = patterns.map(value => new TextEncoder().encode(value).length);
  assert.ok(sizes.every(value => value <= 50), `search emitted LIKE pattern bytes ${sizes.join(',')}; local D1 accepts them but the documented production limit is 50`);
});
