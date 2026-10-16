import defaults from '../data/site.json' with { type: 'json' };
import { ContentError, MAX_IMAGE_BYTES, inspectMediaBytes, validateMediaName, validateSlug } from '../admin/content-model.js';
import { createAuth, sha256 } from './auth.js';
import { readFileUpload, readJson } from './body.js';
import { exportBackup, readBackup, restoreBackup } from './backup.js';

const MAX_BROWSER_BACKUP = 32 * 1024 * 1024;
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
const batch = (items, label) => { if (!Array.isArray(items) || !items.length || items.length > 3) throw new ContentError(`${label}每次请求应为 1 至 3 项，后台会自动分批处理。`); return items; };
const connection = (user, config) => ({ mode: 'database', direct: true, configured: true, connected: Boolean(user), authenticated: Boolean(user), writable: Boolean(user), label: user ? '内容服务已连接' : '等待登录', detail: user ? `${config.deployment === 'cloudflare' ? 'Cloudflare D1 / R2' : 'SQLite / 本地文件'} · 修改直接生效` : '使用站点管理员的 GitHub 账号登录。' });
const knownRoutes = new Map([['content', ['GET']], ['session', ['GET', 'POST', 'DELETE']], ['posts', ['POST']], ['posts/delete', ['POST']], ['settings', ['PUT']], ['media', ['POST']], ['media/delete', ['POST']], ['trash', ['GET']], ['trash/restore', ['POST']], ['history', ['GET']], ['history/restore', ['POST']], ['backups/export', ['GET']], ['backups/validate', ['POST']], ['backups/import', ['POST']], ['search', ['GET']]]);

export function createContentHandler(runtime, deps = {}) {
  const { store, database, blobs, config } = runtime;
  const auth = deps.auth || createAuth(database, config, deps);
  const state = async user => ({ ...(await store.getWorkspace()), connection: connection(user, config), storage: { deployment: config.deployment, direct: true } });
  return async function handle(request) {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (url.search.length > 2048) throw new ContentError('查询参数过长。');
      const path = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '');
      const postPath = knownRoutes.has(path) ? null : path.match(/^posts\/([^/]+)$/);
      const methods = knownRoutes.get(path) || (postPath ? ['GET'] : null);
      if (!methods) return json({ error: '接口不存在。', code: 'not_found' }, 404);
      if (!methods.includes(request.method)) return json({ error: '此接口不支持该请求方法。', code: 'method' }, 405, { Allow: methods.join(', ') });
      const write = !['GET', 'HEAD'].includes(request.method);
      if (write) auth.assertSameOrigin(request);
      const user = await auth.authenticate(request);
      if (path === 'session') {
        if (request.method === 'GET') return json({ connection: connection(user, config) });
        if (request.method === 'DELETE') return json({ connection: connection(null, config) }, 200, { 'Set-Cookie': await auth.logout(request) });
        const data = await readJson(request, 4096), result = await auth.login(data.token, request);
        return json({ connection: connection(result.user, config) }, 200, { 'Set-Cookie': result.cookie });
      }
      if (path === 'search') {
        const query = (url.searchParams.get('q') || '').trim();
        if (query.length > 80) throw new ContentError('搜索词最多 80 个字符。');
        return json({ results: query ? await store.searchPublishedPosts(query, { limit: 20 }) : [] });
      }
      if (path === 'content') {
        if (user) return json(await state(user));
        return json({ connection: connection(null, config), settings: await store.getPublishedSettings() || defaults, posts: [], media: [], releases: [] });
      }
      if (!user) throw new ContentError('请先登录博客管理后台。', 401, 'authentication');
      const actor = user.id;
      if (postPath) {
        let slug; try { slug = validateSlug(decodeURIComponent(postPath[1])); } catch { throw new ContentError('文章不存在。', 404, 'not_found'); }
        const status = url.searchParams.get('status') || 'published';
        if (!['published', 'draft'].includes(status)) throw new ContentError('文章状态无效。');
        const post = await store.getPost(slug, status); if (!post) throw new ContentError('文章不存在。', 404, 'not_found');
        return json({ post });
      }
      if (path === 'posts') {
        const data = await readJson(request, 7 * 1024 * 1024);
        const result = await store.savePost(data.post, { publish: data.publish === true, actor });
        return json({ ...result, state: await state(user) });
      }
      if (path === 'posts/delete') {
        const data = await readJson(request, 16384), result = await store.deletePosts(batch(data.posts, '文章'), { actor });
        return json({ ...result, state: await state(user), releases: [] });
      }
      if (path === 'settings') {
        const data = await readJson(request, 512 * 1024), result = await store.saveSettings(data.settings, { actor });
        return json({ ...result, state: await state(user) });
      }
      if (path === 'media') {
        const file = await readFileUpload(request, MAX_IMAGE_BYTES), extension = file.name.split('.').at(-1).toLowerCase();
        const stem = file.name.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'image';
        const name = validateMediaName(`${stem}-${crypto.randomUUID().slice(0, 12)}.${extension}`);
        const bytes = new Uint8Array(await file.arrayBuffer()), info = inspectMediaBytes(bytes, name);
        if (file.type && file.type !== info.mime) throw new ContentError('图片类型与实际内容不符。');
        const objectKey = `media/${name}`;
        await blobs.put(objectKey, bytes, { contentType: info.mime });
        let result;
        try { result = await store.addMedia({ name, objectKey, size: info.size, mime: info.mime, contentType: info.mime, checksum: await sha256(bytes) }); }
        catch (error) { await blobs.delete(objectKey).catch(() => {}); throw error; }
        return json({ ...result, state: await state(user) });
      }
      if (path === 'media/delete') {
        const data = await readJson(request, 16384), result = await store.deleteMedia(batch(data.media, '图片'), { actor });
        return json({ ...result, state: await state(user), releases: [] });
      }
      if (path === 'trash') return json(await store.getTrash());
      if (path === 'trash/restore') {
        const data = await readJson(request, 16384);
        if (!['post', 'media'].includes(data.kind)) throw new ContentError('恢复类型无效。');
        const result = data.kind === 'post' ? await store.restorePost(data.item, { actor }) : await store.restoreMedia(data.item, { actor });
        return json({ ...result, state: await state(user) });
      }
      if (path === 'history') return json({ versions: await store.getHistory(url.searchParams.get('kind'), url.searchParams.get('id')) });
      if (path === 'history/restore') {
        const data = await readJson(request, 16384);
        const result = await store.restoreRevision(data.kind, data.id, data.revision, data.expectedRevision, { actor });
        return json({ ...result, state: await state(user) });
      }
      if (path === 'backups/export') return await exportBackup(runtime);
      if (path === 'backups/validate') {
        const file = await readFileUpload(request, MAX_BROWSER_BACKUP);
        const checked = await readBackup(file.stream(), { retainMedia: false, maxTotalBytes: MAX_BROWSER_BACKUP });
        const snapshot = await store.exportSnapshot(), empty = !snapshot.settings && !snapshot.posts.length && !snapshot.media.length && !snapshot.history.length;
        const capacity = store.inspectSnapshot(checked.snapshot);
        return json({ valid: true, summary: checked.summary, capacity, importable: empty && capacity.withinLimit, message: !capacity.withinLimit ? '校验通过，但超过当前数据库单次恢复限制。请迁到 Node 或使用分阶段迁移。' : empty ? '校验通过，可导入空数据库。' : '校验通过。恢复需使用空数据库，当前内容不会被覆盖。' });
      }
      if (path === 'backups/import') {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-tar') throw new ContentError('导入需要完整 TAR 备份。', 415, 'media_type');
        if (!request.body) throw new ContentError('备份文件为空。');
        const result = await restoreBackup(runtime, request.body);
        return json({ ...result, state: await state(user) });
      }
      return json({ error: '接口不存在。', code: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof ContentError) return json({ error: error.message, code: error.code, requestId }, error.status);
      console.error(JSON.stringify({ event: 'content_api_failed', requestId, error: error?.name || 'Error' }));
      return json({ error: '内容服务暂时无法完成操作，请刷新工作区核对后重试。', code: 'service', requestId }, 503);
    }
  };
}

export async function serveMedia(request, runtime, rawName) {
  try {
    const name = validateMediaName(rawName), media = await runtime.store.getMedia(name);
    if (!media || (!media.public && !await createAuth(runtime.database, runtime.config).authenticate(request))) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    const object = await runtime.blobs.get(media.objectKey);
    if (!object) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    const etag = `"${media.checksum}"`;
    const headers = { 'Content-Type': media.mime, 'Content-Length': String(media.size), 'Cache-Control': media.public ? 'public, max-age=0, must-revalidate' : 'private, no-store', 'X-Content-Type-Options': 'nosniff', ETag: etag };
    if (request.headers.get('If-None-Match') === etag) { delete headers['Content-Length']; return new Response(null, { status: 304, headers }); }
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  } catch (error) {
    if (!(error instanceof ContentError)) console.error(JSON.stringify({ event: 'media_read_failed', error: error?.name || 'Error' }));
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
