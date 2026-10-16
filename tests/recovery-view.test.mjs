import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { editorView } from '../src/admin/editor-view.js';
import { settingsView } from '../src/admin/settings-view.js';
import { connectionView, overview, postsView } from '../src/admin/views.js';
const recovery = await import('../src/admin/recovery-view.js').catch(() => ({}));
const editorState = await import('../src/admin/editor-state.js').catch(() => ({}));
const settings = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const post = { slug: 'first', status: 'published', revision: 'p3', data: { title: '<旧标题>', tags: [], category: '软件工程与系统' }, body: '正文' };

test('direct editing keeps the current editor while offering publish and revision history', () => {
  const output = editorView(post, ['软件工程与系统'], false, value => value, { direct: true });
  assert.match(output, /发布文章/);
  assert.match(output, /保存草稿/);
  assert.match(output, /data-action="post-history"/);
  assert.doesNotMatch(output, /提交发布|检查并合并/);
  const legacy = editorView(post, ['软件工程与系统'], false);
  assert.match(legacy, /提交发布/);
});

test('direct settings explain immediate publication and expose existing configuration history', () => {
  const output = settingsView({ ...settings, revision: 's2' }, 'general', false, value => value, { direct: true });
  assert.match(output, /保存并发布/);
  assert.match(output, /前台立即更新/);
  assert.match(output, /data-action="settings-history"/);
  assert.doesNotMatch(output, /等待检查|构建/);
});

test('database connection and overview do not display a PR or deployment queue', () => {
  const data = { settings, posts: [], media: [], releases: [], connection: { mode: 'database', authenticated: true, writable: true } };
  const output = connectionView(data, { backend: 'api', direct: true, ready: true, apiUrl: '/api/v1', siteUrl: 'https://blog.example', authUrl: 'https://auth.example' });
  assert.match(output, /内容服务/);
  assert.match(output, /前台立即更新/);
  assert.match(output, /恢复与备份/);
  assert.doesNotMatch(output, /待发布变更|Pages|生产分支|构建命令/);
  assert.doesNotMatch(overview(data, false, { direct: true }), /静态博客|GitHub 分支|构建站点/);
  assert.doesNotMatch(postsView(data, { search: '', state: 'all' }), /待删除变更/);
});

test('trash keeps published and draft versions separate and escapes user content', () => {
  assert.equal(typeof recovery.recoveryView, 'function');
  const output = recovery.recoveryView({ posts: [post, { ...post, status: 'draft' }], media: [{ name: 'cover.png', revision: 'm2', deletedAt: '2026-10-15' }] }, { writable: true });
  assert.match(output, /&lt;旧标题&gt;/);
  assert.match(output, /data-kind="post"[^>]*data-status="published"/);
  assert.match(output, /data-kind="post"[^>]*data-status="draft"/);
  assert.match(output, /data-kind="media"/);
  assert.match(output, /完整备份/);
  assert.match(output, /校验不会修改/);
  assert.doesNotMatch(output, /<旧标题>/);
});

test('history previews the full aggregate and disables restore without a current revision', () => {
  assert.equal(typeof recovery.historyView, 'function');
  const context = { kind: 'post', id: 'first', expectedRevision: 'p3', versions: [{ kind: 'post', id: 'first', revision: 'p1', createdAt: '2026-10-15T00:00:00Z', actor: '<admin>', snapshot: { published: post, draft: { ...post, body: '<script>raw</script>' } } }] };
  const output = recovery.historyView(context);
  assert.match(output, /data-action="restore-version"[^>]*data-revision="p1"/);
  assert.match(output, /&lt;script&gt;raw&lt;\/script&gt;/);
  assert.match(output, /&lt;admin&gt;/);
  assert.match(output, /已发表版本和草稿/);
  assert.match(recovery.historyView({ ...context, expectedRevision: null }), /data-action="restore-version"[^>]*disabled/);
});

test('backup preflight reports importability separately and records failures honestly', () => {
  assert.equal(typeof recovery.recoveryView, 'function');
  const output = recovery.recoveryView({ posts: [], media: [] }, { writable: true, backupValidation: { importable: false, summary: { posts: 2, media: 1 }, reason: '目标数据库非空' }, backupEvents: [{ action: '导出', status: 'failed', message: '下载中断', createdAt: '2026-10-15' }] });
  assert.match(output, /不可导入/);
  assert.match(output, /目标数据库非空/);
  assert.match(output, /下载中断/);
  assert.match(output, /失败/);
  assert.doesNotMatch(output, /data-action="import-backup"|恢复成功|导入完成/);
});

test('partial direct deletion reports confirmed counts and retains every failure reason', () => {
  assert.equal(typeof recovery.directDeletionResult, 'function');
  const result = recovery.directDeletionResult({ deleted: [post], failed: [{ title: 'A', error: '版本冲突' }, { name: 'B.png', error: '仍被引用' }] });
  assert.equal(result.error, true);
  assert.match(result.message, /1 项/);
  assert.match(result.message, /2 项未完成/);
  assert.match(result.message, /版本冲突/);
  assert.match(result.message, /仍被引用/);
  assert.doesNotMatch(result.message, /全部|发布中|等待构建/);
});

test('opening metadata fetches the complete current version before it can enter the editor', async () => {
  assert.equal(typeof editorState.loadEditorPost, 'function');
  const metadata = { ...post, bodyLoaded: false }; delete metadata.body;
  const calls = [];
  const loaded = await editorState.loadEditorPost({ async getPost(slug, status) { calls.push([slug, status]); return { post: { ...post, revision: 'newer', body: '真实正文' } }; } }, [metadata], 'first', 'published');
  assert.deepEqual(calls, [['first', 'published']]);
  assert.equal(loaded.body, '真实正文');
  assert.equal(loaded.revision, 'newer');
  await assert.rejects(editorState.loadEditorPost({ async getPost() { return { post: metadata }; } }, [metadata], 'first', 'published'), /正文|读取/);
});
