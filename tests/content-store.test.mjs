import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const sqlite = await import('../src/server/storage/sqlite.js').catch(() => ({}));
const d1 = await import('../src/server/storage/d1.js').catch(() => ({}));
const content = await import('../src/server/storage/content-store.js').catch(() => ({}));
const canonical = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const post = (slug = 'test-post') => ({ slug, data: { title: '测试文章', description: '摘要', pubDate: '2026-10-13', category: '软件工程与系统', tags: ['Rust'], featured: false }, body: '## 正文\n\n内容。' });
const media = (name = 'one.png') => ({ name, objectKey: `media/${name}`, path: `public/images/posts/${name}`, publicUrl: `/images/posts/${name}`, size: 68, mime: 'image/png', checksum: 'a'.repeat(64) });
async function setup(t) {
  assert.equal(typeof sqlite.createNodeDatabase, 'function', 'Node SQLite adapter is not implemented');
  assert.equal(typeof content.createContentStore, 'function', 'content store is not implemented');
  const db = sqlite.createNodeDatabase(':memory:');
  t.after(() => db.close());
  await db.exec(content.CONTENT_SCHEMA);
  let counter = 0;
  return { db, store: content.createContentStore(db, { uuid: () => `revision-${++counter}`, now: () => '2026-10-15T01:00:00.000Z' }) };
}

test('SQLite batches are atomic and return rows and changes through the common port', async t => {
  assert.equal(typeof sqlite.createNodeDatabase, 'function', 'Node SQLite adapter is not implemented');
  const db = sqlite.createNodeDatabase(':memory:'); t.after(() => db.close());
  await db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL);');
  assert.deepEqual(await db.batch([{ sql: 'INSERT INTO sample VALUES (?, ?)', params: ['one', 'first'] }]), [{ changes: 1 }]);
  await assert.rejects(db.batch([{ sql: 'INSERT INTO sample VALUES (?, ?)', params: ['two', 'second'] }, { sql: 'INSERT INTO sample VALUES (?, ?)', params: ['one', 'duplicate'] }]));
  assert.deepEqual(await db.all('SELECT * FROM sample ORDER BY id'), [{ id: 'one', value: 'first' }]);
});

test('D1 binds prepared statements and reports unsuccessful batches', async () => {
  assert.equal(typeof d1.createD1Database, 'function', 'D1 adapter is not implemented');
  const calls = [];
  const binding = { prepare(sql) { return { bind(...params) { return { sql, params, async all() { return { success: true, results: [{ value: params[0] }] }; } }; } }; }, async batch(statements) { calls.push(statements); return statements.map(() => ({ success: true, meta: { changes: 1 } })); }, async exec(sql) { calls.push(sql); return { count: 1 }; } };
  const db = d1.createD1Database(binding);
  assert.deepEqual(await db.all('SELECT ? AS value', ['yes']), [{ value: 'yes' }]);
  assert.deepEqual(await db.batch([{ sql: 'INSERT INTO test VALUES (?)', params: ['one'] }]), [{ changes: 1 }]);
  assert.equal(calls[0][0].sql, 'INSERT INTO test VALUES (?)');
  assert.deepEqual(calls[0][0].params, ['one']);
  binding.batch = async () => [{ success: false, error: 'write failed' }];
  await assert.rejects(db.batch([{ sql: 'bad' }]), /write failed/);
});

test('drafts stay private and publishing withdraws draft without losing published edits', async t => {
  const { store } = await setup(t);
  const saved = (await store.savePost(post(), { publish: false })).post;
  assert.deepEqual(await store.getPublishedPosts(), []);
  assert.equal((await store.getWorkspace()).posts[0].bodyLoaded, false);
  assert.equal((await store.getWorkspace()).posts[0].body, undefined);
  const published = (await store.savePost(saved, { publish: true })).post;
  assert.equal(published.status, 'published');
  assert.equal(await store.getPost(saved.slug, 'draft'), null);
  const edited = (await store.savePost({ ...published, body: 'A private change' }, { publish: false })).post;
  assert.equal((await store.getPost(saved.slug, 'published')).body, saved.body);
  assert.equal((await store.getPost(saved.slug, 'draft')).body, 'A private change');
  assert.equal((await store.getPost(saved.slug, 'published')).revision, edited.revision);
  assert.equal((await store.getPublishedPosts())[0].body, undefined);
});

test('new duplicate and stale writes conflict and do not add history', async t => {
  const { store } = await setup(t);
  const first = (await store.savePost(post(), { publish: false })).post;
  await assert.rejects(store.savePost(post(), { publish: false }), error => error.status === 409 && error.code === 'conflict');
  const second = (await store.savePost({ ...first, body: 'second' }, { publish: false })).post;
  const before = await store.getHistory('post', first.slug);
  await assert.rejects(store.savePost({ ...first, body: 'stale' }, { publish: true }), error => error.status === 409);
  assert.equal((await store.getPost(first.slug, 'draft')).revision, second.revision);
  assert.deepEqual(await store.getHistory('post', first.slug), before);
});

test('settings publish directly and referenced media becomes public only when content publishes', async t => {
  const { store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  assert.equal(image.public, false);
  const draft = (await store.savePost({ ...post(), body: '![图](/images/posts/%6fne.png)' }, { publish: false })).post;
  assert.equal((await store.getMedia(image.name)).public, false);
  const deletion = await store.deleteMedia([image]);
  assert.equal(deletion.deleted.length, 0);
  assert.equal(deletion.failed[0].code, 'referenced_media');
  await store.savePost(draft, { publish: true });
  assert.equal((await store.getMedia(image.name)).public, true);
  assert.equal(await store.getPublishedSettings(), null);
  const settings = (await store.saveSettings(canonical)).settings;
  assert.equal((await store.getPublishedSettings()).revision, settings.revision);
  assert.equal((await store.getWorkspace()).settings.revision, settings.revision);
  await assert.rejects(store.saveSettings(canonical), error => error.status === 409);
});

test('bulk deletion reports stale items, deletes both selected versions, and restores only with current revision', async t => {
  const { store } = await setup(t);
  const published = (await store.savePost(post(), { publish: true })).post;
  const draft = (await store.savePost({ ...published, body: 'private' }, { publish: false })).post;
  const other = (await store.savePost(post('other'), { publish: false })).post;
  const result = await store.deletePosts([{ ...draft, status: 'published' }, draft, { ...other, revision: 'old' }]);
  assert.equal(result.deleted.length, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, 'conflict');
  assert.equal(await store.getPost(draft.slug, 'published'), null);
  assert.equal(await store.getPost(draft.slug, 'draft'), null);
  const trash = await store.getTrash();
  assert.equal(trash.posts.length, 2);
  await assert.rejects(store.restorePost({ ...trash.posts[0], revision: draft.revision }), error => error.status === 409);
  const restored = (await store.restorePost(trash.posts.find(item => item.status === 'published'))).post;
  assert.equal(restored.body, published.body);
  assert.equal((await store.getTrash()).posts.length, 1);
});

test('media soft deletion retains metadata and history restoration rechecks article references', async t => {
  const { store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  const deleted = await store.deleteMedia([image]);
  assert.equal(deleted.deleted.length, 1);
  assert.equal(await store.getMedia(image.name), null);
  const tombstone = await store.getMedia(image.name, { includeDeleted: true });
  assert.ok(tombstone.deletedAt);
  await assert.rejects(store.restoreMedia(image), error => error.status === 409);
  const restored = (await store.restoreMedia(tombstone)).media;
  assert.equal(restored.deletedAt, null);
  await store.savePost({ ...post(), body: '![图](/images/posts/one.png)' }, { publish: true });
  const deletedRevision = (await store.getHistory('media', image.name)).find(item => item.snapshot.deletedAt);
  await assert.rejects(store.restoreRevision('media', image.name, deletedRevision.revision, (await store.getMedia(image.name)).revision), error => error.code === 'referenced_media');
  assert.ok(await store.getMedia(image.name));
});

test('historical article restoration uses expected aggregate revision and writes a fresh history entry', async t => {
  const { store } = await setup(t);
  const first = (await store.savePost(post(), { publish: true, actor: 'admin' })).post;
  const second = (await store.savePost({ ...first, body: 'new public text' }, { publish: true })).post;
  await assert.rejects(store.restoreRevision('post', first.slug, first.revision, first.revision), error => error.status === 409);
  const result = await store.restoreRevision('post', first.slug, first.revision, second.revision);
  assert.notEqual(result.revision, first.revision);
  assert.equal((await store.getPost(first.slug, 'published')).body, first.body);
  const history = await store.getHistory('post', first.slug);
  assert.equal(history.length, 3);
  assert.equal(history.find(item => item.revision === first.revision).actor, 'admin');
});

test('a rejected CAS cannot record history, alter references, or publish media', async t => {
  const { db, store } = await setup(t);
  const first = (await store.savePost(post(), { publish: false })).post;
  const image = (await store.addMedia(media())).media;
  let beforeBatch;
  const racingDatabase = { ...db, async batch(statements) { if (beforeBatch) { const action = beforeBatch; beforeBatch = null; await action(); } return db.batch(statements); } };
  const racing = content.createContentStore(racingDatabase, { uuid: () => 'race-revision', now: () => '2026-10-15T02:00:00.000Z' });
  beforeBatch = () => store.savePost({ ...first, body: 'winning write' }, { publish: false });
  await assert.rejects(racing.savePost({ ...first, body: '![图](/images/posts/one.png)' }, { publish: true }), error => error.status === 409);
  assert.equal((await store.getMedia(image.name)).public, false);
  assert.equal((await store.getHistory('post', first.slug)).some(item => item.revision === 'race-revision'), false);
  assert.equal((await store.deleteMedia([image])).deleted.length, 1);
});

test('restoring historical posts rejects managed images that were deleted later', async t => {
  const { store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  const original = (await store.savePost({ ...post(), body: '![图](/images/posts/one.png)' }, { publish: true })).post;
  const current = (await store.savePost({ ...original, body: 'image removed' }, { publish: true })).post;
  assert.equal((await store.deleteMedia([await store.getMedia(image.name)])).deleted.length, 1);
  await assert.rejects(store.restoreRevision('post', original.slug, original.revision, current.revision), error => error.status === 409 && error.code === 'missing_media');
  assert.equal((await store.getPost(original.slug, 'published')).body, 'image removed');
});

test('portable snapshots preserve pending settings, versions, trash and history without publishing drafts', async t => {
  const { store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  const publicSettings = (await store.saveSettings(canonical)).settings;
  const published = (await store.savePost(post(), { publish: true })).post;
  await store.savePost({ ...published, body: 'private text' }, { publish: false });
  await store.deleteMedia([image]);
  const snapshot = await store.exportSnapshot();
  assert.equal(snapshot.format, 'huaovo-content');
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.settings.published.identity.name, canonical.identity.name);
  assert.equal(snapshot.posts[0].draft.body, 'private text');
  snapshot.settings.draft = { ...snapshot.settings.published, identity: { ...snapshot.settings.published.identity, name: 'Pending title' } };
  snapshot.history.find(item => item.kind === 'settings' && item.revision === snapshot.settings.revision).snapshot = structuredClone(snapshot.settings);
  const second = await setup(t);
  await second.store.importSnapshot(snapshot, { onlyIfEmpty: true });
  assert.equal((await second.store.getPublishedSettings()).identity.name, publicSettings.identity.name);
  assert.equal((await second.store.getWorkspace()).settings.identity.name, 'Pending title');
  assert.equal((await second.store.getWorkspace()).settings.pendingPublication, true);
  assert.equal((await second.store.getPost(published.slug, 'published')).body, published.body);
  assert.equal((await second.store.getTrash()).media.length, 1);
  assert.deepEqual(await second.store.exportSnapshot(), snapshot);
  const pending = (await second.store.getWorkspace()).settings;
  await second.store.saveSettings(pending);
  assert.equal((await second.store.getPublishedSettings()).identity.name, 'Pending title');
  assert.equal((await second.store.getWorkspace()).settings.pendingPublication, undefined);
});

test('snapshot validation rejects versions, traversal, duplicated records and partial invalid imports', async t => {
  const { store } = await setup(t);
  await store.saveSettings(canonical);
  await store.addMedia(media());
  const good = await store.exportSnapshot();
  for (const mutate of [
    value => { value.formatVersion = 2; },
    value => { value.media[0].objectKey = '../outside.png'; },
    value => { value.media.push(structuredClone(value.media[0])); },
    value => { value.media[0].publicUrl = '/other.png'; },
    value => { value.settings.published.home.postsPerPage = 100; },
    value => { value.history[0].revision = 'mismatched'; },
  ]) {
    const broken = structuredClone(good); mutate(broken);
    const empty = await setup(t);
    await assert.rejects(empty.store.importSnapshot(broken, { onlyIfEmpty: true }));
    assert.equal((await empty.store.getWorkspace()).settings, null);
    assert.equal((await empty.store.getWorkspace()).media.length, 0);
    await empty.store.importSnapshot(good, { onlyIfEmpty: true });
    await assert.rejects(empty.store.importSnapshot(good, { onlyIfEmpty: true }), error => error.status === 409);
  }
});

test('snapshot import atomically refuses a concurrent first content write', async t => {
  const source = await setup(t);
  await source.store.saveSettings(canonical);
  const snapshot = await source.store.exportSnapshot();
  const { db, store } = await setup(t);
  let race = true;
  const database = { ...db, async batch(statements) { if (race) { race = false; await store.savePost(post('winner'), { publish: false }); } return db.batch(statements); } };
  const importing = content.createContentStore(database, { uuid: () => 'import-race', now: () => '2026-10-15T01:00:00.000Z' });
  await assert.rejects(importing.importSnapshot(snapshot, { onlyIfEmpty: true }), error => error.status === 409);
  assert.equal(await store.getPublishedSettings(), null);
  assert.equal((await store.getWorkspace()).posts[0].slug, 'winner');
});

test('public search queries text in SQL, escapes LIKE wildcards and excludes draft or deleted content', async t => {
  const { store } = await setup(t);
  await store.savePost({ ...post('public'), body: '![图](https://example.com/a.png) **Rust 100%_match** <b>正文</b>' }, { publish: true });
  await store.savePost({ ...post('private'), body: 'secret Rust text' }, { publish: false });
  const deleted = (await store.savePost({ ...post('deleted'), body: 'Rust text' }, { publish: true })).post;
  await store.deletePosts([deleted]);
  const results = await store.searchPublishedPosts('Rust');
  assert.equal(results.length, 1);
  assert.equal(results[0].url, '/posts/public/');
  assert.equal(results[0].title, '测试文章');
  assert.ok(results[0].excerpt.includes('正文'));
  assert.equal(results[0].excerpt.includes('<b>'), false);
  assert.equal((await store.searchPublishedPosts('%_match')).length, 1);
  assert.deepEqual(await store.searchPublishedPosts('%_missing'), []);
  assert.deepEqual(await store.searchPublishedPosts('secret'), []);
  assert.deepEqual(await store.searchPublishedPosts('   '), []);
  await assert.rejects(store.searchPublishedPosts('Rust', { limit: 21 }));
});

test('SQLite batches report changes for statements with RETURNING', async t => {
  const { db } = await setup(t);
  await db.exec('CREATE TABLE returning_test (value TEXT)');
  assert.deepEqual(await db.batch([{ sql: 'INSERT INTO returning_test VALUES (?) RETURNING value', params: ['one'] }]), [{ changes: 1, results: [{ value: 'one' }] }]);
});

test('publishing media records a new revision and its public state in history', async t => {
  const { store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  await store.savePost({ ...post(), body: '![图](/images/posts/one.png)' }, { publish: true });
  const current = await store.getMedia(image.name);
  assert.notEqual(current.revision, image.revision);
  assert.equal((await store.getHistory('media', image.name)).find(item => item.revision === current.revision).snapshot.public, true);
});

test('a concurrent media deletion prevents a content save and leaves no partial history', async t => {
  const { db, store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  let race = true;
  const database = { ...db, async batch(statements) { if (race) { race = false; await store.deleteMedia([image]); } return db.batch(statements); } };
  const saving = content.createContentStore(database);
  await assert.rejects(saving.savePost({ ...post(), body: '![图](/images/posts/one.png)' }, { publish: true }), error => error.code === 'missing_media');
  assert.equal(await store.getPost('test-post', 'published'), null);
  assert.deepEqual(await store.getHistory('post', 'test-post'), []);
});

test('actual D1 binding supports portable lifecycle, migration SQL and large paired versions', { skip: !process.env.HUAOVO_TEST_BINDINGS, timeout: 60000 }, async t => {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', compatibilityDate: '2026-10-15', d1Databases: ['DB', 'RESTORE', 'BULK'] }));
  t.after(() => mf.dispose());
  const database = d1.createD1Database(await mf.getD1Database('DB'));
  const restoring = d1.createD1Database(await mf.getD1Database('RESTORE'));
  await database.exec(content.CONTENT_SCHEMA);
  await restoring.exec(content.CONTENT_SCHEMA);
  const store = content.createContentStore(database), target = content.createContentStore(restoring);
  const image = (await store.addMedia(media())).media;
  const first = (await store.savePost({ ...post(), body: '![图](/images/posts/one.png)' }, { publish: true })).post;
  await store.savePost({ ...first, body: 'private change' }, { publish: false });
  assert.equal((await store.getPost(first.slug, 'published')).body, first.body);
  assert.equal((await store.deleteMedia([await store.getMedia(image.name)])).failed[0].code, 'referenced_media');
  const before = await store.getHistory('post', first.slug);
  await assert.rejects(store.savePost(first, { publish: true }), error => error.status === 409);
  assert.deepEqual(await store.getHistory('post', first.slug), before);
  const snapshot = await store.exportSnapshot();
  await target.importSnapshot(snapshot, { onlyIfEmpty: true });
  const copied = await target.exportSnapshot();
  assert.deepEqual({ ...copied, exportedAt: snapshot.exportedAt }, snapshot);
  assert.equal((await store.searchPublishedPosts('正文')).length, 0);
  assert.equal((await store.searchPublishedPosts('测试文章')).length, 1);
  const bulkDatabase = d1.createD1Database(await mf.getD1Database('BULK'));
  await bulkDatabase.exec(content.CONTENT_SCHEMA);
  const bulk = content.createContentStore(bulkDatabase);
  const seed = { ...snapshot, settings: null, media: [], posts: [{ ...snapshot.posts[0], published: { ...snapshot.posts[0].published, body: 'bulk content' }, draft: null }], history: [] };
  const expanded = expandedSnapshot(seed);
  assert.ok(bulk.inspectSnapshot(expanded).statements < 10);
  await bulk.importSnapshot(expanded);
  assert.equal((await bulk.getPublishedPosts()).length, 120);
  const large = (await store.savePost({ ...post('large-post'), body: 'x'.repeat(1024 * 1024) }, { publish: true })).post;
  await store.savePost({ ...large, body: 'y'.repeat(1024 * 1024) }, { publish: false });
  assert.equal((await store.getPost(large.slug, 'published')).body.length, 1024 * 1024);
  assert.equal((await store.getPost(large.slug, 'draft')).body.length, 1024 * 1024);
  assert.equal((await store.getPublishedPosts()).every(item => item.body === undefined), true);
  await database.exec('CREATE TABLE rollback_test (value TEXT PRIMARY KEY)');
  await assert.rejects(database.batch([{ sql: "INSERT INTO rollback_test VALUES ('same')" }, { sql: "INSERT INTO rollback_test VALUES ('same')" }]));
  assert.deepEqual(await database.all('SELECT * FROM rollback_test'), []);
});

test('paired maximum-size article versions keep every persisted row within D1 limits', async t => {
  const { store, db } = await setup(t);
  const published = (await store.savePost({ ...post(), body: 'x'.repeat(1024 * 1024) }, { publish: true })).post;
  await store.savePost({ ...published, body: 'y'.repeat(1024 * 1024) }, { publish: false });
  const rows = await db.all('SELECT length(CAST(payload_json AS BLOB)) AS bytes FROM content_documents UNION ALL SELECT length(CAST(snapshot_json AS BLOB)) AS bytes FROM content_history UNION ALL SELECT length(CAST(body AS BLOB)) AS bytes FROM content_post_bodies');
  assert.ok(rows.every(row => row.bytes < 2000000), 'a persisted row exceeds the documented 2,000,000-byte D1 limit');
  assert.equal((await store.getPost(post().slug, 'published')).body, published.body);
  assert.equal((await store.getPost(post().slug, 'draft')).body.length, 1024 * 1024);
  const snapshot = await store.exportSnapshot();
  const target = await setup(t);
  await target.store.importSnapshot(snapshot);
  assert.equal((await target.store.getPost(post().slug, 'draft')).body, 'y'.repeat(1024 * 1024));
});

function expandedSnapshot(base, count = 120) {
  const source = base.posts[0];
  const posts = Array.from({ length: count }, (_, index) => { const slug = `restored-${index}`; return { ...structuredClone(source), slug, revision: `expanded-${index}`, published: { ...structuredClone(source.published), slug, body: `${slug} ${'portable article '.repeat(200)}` } }; });
  return { ...structuredClone(base), posts, history: posts.map(value => ({ kind: 'post', id: value.slug, revision: value.revision, snapshot: structuredClone(value), actor: null, createdAt: value.updatedAt })) };
}

test('a backup with 120 articles imports atomically with a bounded number of SQL statements', async t => {
  const source = await setup(t); await source.store.savePost(post(), { publish: true });
  const snapshot = expandedSnapshot(await source.store.exportSnapshot());
  const { db } = await setup(t), calls = [];
  const database = { ...db, async batch(statements) { calls.push(statements); return db.batch(statements); } };
  const target = content.createContentStore(database);
  await target.importSnapshot(snapshot);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].length < 10, `import required ${calls[0].length} SQL statements`);
  assert.equal((await target.getPublishedPosts()).length, 120);
  assert.equal((await target.getPost('restored-119', 'published')).body, snapshot.posts[119].published.body);
});

test('snapshot preflight reports atomic import limits and refuses oversized imports before writes', async t => {
  const source = await setup(t); await source.store.savePost(post(), { publish: true });
  const snapshot = await source.store.exportSnapshot();
  const { db } = await setup(t), calls = [];
  const database = { ...db, maxBatchStatements: 2, async batch(statements) { calls.push(statements); return db.batch(statements); } };
  const target = content.createContentStore(database);
  const inspection = target.inspectSnapshot(snapshot);
  assert.equal(inspection.withinLimit, false);
  assert.ok(inspection.statements > 2);
  await assert.rejects(target.importSnapshot(snapshot), error => error.status === 413 && error.code === 'import_limit');
  assert.equal(calls.length, 0);
  assert.equal((await target.getWorkspace()).posts.length, 0);
});

test('snapshots reject conflicting historical data for the same entity revision', async t => {
  const source = await setup(t); await source.store.savePost(post(), { publish: true });
  const snapshot = await source.store.exportSnapshot();
  snapshot.history[0].snapshot.published.body = 'conflicting content for the same revision';
  const target = await setup(t);
  await assert.rejects(target.store.importSnapshot(snapshot), /版本|冲突|不一致/);
  assert.equal((await target.store.getWorkspace()).posts.length, 0);
});

test('media revision recovery cannot make a referenced public image private', async t => {
  const { store } = await setup(t);
  const image = (await store.addMedia(media())).media;
  await store.savePost({ ...post(), body: '![图](/images/posts/one.png)' }, { publish: true });
  const current = await store.getMedia(image.name);
  assert.equal((await store.restoreRevision('media', image.name, image.revision, current.revision)).media.public, true);
  assert.equal((await store.getMedia(image.name)).public, true);
});

test('bulk deletion preserves confirmed results when reading another item fails', async t => {
  const { db, store } = await setup(t);
  const first = (await store.savePost(post('first'), { publish: false })).post;
  const second = (await store.savePost(post('second'), { publish: false })).post;
  const failing = content.createContentStore({ ...db, async all(sql, params) { if (sql.includes('SELECT payload_json') && params?.[1] === 'second') throw new Error('database unavailable'); return db.all(sql, params); } });
  const result = await failing.deletePosts([first, second]);
  assert.equal(result.deleted[0].slug, 'first');
  assert.equal(result.failed[0].slug, 'second');
  assert.equal(result.failed[0].code, 'storage_error');
  assert.equal(await store.getPost('first', 'draft'), null);
  assert.ok(await store.getPost('second', 'draft'));
});

test('different media records cannot share one blob object key', async t => {
  const { store } = await setup(t);
  await store.addMedia(media());
  await assert.rejects(store.addMedia({ ...media('two.png'), objectKey: media().objectKey }), error => error.code === 'conflict');
  assert.equal((await store.getWorkspace()).media.length, 1);
});

test('snapshot media history must refer to the retained blob identity', async t => {
  const source = await setup(t); await source.store.addMedia(media());
  const snapshot = await source.store.exportSnapshot();
  snapshot.history[0].revision = 'older-media';
  snapshot.history[0].snapshot.revision = 'older-media';
  snapshot.history[0].snapshot.objectKey = 'media/not-in-backup.png';
  const target = await setup(t);
  await assert.rejects(target.store.importSnapshot(snapshot), /图片|对象|一致/);
  assert.equal((await target.store.getWorkspace()).media.length, 0);
});
