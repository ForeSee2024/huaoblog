import { ContentError, MAX_IMAGE_BYTES, MAX_POST_BYTES, findMediaReferences, inspectMediaBytes, normalizePercentEncoding, parsePost, stringifyPost, validateMediaName, validatePost, validateSlug } from './content-model.js';
import { serializeSettings, validateSettings } from './settings-model.js';
import { mediaSelection, postKey, postSelection } from './bulk-model.js';

const API = 'https://api.github.com';
const MAX_ENTRIES = 10000;
const MAX_PAGES = 10;
const MAX_TEXT_TOTAL = 25 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const MAX_PREVIEWS = 40;
const conflict = () => { throw new ContentError('内容或发布版本已被其他窗口修改，请刷新后重新操作。', 409, 'conflict'); };
const refPath = value => value.split('/').map(encodeURIComponent).join('/');
const mediaPath = name => `public/images/posts/${validateMediaName(name)}`;
const publicPath = value => `/${value.slice('public/'.length)}`;

function encode64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function decode64(value) {
  let binary;
  try { binary = atob(value.replace(/\s/g, '')); } catch { throw new ContentError('仓库文件编码无效。'); }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
async function mapLimit(values, limit, work) {
  let next = 0;
  const results = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(values.length, limit) }, async () => { while (next < values.length) { const index = next++; results[index] = await work(values[index], index); } }));
  return results;
}
function managedPath(value) {
  if (value === 'src/data/site.json') return true;
  const article = value.match(/^src\/content\/(posts|drafts)\/([^/]+)\.mdx?$/);
  if (article) { validateSlug(article[2]); return true; }
  if (value.startsWith('public/images/posts/') && /\.(png|jpe?g|webp|gif|avif)$/i.test(value)) { validateMediaName(value.slice('public/images/posts/'.length)); return true; }
  return false;
}
function metadata(pr) {
  const match = (pr.body || '').match(/<!-- huaovo-admin:(\{[^\n]*\}) -->/);
  try {
    const value = match && JSON.parse(match[1]);
    if (!value || !['post', 'post-delete', 'draft-delete', 'post-delete-batch', 'media-delete-batch', 'settings', 'media'].includes(value.kind)) return null;
    if (['post', 'post-delete', 'draft-delete'].includes(value.kind)) validateSlug(value.slug);
    if (value.kind === 'post-delete-batch') return { kind: value.kind, items: postSelection(value.items).map(({ slug, status }) => ({ slug, status })) };
    if (value.kind === 'media-delete-batch') return { kind: value.kind, names: mediaSelection(value.names?.map(name => ({ name, path: mediaPath(name) }))).map(item => item.name) };
    return { kind: value.kind, ...(value.slug ? { slug: value.slug } : {}) };
  } catch { return null; }
}
function release(pr) {
  return { id: pr.number, title: pr.title, url: pr.html_url, state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'review', branch: pr.head.ref, sha: pr.head.sha, ...metadata(pr) };
}
function postEntry(snapshot, slug, folder = 'posts') {
  const entries = [...snapshot.entries.values()].filter(entry => entry.path === `src/content/${folder}/${slug}.md` || entry.path === `src/content/${folder}/${slug}.mdx`);
  if (entries.length > 1) throw new ContentError(`文章 ${slug} 存在重复文件，请先整理仓库。`);
  return entries[0];
}
function postRevision(main, workspace, slug) {
  const published = postEntry(main, slug);
  const pending = workspace && postEntry(workspace, slug);
  const draft = postEntry(workspace || main, slug, 'drafts');
  return published || pending || draft ? `p:${published?.sha || '-'};d:${draft?.sha || (pending?.sha !== published?.sha ? pending?.sha : '') || '-'}` : undefined;
}
function checkRevision(expected, actual) { if ((expected || undefined) !== actual) conflict(); }
function deletesPost(meta, post) {
  return meta?.kind === 'post-delete-batch' ? meta.items.some(item => postKey(item) === postKey(post)) : meta?.slug === post.slug && meta.kind === (post.status === 'draft' ? 'draft-delete' : 'post-delete');
}

async function imageFile(file, deps) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string' || file.size > MAX_IMAGE_BYTES) throw new ContentError('请选择不超过 10 MB 的图片文件。', 413);
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(extension)) throw new ContentError('仅支持 PNG、JPG、WebP、GIF 和 AVIF 图片。');
  const stem = file.name.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'image';
  const name = `${stem}-${(deps.crypto || globalThis.crypto).randomUUID().slice(0, 8)}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectMediaBytes(bytes, name);
  if (file.type && file.type !== info.mime) throw new ContentError('图片类型与实际文件内容不符。');
  const decode = deps.createImageBitmap ?? globalThis.createImageBitmap;
  if (decode) {
    try { const bitmap = await decode(file); bitmap.close(); } catch { throw new ContentError('图片无法解码，请选择有效的图片文件。'); }
  }
  return { name, bytes, ...info };
}

function localRepository(deps) {
  const fetcher = deps.fetch || globalThis.fetch.bind(globalThis);
  const origin = deps.localApi || 'http://127.0.0.1:8081';
  async function request(path, method = 'GET', body) {
    let response;
    try { response = await fetcher(origin + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) }); }
    catch { throw new ContentError('本地内容服务无法连接，请在项目目录运行 npm run dev。', 503, 'connection'); }
    let data;
    try { data = await response.json(); } catch { throw new ContentError('本地内容服务返回了无效响应。', 502); }
    if (!response.ok) throw new ContentError(data.error || '本地内容操作失败。', response.status, data.code);
    return data;
  }
  return {
    load: () => request('/api/content'),
    savePost: (post, options = {}) => request('/api/posts', 'POST', { post: validatePost(post, options), publish: options.publish === true }),
    deletePost: post => request(`/api/posts/${validateSlug(post.slug)}`, 'DELETE', { post }),
    deletePosts: posts => request('/api/posts/delete', 'POST', { posts: postSelection(posts) }),
    saveSettings: settings => request('/api/settings', 'PUT', { settings: validateSettings(settings) }),
    async uploadMedia(file) { const image = await imageFile(file, deps); return request('/api/media', 'POST', { name: image.name, content: encode64(image.bytes), mime: image.mime }); },
    async getMediaPreview(media) { if (media.path !== mediaPath(media.name)) throw new ContentError('图片路径不安全。'); return { media: { ...media, url: publicPath(media.path), publicUrl: publicPath(media.path), previewPending: false } }; },
    deleteMedia: media => request(`/api/media/${validateMediaName(media.name)}`, 'DELETE', { media }),
    deleteMediaBatch: media => request('/api/media/delete', 'POST', { media: mediaSelection(media) }),
    async publishRelease() { throw new ContentError('本地文章在点击发布时写入项目文件，无需合并远程发布。'); },
    async login() { return (await request('/api/content')).connection; },
    logout() {},
  };
}

/** Local IO uses the loopback API; production changes are always staged on GitHub PR branches. */
export function createRepository(config, deps = {}) {
  if (config.local) return localRepository(deps);
  const fetcher = deps.fetch || globalThis.fetch.bind(globalThis);
  const browser = deps.window || globalThis.window;
  let session;
  try { session = deps.sessionStorage ?? globalThis.sessionStorage; } catch { /* memory-only authentication still works */ }
  const tokenKey = `huaovo:${config.repo}:github-token`;
  let token;
  try { token = session?.getItem(tokenKey) || ''; } catch { token = ''; }
  const branch = config.branch || 'main';
  const base = `/repos/${String(config.repo || '').split('/').map(encodeURIComponent).join('/')}`;
  const blobs = new Map(), previews = new Map(), snapshots = new Map(), fileLists = new Map();
  let mutationQueue = Promise.resolve(), loginPromise, cancelLogin, lastState, loading;
  const mutate = work => { const result = mutationQueue.then(work); mutationQueue = result.catch(() => {}); return result; };
  const progress = message => deps.onProgress?.(message);
  function cached(cache, key, read) {
    if (cache.has(key)) return cache.get(key);
    const value = Promise.resolve().then(read);
    cache.set(key, value);
    while (cache.size > 32) cache.delete(cache.keys().next().value);
    value.catch(() => { if (cache.get(key) === value) cache.delete(key); });
    return value;
  }
  const filesFor = (pr, mainHead) => cached(fileLists, `${pr.number}:${pr.head.sha}:${pr.base?.sha || mainHead}`, () => pages(`/pulls/${pr.number}/files`));

  function configured() {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(config.repo || '') || !/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/.test(branch) || branch.includes('//') || branch.endsWith('/')) throw new ContentError('GitHub 仓库或主分支尚未正确配置。', 503, 'configuration');
    try { if (new URL(config.authUrl).protocol !== 'https:' || new URL(config.authUrl).username || new URL(config.authUrl).password) throw new Error(); } catch { throw new ContentError('GitHub 登录服务必须配置为完整的 HTTPS 地址。', 503, 'configuration'); }
  }
  const connection = (authenticated, info) => ({ mode: 'github', configured: Boolean(config.repo && config.authUrl), connected: authenticated, authenticated, writable: authenticated && info?.permissions?.push === true, label: authenticated ? 'GitHub 仓库已连接' : '尚未登录 GitHub', detail: authenticated ? `${config.repo} · ${branch}，所有变更通过 PR 发布。` : '登录后读取仓库内容并保存草稿。' });
  function requireAuth() { configured(); if (!token) throw new ContentError('请先登录 GitHub。', 401, 'authentication'); }

  async function api(path, { method = 'GET', body, optional = false, graphql = false } = {}) {
    requireAuth();
    let response;
    try {
      response = await fetcher(`${API}${graphql ? '/graphql' : base + path}`, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    } catch { throw new ContentError('GitHub 无法连接，请检查网络后重试。', 503, 'connection'); }
    if (optional && response.status === 404) return null;
    let data;
    try { data = response.status === 204 ? {} : await response.json(); } catch { throw new ContentError('GitHub 返回了无法解析的响应。', 502); }
    if (!response.ok) {
      if (response.status === 401) { token = ''; try { session?.removeItem(tokenKey); } catch { /* unavailable storage */ } throw new ContentError('GitHub 登录已过期，请重新登录。', 401, 'authentication'); }
      if ([409, 412, 422].includes(response.status)) conflict();
      if (response.status === 403) throw new ContentError(response.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub 请求额度暂时用尽，请稍后重试。' : 'GitHub 权限不足，或分支保护尚未允许此操作。', 403, 'permission');
      throw new ContentError(`GitHub 请求失败（HTTP ${response.status}），请确认仓库与权限后重试。`, response.status, 'github_error');
    }
    if (graphql && data.errors?.length) throw new ContentError('GitHub 未能更新 PR 的草稿状态，请打开 PR 检查权限后重试。', 403, 'permission');
    return data;
  }

  async function pages(path, field) {
    const result = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const values = field ? data[field] : data;
      if (!Array.isArray(values)) throw new ContentError('GitHub 列表响应格式无效。', 502);
      result.push(...values);
      if (field && Number.isInteger(data.total_count) && result.length >= data.total_count) return result;
      if (values.length < 100 && (!field || !data.total_count || result.length >= data.total_count)) return result;
    }
    throw new ContentError('仓库列表超过后台读取限制，请在 GitHub 中整理后重试。', 413);
  }

  async function treeEntries(treeSha) {
    const recursive = await api(`/git/trees/${treeSha}?recursive=1`);
    let entries = recursive.tree;
    if (recursive.truncated) {
      entries = [];
      const queue = [{ sha: treeSha, prefix: '' }];
      let visited = 0;
      while (queue.length) {
        if (++visited > 200) throw new ContentError('仓库目录过大，无法完整读取内容。', 413);
        const current = queue.shift(), tree = await api(`/git/trees/${current.sha}`);
        if (tree.truncated || tree.tree.length > MAX_ENTRIES) throw new ContentError('仓库目录被 GitHub 截断，无法安全读取。', 413);
        for (const entry of tree.tree) {
          const path = current.prefix + entry.path;
          if (entry.type === 'tree' && ['src', 'src/content', 'src/content/posts', 'src/content/drafts', 'src/data', 'public', 'public/images', 'public/images/posts'].includes(path)) queue.push({ sha: entry.sha, prefix: `${path}/` });
          else if (entry.type === 'blob') entries.push({ ...entry, path });
        }
        if (entries.length > MAX_ENTRIES) throw new ContentError('仓库文件数量超过后台读取限制。', 413);
      }
    }
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new ContentError('仓库文件数量超过后台读取限制。', 413);
    const managed = entries.filter(entry => managedPath(entry.path));
    for (const entry of managed) if (entry.mode !== '100644' && entry.mode !== '100755') throw new ContentError('内容目录包含符号链接或不受支持的文件类型。');
    return new Map(managed.map(entry => [entry.path, entry]));
  }
  async function snapshot(ref, knownHead) {
    const head = knownHead || (await api(`/git/ref/heads/${refPath(ref)}`)).object.sha;
    const value = await cached(snapshots, head, async () => {
      const commit = await api(`/git/commits/${head}`);
      return { head, treeSha: commit.tree.sha, entries: await treeEntries(commit.tree.sha) };
    });
    return { ...value, branch: ref, entries: new Map(value.entries) };
  }
  async function bytes(entry, max = MAX_POST_BYTES + 65536) {
    if (!entry || entry.size > max) throw new ContentError('仓库文件不存在或体积超过后台读取限制。', 413);
    if (!blobs.has(entry.sha)) {
      const pending = api(`/git/blobs/${entry.sha}`).then(data => { if (data.encoding !== 'base64' || typeof data.content !== 'string' || data.content.length > Math.ceil(max / 3) * 4 + 65536) throw new ContentError('仓库文件编码或体积不受支持。', 413); const value = decode64(data.content); if (value.length > max) throw new ContentError('仓库文件体积超过限制。', 413); return value; });
      blobs.set(entry.sha, pending); pending.catch(() => blobs.delete(entry.sha));
    }
    const value = await blobs.get(entry.sha);
    if (value.length > max) throw new ContentError('仓库文件体积超过限制。', 413);
    return value;
  }
  async function text(entry) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(await bytes(entry)); } catch (error) { if (error instanceof ContentError) throw error; throw new ContentError('仓库文本文件不是有效的 UTF-8 编码。'); }
  }
  function createPreviewUrl(value, mime) {
    const createUrl = deps.createObjectURL || URL.createObjectURL;
    return createUrl ? createUrl(new Blob([value], { type: mime })) : `data:${mime};base64,${encode64(value)}`;
  }
  function rememberPreview(sha, url, size) {
    const existing = previews.get(sha);
    if (existing) { if (url !== existing.url && url.startsWith('blob:')) URL.revokeObjectURL(url); previews.delete(sha); previews.set(sha, existing); return existing.url; }
    while (previews.size && (previews.size >= MAX_PREVIEWS || [...previews.values()].reduce((total, entry) => total + entry.size, 0) + size > MAX_PREVIEW_BYTES)) {
      const [oldSha, old] = previews.entries().next().value;
      if (old.url.startsWith('blob:')) URL.revokeObjectURL(old.url);
      previews.delete(oldSha); blobs.delete(oldSha);
    }
    previews.set(sha, { url, size }); return url;
  }
  async function preview(entry) {
    const existing = previews.get(entry.sha);
    if (existing) { previews.delete(entry.sha); previews.set(entry.sha, existing); return existing.url; }
    const value = await bytes(entry, MAX_IMAGE_BYTES);
    const info = inspectMediaBytes(value, entry.path.split('/').at(-1));
    const url = rememberPreview(entry.sha, createPreviewUrl(value, info.mime), info.size);
    blobs.delete(entry.sha);
    return url;
  }
  const ownPr = pr => pr.head?.ref?.startsWith('huaovo/') && pr.head?.repo?.full_name?.toLowerCase() === config.repo.toLowerCase() && pr.base?.ref === branch;
  function loadState() {
    if (loading) return loading;
    const pending = readState();
    loading = pending;
    pending.finally(() => { if (loading === pending) loading = undefined; }).catch(() => {});
    return pending;
  }
  async function readState() {
    requireAuth();
    progress('正在核对仓库与内容版本…');
    const [info, main, workspaces] = await Promise.all([
      api(''), snapshot(branch),
      pages(`/pulls?state=open&base=${encodeURIComponent(branch)}`).then(pulls => {
        const own = pulls.filter(ownPr);
        if (own.length > 100) throw new ContentError('待处理发布过多，请先在 GitHub 中整理 PR。', 413);
        return mapLimit(own, 4, async pr => {
          const [content, files] = await Promise.all([snapshot(pr.head.ref, pr.head.sha), filesFor(pr, lastState?.main.head)]);
          return { ...content, files, pr, meta: metadata(pr) };
        });
      }),
    ]);
    return assembleState(info, main, workspaces);
  }
  async function assembleState(info, main, workspaces) {
    progress('正在整理文章与站点配置…');
    const posts = [], allPosts = [], allSettings = [], mediaSources = new Map(), articleSizes = new Map();
    main.legacyDraftSlugs = new Set();
    let textTotal = 0;
    const readArticle = async (entry, draft) => { const source = await text(entry), size = new TextEncoder().encode(source).length; textTotal += size; articleSizes.set(entry.sha, size); if (textTotal > MAX_TEXT_TOTAL) throw new ContentError('文章总大小超过后台读取限制。', 413); return parsePost(source, entry.path.split('/').at(-1).replace(/\.mdx?$/, ''), { draft }); };
    const mainArticles = [...main.entries.values()].filter(entry => entry.path.startsWith('src/content/'));
    const settingsEntry = main.entries.get('src/data/site.json');
    if (!settingsEntry) throw new ContentError('仓库缺少 src/data/site.json 站点设置。', 404);
    const pendingText = workspaces.flatMap(workspace => workspace.files.filter(file => file.status !== 'removed').map(file => workspace.entries.get(file.filename)).filter(entry => entry && (entry.path === 'src/data/site.json' && workspace.meta?.kind === 'settings' || entry.path.startsWith('src/content/') && workspace.meta?.kind === 'post')));
    if ([...mainArticles, ...pendingText.filter(entry => entry.path.startsWith('src/content/'))].reduce((total, entry) => total + (entry.size || 0), 0) > MAX_TEXT_TOTAL) throw new ContentError('文章总大小超过后台读取限制。', 413);
    await mapLimit([...new Map([...mainArticles, settingsEntry, ...pendingText].map(entry => [entry.sha, entry])).values()], 4, entry => text(entry));
    await mapLimit(mainArticles, 4, async entry => {
      const article = await readArticle(entry, entry.path.includes('/drafts/'));
      if (entry.path.includes('/posts/') && article.status === 'draft') main.legacyDraftSlugs.add(article.slug);
      const workspace = workspaces.find(item => item.meta?.kind === 'post' && item.meta.slug === article.slug);
      const deletion = workspaces.find(item => deletesPost(item.meta, article));
      const value = { ...article, revision: postRevision(main, workspace, article.slug), hasPublishedVersion: article.status === 'published' || Boolean(postEntry(main, article.slug)) && !main.legacyDraftSlugs.has(article.slug), ...(deletion ? { pendingDeletion: true } : {}) };
      const replacedDraft = article.status === 'draft' && workspace?.files.some(file => file.status !== 'removed' && (file.filename === `src/content/drafts/${article.slug}.md` || file.filename === `src/content/drafts/${article.slug}.mdx` || file.filename === `src/content/posts/${article.slug}.md` || file.filename === `src/content/posts/${article.slug}.mdx`));
      if (!replacedDraft) posts.push(value);
      allPosts.push(value);
    });
    let settings;
    try { settings = validateSettings(JSON.parse(await text(settingsEntry))); } catch (error) { if (error instanceof ContentError) throw error; throw new ContentError('仓库站点设置无法解析。'); }
    allSettings.push(settings);
    const settingsRevision = pending => `s:${settingsEntry.sha};w:${pending?.sha || '-'}`;
    settings.revision = settingsRevision();
    for (const entry of main.entries.values()) if (entry.path.startsWith('public/images/posts/')) mediaSources.set(entry.path, { entry, pending: false });
    for (const workspace of workspaces) {
      // A branch may contain old copies of files updated on main since it was created.
      // Only the PR's real diff represents pending work.
      const changed = workspace.files.filter(file => file.status !== 'removed').map(file => workspace.entries.get(file.filename)).filter(Boolean);
      for (const entry of changed) {
        if (entry.path.startsWith('src/content/')) {
          const slug = entry.path.split('/').at(-1).replace(/\.mdx?$/, '');
          if (workspace.meta?.kind !== 'post' || workspace.meta.slug !== slug) continue;
          if (workspace.pr.draft && entry.path.includes('/posts/')) continue;
          const article = await readArticle(entry, true);
          workspace.articleBytes = (workspace.articleBytes || 0) + articleSizes.get(entry.sha);
          const value = { ...article, status: 'draft', revision: postRevision(main, workspace, article.slug), branch: workspace.branch, hasPublishedVersion: Boolean(postEntry(main, article.slug)) && !main.legacyDraftSlugs.has(article.slug), pendingPublication: entry.path.includes('/posts/') };
          posts.push(value); allPosts.push(value);
        } else if (entry.path === 'src/data/site.json') {
          if (workspace.meta?.kind !== 'settings') continue;
          let pending;
          try { pending = validateSettings(JSON.parse(await text(entry))); } catch { throw new ContentError('待发布的站点设置无法解析。'); }
          allSettings.push(pending);
          if (workspace.meta?.kind === 'settings') settings = { ...pending, revision: settingsRevision(entry), pendingPublication: true, branch: workspace.branch };
        } else if (entry.path.startsWith('public/images/posts/')) mediaSources.set(entry.path, { entry, pending: entry.sha !== main.entries.get(entry.path)?.sha, branch: workspace.branch });
      }
    }
    const media = [...mediaSources.values()].map(source => {
      const { entry } = source, name = entry.path.split('/').at(-1), publicUrl = publicPath(entry.path);
      let url = publicUrl;
      if (source.pending) url = previews.get(entry.sha)?.url || '/favicon.svg';
      else { try { url = new URL(publicUrl, config.siteUrl).href; } catch { /* same-site URL remains usable */ } }
      const pendingDeletion = workspaces.some(item => item.files.some(file => file.filename === entry.path && file.status === 'removed'));
      return { name, path: entry.path, publicUrl, url, size: entry.size, revision: entry.sha, previewPending: source.pending && !previews.has(entry.sha), ...(pendingDeletion ? { pendingDeletion: true } : {}), ...(source.branch ? { branch: source.branch } : {}) };
    });
    const state = { posts, settings, media, releases: workspaces.map(workspace => release(workspace.pr)), connection: connection(true, info), info, main, workspaces, allPosts, allSettings, mediaSources, textTotal };
    const retained = new Set([main, ...workspaces].flatMap(item => [...item.entries.values()].map(entry => entry.sha)));
    for (const sha of blobs.keys()) if (!retained.has(sha)) blobs.delete(sha);
    lastState = state; return state;
  }
  async function updatedState(state, updates, main = state.main) {
    const workspaces = new Map(state.workspaces.map(item => [item.branch, item]));
    for (const workspace of updates) {
      if (!workspace.pr || workspace.pr.state !== 'open') workspaces.delete(workspace.branch);
      else workspaces.set(workspace.branch, workspace);
    }
    return assembleState(state.info, main, [...workspaces.values()]);
  }
  function visible(state) { const { posts, settings, media, releases, connection } = state; return { posts, settings, media, releases, connection }; }
  function writable(state) { if (!state.connection.writable) throw new ContentError('当前 GitHub 账号没有此仓库的写入权限。', 403, 'permission'); }
  async function workspaceFor(state, kind, slug) {
    const active = kind.endsWith('-batch') ? [] : state.workspaces.filter(workspace => workspace.meta?.kind === kind && workspace.meta.slug === slug);
    if (active.length > 1) throw new ContentError('同一内容存在多个待处理 PR，请先在 GitHub 中处理重复发布。', 409, 'conflict');
    if (active[0]) return { ...active[0], entries: new Map(active[0].entries) };
    const suffix = kind === 'post' ? `post-${slug}` : kind === 'post-delete' ? `delete-post-${slug}` : kind === 'draft-delete' ? `delete-draft-${slug}` : kind === 'post-delete-batch' ? 'delete-posts' : kind === 'media-delete-batch' ? 'delete-media' : kind === 'settings' ? 'site-settings' : 'media';
    const name = `huaovo/${suffix}-${(deps.crypto || globalThis.crypto).randomUUID().slice(0, 8)}`;
    await api('/git/refs', { method: 'POST', body: { ref: `refs/heads/${name}`, sha: state.main.head } });
    return { ...state.main, branch: name, meta: { kind, ...(slug ? { slug } : {}) } };
  }
  function imageChanges(state, workspace, posts = [], settings = {}) {
    const changes = [];
    for (const source of state.mediaSources.values()) if (!workspace.entries.has(source.entry.path) && findMediaReferences(publicPath(source.entry.path), posts, settings).length) changes.push({ path: source.entry.path, sha: source.entry.sha });
    return changes;
  }
  async function writeChanges(workspace, changes, { title, ready }) {
    if (!workspace.branch.startsWith('huaovo/') || workspace.branch === branch) throw new ContentError('发布操作不能直接修改主分支。');
    const effective = [];
    for (const change of changes) {
      const current = workspace.entries.get(change.path);
      if (change.sha === null && !current) continue;
      if (change.sha && change.sha === current?.sha) continue;
      if (typeof change.content === 'string' && current && await text(current) === change.content) continue;
      effective.push({ ...change, mode: '100644', type: 'blob' });
    }
    let head = workspace.head;
    if (effective.length) {
      progress('正在提交内容变更…');
      const tree = await api('/git/trees', { method: 'POST', body: { base_tree: workspace.treeSha, tree: effective } });
      const [commit, entries] = await Promise.all([
        api('/git/commits', { method: 'POST', body: { message: title, tree: tree.sha, parents: [workspace.head] } }),
        treeEntries(tree.sha),
      ]);
      head = commit.sha;
      workspace.head = head;
      workspace.treeSha = tree.sha;
      workspace.entries = entries;
      await api(`/git/refs/heads/${refPath(workspace.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      cached(snapshots, head, () => ({ head, treeSha: tree.sha, entries: new Map(entries) }));
      for (const change of effective) if (typeof change.content === 'string' && entries.has(change.path)) blobs.set(entries.get(change.path).sha, Promise.resolve(new TextEncoder().encode(change.content)));
    }
    const body = `${ready ? '内容已准备发布。合并前必须通过仓库构建与保护检查。' : '此 PR 保存写作草稿；请在后台准备发布后再合并。'}\n\n<!-- huaovo-admin:${JSON.stringify(workspace.meta)} -->`;
    let pr = workspace.pr;
    if (!pr && !effective.length) return null;
    if (!pr) pr = await api('/pulls', { method: 'POST', body: { title, body, head: workspace.branch, base: branch, draft: !ready } });
    else {
      if (pr.title !== title || pr.body !== body) pr = await api(`/pulls/${pr.number}`, { method: 'PATCH', body: { title, body } });
      if (pr.draft === ready) {
        const operation = ready ? 'markPullRequestReadyForReview' : 'convertPullRequestToDraft';
        await api('', { graphql: true, method: 'POST', body: { query: `mutation($id: ID!) { result: ${operation}(input: {pullRequestId: $id}) { pullRequest { id } } }`, variables: { id: pr.node_id } } });
        pr = { ...pr, draft: !ready };
      }
    }
    workspace.head = head;
    workspace.pr = { ...pr, head: { ...pr.head, sha: head } };
    workspace.files = await filesFor(workspace.pr, lastState?.main.head);
    return workspace.pr;
  }
  async function savePost(input, options = {}) {
    const article = validatePost(input, options), state = await loadState(); writable(state);
    if (state.posts.some(post => post.slug === article.slug && post.pendingDeletion)) throw new ContentError('这篇内容已有待删除变更，请先处理该发布再编辑。', 409, 'pending_deletion');
    const active = state.workspaces.find(item => item.meta?.kind === 'post' && item.meta.slug === article.slug);
    checkRevision(input.revision, postRevision(state.main, active, article.slug));
    const content = stringifyPost(article);
    if (state.textTotal - (active?.articleBytes || 0) + new TextEncoder().encode(content).length > MAX_TEXT_TOTAL) throw new ContentError('文章总大小超过后台读取限制，请先发布或整理现有草稿。', 413);
    const workspace = await workspaceFor(state, 'post', article.slug);
    const published = postEntry(state.main, article.slug), pending = postEntry(workspace, article.slug), draft = postEntry(workspace, article.slug, 'drafts');
    const ready = options.publish === true;
    const target = ready ? (published?.path || pending?.path || `src/content/posts/${article.slug}.md`) : (draft?.path || `src/content/drafts/${article.slug}.md`);
    const changes = [{ path: target, content }, ...imageChanges(state, workspace, [article])];
    if (ready && draft) changes.push({ path: draft.path, sha: null });
    if (!ready && pending?.sha !== published?.sha && pending) changes.push({ path: pending.path, sha: published?.sha || null });
    const pr = await writeChanges(workspace, changes, { title: `${ready ? '发布文章' : '草稿'}：${article.data.title || article.slug}`, ready });
    const fresh = await updatedState(state, [workspace]);
    return { state: visible(fresh), post: fresh.posts.find(post => post.slug === article.slug && post.branch === workspace.branch) || fresh.posts.find(post => post.slug === article.slug), ...(pr ? { release: release(pr) } : {}) };
  }
  async function confirmedDeletion(state, group) {
    const attempted = group.workspace;
    if (!attempted) return;
    const closed = pr => pr.state === 'closed' && !pr.merged && pr.head.sha === attempted.head;
    const current = state.workspaces.find(workspace => workspace.branch === attempted.branch);
    if (group.withdrawal || !current) {
      if (!attempted.pr || (!group.withdrawal && group.paths.some(path => attempted.entries.has(path)))) return;
      const pr = await api(`/pulls/${attempted.pr.number}`);
      if (closed(pr)) return { ...attempted, pr };
      return;
    }
    if (current.head !== attempted.head || JSON.stringify(current.meta) !== JSON.stringify(attempted.meta) || group.paths.some(path => current.entries.has(path))) return;
    if (group.closeEmpty && !current.files.length) {
      let pr;
      try { pr = await api(`/pulls/${current.pr.number}`, { method: 'PATCH', body: { state: 'closed' } }); }
      catch (error) { pr = await api(`/pulls/${current.pr.number}`); if (!closed(pr)) throw error; }
      return { ...current, pr };
    }
    return current;
  }
  async function deletionResult(state, groups) {
    const deleted = [], failed = [], updates = [], releases = [], failures = [];
    const completedGroup = (group, workspace) => {
      updates.push(workspace);
      if (workspace.pr) releases.push(release(workspace.pr));
      deleted.push(...group.items);
    };
    let completed = 0;
    await mapLimit(groups, 3, async group => {
      try {
        completedGroup(group, await group.work(group));
      } catch (error) {
        failures.push({ group, error });
      }
      progress(`已处理 ${++completed}/${groups.length} 组变更…`);
    });
    let fresh = await updatedState(state, updates), refreshRequired = false;
    if (failures.length) {
      const recovered = [];
      progress('正在确认已提交的删除结果…');
      try { fresh = await loadState(); } catch { refreshRequired = true; }
      for (const { group, error } of failures) {
        let confirmed;
        if (!refreshRequired) {
          try { confirmed = await confirmedDeletion(fresh, group); } catch { refreshRequired = true; }
        }
        if (confirmed) { completedGroup(group, confirmed); recovered.push(confirmed); }
        else failed.push(...group.items.map(item => ({ ...item, error: error.message, code: error.code, statusCode: error.status || 503 })));
      }
      fresh = await updatedState(fresh, recovered);
    }
    return { state: visible(fresh), deleted, failed, releases, release: releases.find(item => item.state === 'review') || releases[0], refreshRequired };
  }
  async function deletePosts(input) {
    const items = postSelection(input), state = await loadState(); writable(state);
    progress(`正在核对 ${items.length} 篇内容的版本…`);
    const staged = [], withdrawals = [];
    for (const item of items) {
      const current = state.posts.find(post => postKey(post) === postKey(item));
      if (!current) throw new ContentError(`文章版本 ${item.slug} 不存在，请刷新列表。`, 404);
      if (current.pendingDeletion) throw new ContentError('内容已有待删除变更，请在发布与连接中处理。', 409, 'pending_deletion');
      const activeWorkspaces = state.workspaces.filter(workspace => workspace.meta?.kind === 'post' && workspace.meta.slug === item.slug);
      if (activeWorkspaces.length > 1) throw new ContentError('同一内容存在多个待处理 PR，请先处理重复发布。', 409, 'conflict');
      const active = activeWorkspaces[0];
      checkRevision(item.revision, postRevision(state.main, active, item.slug));
      if (item.status === 'draft' && active) { withdrawals.push({ item, workspace: active }); continue; }
      const source = postEntry(state.main, item.slug, item.status === 'draft' ? 'drafts' : 'posts') || (item.status === 'draft' && state.main.legacyDraftSlugs.has(item.slug) ? postEntry(state.main, item.slug) : undefined);
      if (!source) throw new ContentError(`文章版本 ${item.slug} 不存在，请刷新列表。`, 404);
      staged.push({ item, source });
    }
    const groups = withdrawals.map(({ item, workspace }) => ({ items: [item], workspace, withdrawal: true, work: async () => ({ ...workspace, pr: await api(`/pulls/${workspace.pr.number}`, { method: 'PATCH', body: { state: 'closed' } }) }) }));
    if (staged.length) groups.unshift({ items: staged.map(value => value.item), paths: staged.map(({ source }) => source.path), work: async group => {
      const workspace = await workspaceFor(state, 'post-delete-batch');
      group.workspace = workspace;
      workspace.meta.items = staged.map(({ item }) => ({ slug: item.slug, status: item.status }));
      await writeChanges(workspace, staged.map(({ source }) => ({ path: source.path, sha: null })), { title: `删除 ${staged.length} 篇内容`, ready: true });
      return workspace;
    } });
    return deletionResult(state, groups);
  }
  async function deletePost(input) {
    const result = await deletePosts([input]);
    if (result.failed.length && !result.deleted.length) throw new ContentError(result.failed[0].error, result.failed[0].statusCode, result.failed[0].code);
    return { ...result, deleted: result.deleted[0] };
  }
  async function saveSettings(input) {
    const settings = validateSettings(input), state = await loadState(); writable(state);
    checkRevision(settings.revision, state.settings.revision);
    const workspace = await workspaceFor(state, 'settings');
    const pr = await writeChanges(workspace, [{ path: 'src/data/site.json', content: serializeSettings(settings) }, ...imageChanges(state, workspace, [], settings)], { title: '更新站点设置', ready: true });
    const fresh = await updatedState(state, [workspace]);
    return { state: visible(fresh), settings: fresh.settings, ...(pr ? { release: release(pr) } : {}) };
  }
  async function uploadMedia(file) {
    const image = await imageFile(file, deps), state = await loadState(); writable(state);
    const path = mediaPath(image.name);
    if (state.mediaSources.has(path)) throw new ContentError('同名图片已存在，请重新上传。', 409, 'conflict');
    const workspace = await workspaceFor(state, 'media');
    const previewUrl = createPreviewUrl(image.bytes, image.mime);
    try {
      const blob = await api('/git/blobs', { method: 'POST', body: { content: encode64(image.bytes), encoding: 'base64' } });
      rememberPreview(blob.sha, previewUrl, image.size);
      const pr = await writeChanges(workspace, [{ path, sha: blob.sha }], { title: '更新图片资源', ready: true });
      const fresh = await updatedState(state, [workspace]);
      return { state: visible(fresh), media: fresh.media.find(item => item.path === path), ...(pr ? { release: release(pr) } : {}) };
    } catch (error) { if (previewUrl.startsWith('blob:') && ![...previews.values()].some(entry => entry.url === previewUrl)) URL.revokeObjectURL(previewUrl); throw error; }
  }
  async function getMediaPreview(input) {
    requireAuth();
    if (input.path !== mediaPath(input.name)) throw new ContentError('图片路径不安全。');
    const state = lastState || await loadState();
    const source = state.mediaSources.get(input.path), current = state.media.find(item => item.path === input.path);
    if (!source || !current) throw new ContentError('图片不存在，请刷新媒体库。', 404);
    checkRevision(input.revision, source.entry.sha);
    const media = { ...current, url: source.pending ? await preview(source.entry) : current.url, previewPending: false };
    return { media };
  }
  async function deleteMediaBatch(input) {
    const items = mediaSelection(input), state = await loadState(); writable(state);
    progress(`正在核对 ${items.length} 张图片及引用…`);
    const published = [], pending = new Map();
    for (const item of items) {
      const current = state.media.find(media => media.path === item.path);
      if (!current) throw new ContentError(`图片 ${item.name} 不存在，请刷新媒体库。`, 404);
      if (current.pendingDeletion) throw new ContentError('图片已有待删除变更，请在发布与连接中处理。', 409, 'pending_deletion');
      checkRevision(item.revision, current.revision);
      const references = [...new Set(state.allSettings.flatMap(settings => findMediaReferences(current.publicUrl, state.allPosts, settings)))];
      if (references.length) throw new ContentError(`图片 ${item.name} 仍被${references.join('、')}引用，请先移除引用。`, 409, 'referenced_media');
      if (state.main.entries.has(current.path)) published.push(current);
      else {
        const workspace = state.workspaces.find(value => value.branch === current.branch && value.meta?.kind === 'media');
        if (!workspace) throw new ContentError(`图片 ${item.name} 属于其他待发布内容，请先处理相应 PR。`, 409);
        if (!pending.has(workspace.branch)) pending.set(workspace.branch, { workspace, items: [] });
        pending.get(workspace.branch).items.push(current);
      }
    }
    const groups = [...pending.values()].map(({ workspace: original, items }) => ({ items, paths: items.map(item => item.path), closeEmpty: true, work: async group => {
      const workspace = { ...original, entries: new Map(original.entries) };
      group.workspace = workspace;
      await writeChanges(workspace, items.map(item => ({ path: item.path, sha: null })), { title: '更新图片资源', ready: true });
      if (!workspace.files.length) workspace.pr = await api(`/pulls/${workspace.pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
      return workspace;
    } }));
    if (published.length) groups.unshift({ items: published, paths: published.map(item => item.path), work: async group => {
      const workspace = await workspaceFor(state, 'media-delete-batch');
      group.workspace = workspace;
      workspace.meta.names = published.map(item => item.name);
      await writeChanges(workspace, published.map(item => ({ path: item.path, sha: null })), { title: `删除 ${published.length} 张图片`, ready: true });
      return workspace;
    } });
    return deletionResult(state, groups);
  }
  async function deleteMedia(input) {
    const result = await deleteMediaBatch([input]);
    if (result.failed.length && !result.deleted.length) throw new ContentError(result.failed[0].error, result.failed[0].statusCode, result.failed[0].code);
    return { ...result, deleted: result.deleted[0] };
  }

  async function checkPublication(pr) {
    const meta = metadata(pr);
    if (!ownPr(pr) || !meta) throw new ContentError('此 PR 不属于后台管理的发布，请在 GitHub 中审核。');
    const [files, workspace] = await Promise.all([filesFor(pr, lastState?.main.head), snapshot(pr.head.ref, pr.head.sha)]);
    if (!files.length) throw new ContentError('此发布没有可合并的内容。');
    const removedImages = files.filter(file => file.filename.startsWith('public/images/posts/') && file.status === 'removed');
    if (removedImages.length) {
      const current = await loadState();
      for (const file of removedImages) {
        const references = [...new Set(current.allSettings.flatMap(settings => findMediaReferences(publicPath(file.filename), current.allPosts, settings)))];
        if (references.length) throw new ContentError(`待删图片仍被${references.join('、')}引用，请先移除引用。`, 409, 'referenced_media');
      }
    }
    let postDeletionPaths;
    if (meta.kind === 'post-delete-batch') {
      const current = await loadState();
      postDeletionPaths = new Set(meta.items.map(item => {
        const entry = postEntry(current.main, item.slug, item.status === 'draft' ? 'drafts' : 'posts') || (item.status === 'draft' && current.main.legacyDraftSlugs.has(item.slug) ? postEntry(current.main, item.slug) : undefined);
        if (!entry) throw new ContentError('待删除文章版本不存在或已变化，请刷新后重新核对。', 409, 'conflict');
        return entry.path;
      }));
    }
    const allowed = file => {
      const name = file.filename;
      if (meta.kind === 'post-delete-batch') return file.status === 'removed' && postDeletionPaths.has(name);
      if (meta.kind === 'media-delete-batch') return file.status === 'removed' && meta.names.some(value => name === mediaPath(value));
      if (name.startsWith('public/images/posts/')) return managedPath(name);
      if (meta.kind === 'settings') return name === 'src/data/site.json';
      if (meta.kind === 'media') return false;
      return name === `src/content/posts/${meta.slug}.md` || name === `src/content/posts/${meta.slug}.mdx` || ((name === `src/content/drafts/${meta.slug}.md` || name === `src/content/drafts/${meta.slug}.mdx`) && file.status === 'removed');
    };
    if (!files.every(allowed)) throw new ContentError('PR 包含草稿或超出当前发布范围的文件，无法自动合并。');
    if (meta.kind === 'post') {
      const entry = postEntry(workspace, meta.slug);
      if (!entry || postEntry(workspace, meta.slug, 'drafts')) throw new ContentError('文章仍是草稿，请先准备发布。');
      const article = parsePost(await text(entry), meta.slug);
      if (article.status !== 'published') throw new ContentError('文章仍是草稿，请先准备发布。');
      validatePost(article, { publish: true });
      assertImagesExist(article, workspace);
    }
    if (meta.kind === 'settings') {
      const settings = validateSettings(JSON.parse(await text(workspace.entries.get('src/data/site.json'))));
      assertImagesExist(settings, workspace);
    }
    for (const file of files) if (file.filename.startsWith('public/images/posts/') && file.status !== 'removed') {
      const entry = workspace.entries.get(file.filename);
      inspectMediaBytes(await bytes(entry, MAX_IMAGE_BYTES), file.filename.split('/').at(-1));
      blobs.delete(entry.sha);
    }
    return workspace;
  }
  function assertImagesExist(value, workspace) {
    const source = normalizePercentEncoding(JSON.stringify(value));
    for (const match of source.matchAll(/\/images\/posts\/([a-zA-Z0-9._-]+\.(?:png|jpe?g|gif|webp|avif))/gi)) if (!workspace.entries.has(mediaPath(match[1]))) throw new ContentError(`图片 ${match[1]} 尚未包含在当前发布中。`);
  }
  async function publishRelease(input) {
    if (!Number.isInteger(input.id) || input.id < 1 || typeof input.sha !== 'string') throw new ContentError('发布版本格式不正确，请刷新列表。');
    const pr = await api(`/pulls/${input.id}`);
    if (pr.head.sha !== input.sha || pr.head.ref !== input.branch) conflict();
    if (pr.state !== 'open' || pr.draft) throw new ContentError('此发布仍是草稿或已关闭，请先准备发布。');
    progress('正在核对发布内容与构建检查…');
    const [, checks, statuses] = await Promise.all([checkPublication(pr), pages(`/commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs'), pages(`/commits/${pr.head.sha}/status`, 'statuses')]);
    if (!checks.length && !statuses.length) throw new ContentError('此提交尚无构建检查结果，无法确认可以发布。', 409, 'checks_pending');
    if (checks.some(check => check.status !== 'completed') || statuses.some(item => item.state === 'pending')) throw new ContentError('发布检查仍在运行，请等待完成后重试。', 409, 'checks_pending');
    if (checks.some(check => !['success', 'neutral', 'skipped'].includes(check.conclusion)) || statuses.some(item => item.state !== 'success')) throw new ContentError('发布检查未通过，请打开 PR 查看失败原因。', 409, 'checks_failed');
    if (pr.mergeable !== true || pr.mergeable_state !== 'clean') throw new ContentError('GitHub 分支保护、评审或合并条件尚未满足，请打开 PR 处理。', 409, 'merge_blocked');
    progress('检查已通过，正在合并发布…');
    const result = await api(`/pulls/${pr.number}/merge`, { method: 'PUT', body: { sha: pr.head.sha, merge_method: 'merge' } });
    if (!result.merged) throw new ContentError('GitHub 未完成合并，请打开 PR 检查保护条件。', 409, 'merge_blocked');
    const state = lastState || await loadState();
    const main = await snapshot(branch, result.sha);
    const fresh = await updatedState(state, state.workspaces.filter(item => item.pr.number === pr.number).map(item => ({ ...item, pr: { ...item.pr, state: 'closed' } })), main);
    return { state: visible(fresh), release: { ...release(pr), state: 'merged', mergeSha: result.sha, detail: '代码已合并。站点部署结果请查看 Cloudflare 的部署记录。' } };
  }

  function login() {
    configured();
    if (!browser) return Promise.reject(new ContentError('登录需要在浏览器写作后台中操作。'));
    if (loginPromise) return loginPromise;
    const auth = new URL('/auth', config.authUrl); auth.searchParams.set('origin', browser.location.origin);
    const popup = browser.open(auth.href, 'huaovo-github-login', 'popup=yes,width=620,height=720');
    if (!popup) return Promise.reject(new ContentError('登录窗口被浏览器拦截，请允许弹出窗口后重试。'));
    loginPromise = new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timeout); clearInterval(closed); browser.removeEventListener('message', receive); cancelLogin = undefined; popup.close(); loginPromise = undefined; error ? reject(error) : resolve({ ...connection(false), authenticated: true, label: 'GitHub 已授权', detail: '正在读取仓库内容与写入权限。' }); };
      const receive = event => {
        if (event.origin !== auth.origin || event.source !== popup || typeof event.data !== 'string') return;
        if (event.data === 'authorizing:github') { popup.postMessage('authorizing:github', auth.origin); return; }
        const prefix = 'authorization:github:';
        if (!event.data.startsWith(prefix)) return;
        const message = event.data.slice(prefix.length), separator = message.indexOf(':');
        if (separator === -1) return;
        try {
          const state = message.slice(0, separator), payload = JSON.parse(message.slice(separator + 1));
          if (state !== 'success' || payload.provider !== 'github' || typeof payload.token !== 'string' || !payload.token || payload.token.length > 4096 || /\s/.test(payload.token)) { finish(new ContentError('GitHub 授权未完成，请重新登录。', 401, 'authentication')); return; }
          token = payload.token; try { session?.setItem(tokenKey, token); } catch { /* keep token only in memory */ }
          finish();
        } catch { finish(new ContentError('登录服务返回了无效信息，请重新登录。')); }
      };
      browser.addEventListener('message', receive);
      const timeout = setTimeout(() => finish(new ContentError('GitHub 登录已超时，请重新登录。')), 120000);
      const closed = setInterval(() => { if (popup.closed) finish(new ContentError('GitHub 登录窗口已关闭。')); }, 500);
      cancelLogin = () => finish(new ContentError('登录已取消。'));
    });
    return loginPromise;
  }
  function logout() {
    cancelLogin?.(); token = ''; try { session?.removeItem(tokenKey); } catch { /* memory-only token cleared */ }
    for (const entry of previews.values()) if (entry.url.startsWith('blob:')) URL.revokeObjectURL(entry.url);
    previews.clear(); blobs.clear(); snapshots.clear(); fileLists.clear(); lastState = undefined;
  }
  return {
    async load() { await mutationQueue; if (!token) return { posts: [], settings: null, media: [], releases: [], connection: connection(false) }; return visible(await loadState()); },
    savePost: (post, options) => mutate(() => savePost(post, options)),
    deletePost: post => mutate(() => deletePost(post)),
    deletePosts: posts => mutate(() => deletePosts(posts)),
    saveSettings: settings => mutate(() => saveSettings(settings)),
    uploadMedia: file => mutate(() => uploadMedia(file)),
    deleteMedia: media => mutate(() => deleteMedia(media)), getMediaPreview,
    deleteMediaBatch: media => mutate(() => deleteMediaBatch(media)),
    publishRelease: value => mutate(() => publishRelease(value)), login, logout,
  };
}
