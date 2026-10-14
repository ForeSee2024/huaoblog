import http from 'node:http';
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContentError, MAX_IMAGE_BYTES, MAX_POST_BYTES, findMediaReferences, inspectMediaBytes, parsePost, stringifyPost, validateMediaName, validatePost, validateSlug } from '../src/admin/content-model.js';
import { serializeSettings, validateSettings } from '../src/admin/settings-model.js';
import { mediaSelection, postSelection } from '../src/admin/bulk-model.js';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ORIGINS = new Set(['http://127.0.0.1:4321', 'http://localhost:4321']);
const MAX_JSON = 2 * 1024 * 1024;
const MAX_MEDIA_JSON = 14 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const conflict = () => { throw new ContentError('内容已被其他窗口或程序修改，请刷新后重新编辑。', 409, 'conflict'); };

async function storage(root) {
  const base = await realpath(root);
  async function securePath(relative, { createParents = false } = {}) {
    if (typeof relative !== 'string' || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new ContentError('存储路径不安全。');
    const parts = relative.split('/');
    let current = base;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      let stat;
      try { stat = await lstat(current); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (createParents && index < parts.length - 1) { await mkdir(current); stat = await lstat(current); }
        else continue;
      }
      if (stat.isSymbolicLink()) throw new ContentError('存储路径包含符号链接，无法安全读写。');
      if (index < parts.length - 1 && !stat.isDirectory()) throw new ContentError('存储路径不是目录。');
      const resolved = await realpath(current);
      if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new ContentError('存储路径超出了项目目录。');
    }
    return current;
  }
  async function read(relative, max = MAX_POST_BYTES + 65536) {
    const filename = await securePath(relative);
    let file;
    try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > max) throw new ContentError(`文件 ${relative} 类型或大小不受支持。`);
      const bytes = await file.readFile();
      return { path: relative, bytes, revision: hash(bytes), size: bytes.length };
    } finally { await file.close(); }
  }
  async function write(relative, content) {
    const filename = await securePath(relative, { createParents: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    try { await securePath(relative); await rename(temporary, filename); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  async function remove(relative) { const filename = await securePath(relative); await unlink(filename); }
  async function list(relative) {
    const directory = await securePath(relative);
    try { return await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  return { read, write, remove, list };
}

function revisionFor(records, slug) {
  const published = records.find(record => record.post.slug === slug && record.post.status === 'published');
  const draft = records.find(record => record.post.slug === slug && record.post.status === 'draft');
  return published || draft ? hash(`${published?.revision || ''}:${draft?.revision || ''}`) : undefined;
}
function checkRevision(expected, actual) { if ((expected || undefined) !== actual) conflict(); }

async function snapshot(store) {
  const records = [];
  for (const [folder, draft] of [['src/content/posts', false], ['src/content/drafts', true]]) {
    const entries = await store.list(folder);
    if (entries.length > 2000) throw new ContentError('文章数量超过本地编辑服务限制。');
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new ContentError('文章目录包含符号链接，无法安全读取。');
      if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
      const slug = validateSlug(entry.name.replace(/\.mdx?$/, ''));
      if (records.some(record => record.post.slug === slug && record.post.status === (draft ? 'draft' : 'published'))) throw new ContentError(`文章 ${slug} 存在重复文件，请先整理。`);
      const record = await store.read(`${folder}/${entry.name}`);
      if (record) records.push({ ...record, post: parsePost(record.bytes.toString('utf8'), slug, { draft }) });
    }
  }
  const settingsFile = await store.read('src/data/site.json', MAX_JSON);
  if (!settingsFile) throw new ContentError('站点设置文件不存在，请检查 src/data/site.json。', 404);
  let settings;
  try { settings = validateSettings(JSON.parse(settingsFile.bytes.toString('utf8'))); } catch (error) { if (error instanceof ContentError) throw error; throw new ContentError('站点设置文件无法解析。'); }
  settings.revision = settingsFile.revision;
  const media = [];
  const entries = await store.list('public/images/posts');
  if (entries.length > 2000) throw new ContentError('图片数量超过本地编辑服务限制。');
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new ContentError('图片目录包含符号链接，无法安全读取。');
    if (!entry.isFile() || !/\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name)) continue;
    validateMediaName(entry.name);
    const record = await store.read(`public/images/posts/${entry.name}`, MAX_IMAGE_BYTES);
    if (record) media.push({ name: entry.name, path: record.path, publicUrl: `/images/posts/${entry.name}`, url: `/images/posts/${entry.name}`, size: record.size, revision: record.revision });
  }
  const posts = records.map(record => ({ ...record.post, revision: revisionFor(records, record.post.slug), hasPublishedVersion: records.some(item => item.post.slug === record.post.slug && item.post.status === 'published') }));
  return { records, posts, settings, media, releases: [], connection: { mode: 'local', connected: true, authenticated: true, writable: true, label: '本地文件已连接', detail: '内容直接保存到项目目录，正式部署后生效。' } };
}

async function readJson(request, limit) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new ContentError('请求必须使用 JSON 格式。', 415);
  if (Number(request.headers['content-length']) > limit) { request.resume(); throw new ContentError('请求内容过大。', 413); }
  const chunks = [];
  let size = 0;
  const bytes = await new Promise((resolve, reject) => {
    let failed = false;
    request.on('data', chunk => { size += chunk.length; if (size > limit) { if (!failed) { failed = true; reject(new ContentError('请求内容过大。', 413)); } } else if (!failed) chunks.push(chunk); });
    request.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    request.on('error', reject);
  });
  try { const data = JSON.parse(bytes.toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; } catch { throw new ContentError('JSON 请求无法解析。'); }
}
const publicState = ({ records: _records, ...state }) => state;

export async function createContentServer({ root = DEFAULT_ROOT } = {}) {
  const store = await storage(root);
  let queue = Promise.resolve();
  const mutate = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const server = http.createServer(async (request, response) => {
    const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); };
    try {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(request.headers.host || '')) throw new ContentError('编辑服务只接受本机请求。', 403);
      const origin = request.headers.origin;
      const mutation = !['GET', 'HEAD'].includes(request.method);
      if ((origin && !ORIGINS.has(origin)) || (mutation && !ORIGINS.has(origin))) throw new ContentError('请求来源未授权，请从本地写作后台操作。', 403);
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); response.end(); return;
      }
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/api/content') {
        const { records: _records, ...state } = await snapshot(store); json(200, state); return;
      }
      if (!mutation) throw new ContentError('接口不存在。', 404);
      const body = await readJson(request, pathname === '/api/media' ? MAX_MEDIA_JSON : MAX_JSON);
      const result = await mutate(async () => {
        const state = await snapshot(store);
        if (pathname === '/api/posts' && request.method === 'POST') {
          const article = validatePost(body.post, { publish: body.publish === true });
          checkRevision(body.post.revision, revisionFor(state.records, article.slug));
          const draft = state.records.find(record => record.post.slug === article.slug && record.post.status === 'draft');
          const published = state.records.find(record => record.post.slug === article.slug && record.post.status === 'published');
          const destination = article.status === 'published' ? (published?.path || `src/content/posts/${article.slug}.md`) : (draft?.path.startsWith('src/content/drafts/') ? draft.path : `src/content/drafts/${article.slug}.md`);
          await store.write(destination, stringifyPost(article));
          if (draft && draft.path !== destination) await store.remove(draft.path);
          const fresh = await snapshot(store);
          return { state: publicState(fresh), post: fresh.posts.find(post => post.slug === article.slug && post.status === article.status) };
        }
        if (request.method === 'POST' && ['/api/posts/delete', '/api/media/delete'].includes(pathname)) {
          const articles = pathname === '/api/posts/delete';
          const selection = articles ? postSelection(body.posts) : mediaSelection(body.media);
          const targets = selection.map(item => {
            if (articles) {
              checkRevision(item.revision, revisionFor(state.records, item.slug));
              const record = state.records.find(record => record.post.slug === item.slug && record.post.status === item.status);
              if (!record) throw new ContentError(`文章 ${item.slug} 不存在，请刷新列表。`, 404);
              return { path: record.path, item };
            }
            const current = state.media.find(media => media.path === item.path);
            if (!current) throw new ContentError(`图片 ${item.name} 不存在，请刷新媒体库。`, 404);
            checkRevision(item.revision, current.revision);
            const references = findMediaReferences(current.publicUrl, state.posts, state.settings);
            if (references.length) throw new ContentError(`图片 ${item.name} 仍被${references.join('、')}引用，请先移除引用。`, 409, 'referenced_media');
            return { path: current.path, item: current };
          });
          const deleted = [], failed = [];
          for (const target of targets) {
            try { await store.remove(target.path); deleted.push(target.item); }
            catch { failed.push({ ...target.item, error: '文件未能删除，请刷新后重试。' }); }
          }
          return { state: publicState(await snapshot(store)), deleted, failed, releases: [] };
        }
        const postMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
        if (postMatch && request.method === 'DELETE') {
          const slug = validateSlug(decodeURIComponent(postMatch[1]));
          if (!body.post || body.post.slug !== slug || !['draft', 'published'].includes(body.post.status)) throw new ContentError('请选择需要删除的文章版本。');
          checkRevision(body.post.revision, revisionFor(state.records, slug));
          const record = state.records.find(item => item.post.slug === slug && item.post.status === body.post.status);
          if (!record) throw new ContentError('文章版本不存在，请刷新列表。', 404);
          await store.remove(record.path);
          return { state: publicState(await snapshot(store)), deleted: { slug, status: body.post.status } };
        }
        if (pathname === '/api/settings' && request.method === 'PUT') {
          const settings = validateSettings(body.settings);
          checkRevision(settings.revision, state.settings.revision);
          await store.write('src/data/site.json', serializeSettings(settings));
          const fresh = await snapshot(store);
          return { state: publicState(fresh), settings: fresh.settings };
        }
        if (pathname === '/api/media' && request.method === 'POST') {
          const name = validateMediaName(body.name);
          if (typeof body.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content) || body.content.length % 4 !== 0) throw new ContentError('图片编码格式不正确。');
          const bytes = Buffer.from(body.content, 'base64');
          const info = inspectMediaBytes(bytes, name);
          if (body.mime && body.mime !== info.mime) throw new ContentError('图片类型与文件内容不符。');
          if (state.media.some(media => media.name === name) || await store.read(`public/images/posts/${name}`, MAX_IMAGE_BYTES)) throw new ContentError('同名图片已存在，请换一个名称。', 409, 'conflict');
          await store.write(`public/images/posts/${name}`, bytes);
          return { state: publicState(await snapshot(store)), media: { name, path: `public/images/posts/${name}`, publicUrl: `/images/posts/${name}`, url: `/images/posts/${name}`, size: info.size, revision: hash(bytes) } };
        }
        const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
        if (mediaMatch && request.method === 'DELETE') {
          const name = validateMediaName(decodeURIComponent(mediaMatch[1]));
          const current = state.media.find(media => media.name === name);
          if (!current || body.media?.path !== current.path) throw new ContentError('图片不存在，请刷新媒体库。', 404);
          checkRevision(body.media.revision, current.revision);
          const references = findMediaReferences(current.publicUrl, state.posts, state.settings);
          if (references.length) throw new ContentError(`图片仍被${references.join('、')}引用，请先移除引用。`, 409, 'referenced_media');
          await store.remove(current.path);
          return { state: publicState(await snapshot(store)), deleted: current };
        }
        throw new ContentError('接口不存在。', 404);
      });
      json(200, result);
    } catch (error) { json(error instanceof ContentError ? error.status : 500, { error: error instanceof ContentError ? error.message : '本地内容操作失败，请查看终端后重试。', code: error.code || 'storage_error' }); if (!(error instanceof ContentError)) console.error(error); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await createContentServer();
  const port = Number(process.env.CONTENT_PORT || 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CONTENT_PORT 无效。');
  server.on('error', error => { console.error(`本地内容服务启动失败：${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.info(`HuaOvO 本地内容服务：http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
