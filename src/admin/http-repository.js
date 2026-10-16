import { ContentError, MAX_IMAGE_BYTES, validatePost, validateSlug, validateMediaName } from './content-model.js';
import { postSelection, mediaSelection } from './bulk-model.js';
import { validateSettings } from './settings-model.js';

function revision(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new ContentError('内容版本尚未读取，请刷新后重新操作。', 409, 'conflict');
  return value;
}
function historyTarget(kind, id) {
  if (kind === 'post') validateSlug(id);
  else if (kind !== 'settings' || id !== 'site') throw new ContentError('历史记录类型或路径无效。');
  return { kind, id };
}
function uploadFile(file, image = false) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string' || !file.size) throw new ContentError('请选择有效的文件。');
  if (image && (file.size > MAX_IMAGE_BYTES || !/\.(png|jpe?g|webp|gif|avif)$/i.test(file.name))) throw new ContentError('请选择不超过 10 MB 的 PNG、JPG、WebP、GIF 或 AVIF 图片。', 413);
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}

/** Same-origin content service. GitHub credentials exist only during the session exchange. */
export function createHttpRepository(config, deps = {}) {
  // Retire credentials left by the previous Git publishing backend after migration.
  try { (deps.sessionStorage || globalThis.sessionStorage)?.removeItem(`huaovo:${config.repo}:github-token`); } catch { /* storage can be unavailable */ }
  const base = String(config.apiUrl || '/api/v1').replace(/\/$/, '');
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(base)) throw new ContentError('内容 API 必须使用安全的同源路径。', 503, 'configuration');
  const fetcher = deps.fetch || globalThis.fetch.bind(globalThis);
  const browser = deps.window || globalThis.window;
  let mutationQueue = Promise.resolve(), loginPromise, cancelLogin;
  const mutate = work => {
    const result = mutationQueue.then(work);
    mutationQueue = result.catch(() => {});
    return result;
  };
  async function request(path, { method = 'GET', body, binary = false } = {}) {
    const multipart = body instanceof FormData;
    let response;
    try {
      response = await fetcher(base + path, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: binary ? 'application/octet-stream, application/json' : 'application/json', ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(binary ? 120000 : 30000),
      });
    } catch {
      throw new ContentError(method === 'GET' ? '内容服务无法连接，请检查网络后重试。' : '未能确认操作结果，请刷新工作区核对内容后重试。', 503, 'connection');
    }
    if (response.ok && binary) return response;
    let data;
    try { data = response.status === 204 ? {} : await response.json(); }
    catch { throw new ContentError(method === 'GET' ? '内容服务返回了无效响应，请重试。' : '未能确认操作结果，请刷新工作区核对内容。', 502, 'invalid_response'); }
    if (!response.ok) throw new ContentError(data.error || '内容操作未完成，请重试。', response.status, data.code || 'content_error');
    return data;
  }
  async function deleteBatches(kind, selected) {
    const posts = kind === 'posts', items = posts ? postSelection(selected) : mediaSelection(selected);
    items.forEach(item => revision(item.revision));
    const groups = new Map();
    for (const item of items) {
      const key = posts ? item.slug : item.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const batches = [[]];
    for (const group of groups.values()) {
      if (batches.at(-1).length + group.length > 3) batches.push([]);
      batches.at(-1).push(...group);
    }
    const result = { deleted: [], failed: [], releases: [], state: undefined };
    for (let index = 0; index < batches.length; index++) {
      // Both versions of a slug share a batch; other identities keep the reviewed guard.
      const batch = batches[index];
      deps.onProgress?.(`正在删除第 ${index + 1} / ${batches.length} 批内容…`);
      try {
        const response = await request(`/${kind}/delete`, { method: 'POST', body: { [kind]: batch } });
        if (!Array.isArray(response.deleted) || !Array.isArray(response.failed) || !response.state) throw new ContentError('未能确认删除结果，请刷新工作区后核对。', 502, 'invalid_response');
        result.deleted.push(...response.deleted); result.failed.push(...response.failed); result.state = response.state;
      } catch (error) {
        result.failed.push(...batch.map(item => ({ ...item, error: `${error.message} 请刷新工作区核对结果。`, code: error.code || 'content_error' })), ...batches.slice(index + 1).flat().map(item => ({ ...item, error: '前一批未完成确认，此项尚未处理，请刷新工作区后重试。', code: 'not_attempted' })));
        result.refreshRequired = true;
        break;
      }
    }
    return result;
  }
  function login() {
    if (loginPromise) return loginPromise;
    if (!browser) return Promise.reject(new ContentError('请在浏览器管理后台中登录。'));
    let auth;
    try {
      auth = new URL('/auth', config.authUrl);
      const configured = new URL(config.authUrl);
      if (configured.protocol !== 'https:' || configured.username || configured.password) throw new Error();
      auth.searchParams.set('origin', browser.location.origin);
      auth.searchParams.set('identity', '1');
    } catch { return Promise.reject(new ContentError('GitHub 登录服务必须配置为完整的 HTTPS 地址。', 503, 'configuration')); }
    const popup = browser.open(auth.href, 'huaovo-github-login', 'popup=yes,width=620,height=720');
    if (!popup) return Promise.reject(new ContentError('登录窗口被浏览器拦截，请允许弹出窗口后重试。'));
    loginPromise = new Promise((resolve, reject) => {
      let settled = false, exchanging = false;
      const cleanup = () => { clearTimeout(timeout); clearInterval(closed); browser.removeEventListener('message', receive); popup.close(); };
      const finish = (error, connection) => {
        if (settled) return;
        settled = true;
        cleanup(); cancelLogin = undefined; loginPromise = undefined;
        error ? reject(error) : resolve(connection);
      };
      const receive = event => {
        if (exchanging || event.origin !== auth.origin || event.source !== popup || typeof event.data !== 'string') return;
        if (event.data === 'authorizing:github') { popup.postMessage('authorizing:github', auth.origin); return; }
        const prefix = 'authorization:github:';
        if (!event.data.startsWith(prefix)) return;
        const message = event.data.slice(prefix.length), separator = message.indexOf(':');
        if (separator === -1) return;
        let payload;
        try {
          payload = JSON.parse(message.slice(separator + 1));
          if (message.slice(0, separator) !== 'success' || payload?.provider !== 'github' || typeof payload.token !== 'string' || !payload.token || payload.token.length > 4096 || /\s/.test(payload.token)) throw new Error();
        } catch { finish(new ContentError('GitHub 授权未完成，请重新登录。', 401, 'authentication')); return; }
        exchanging = true;
        cleanup();
        deps.onProgress?.('正在验证管理员身份…');
        const secret = payload.token;
        mutate(() => request('/session', { method: 'POST', body: { token: secret } })).then(result => finish(null, result.connection), finish);
        payload = undefined;
      };
      browser.addEventListener('message', receive);
      const timeout = setTimeout(() => finish(new ContentError('GitHub 登录已超时，请重新登录。')), 120000);
      const closed = setInterval(() => { if (popup.closed && !exchanging) finish(new ContentError('GitHub 登录窗口已关闭。')); }, 500);
      cancelLogin = () => finish(new ContentError('登录已取消。'));
    });
    return loginPromise;
  }
  return {
    async load() { await mutationQueue; return request('/content'); },
    getPost(slug, status = 'draft') {
      validateSlug(slug);
      if (!['published', 'draft'].includes(status)) return Promise.reject(new ContentError('文章版本无效。'));
      return request(`/posts/${encodeURIComponent(slug)}?status=${status}`);
    },
    savePost: (post, options = {}) => mutate(() => {
      if (post?.bodyLoaded === false) throw new ContentError('请先读取完整正文，再保存文章。');
      return request('/posts', { method: 'POST', body: { post: validatePost(post, options), publish: options.publish === true } });
    }),
    deletePost(post) { return this.deletePosts([post]); },
    deletePosts: posts => mutate(() => deleteBatches('posts', posts)),
    saveSettings: settings => mutate(() => request('/settings', { method: 'PUT', body: { settings: validateSettings(settings) } })),
    uploadMedia: file => mutate(() => request('/media', { method: 'POST', body: uploadFile(file, true) })),
    async getMediaPreview(media) {
      const name = validateMediaName(media?.name), path = `public/images/posts/${name}`, url = `/images/posts/${name}`;
      if (media.path !== path) throw new ContentError('图片路径不安全。');
      return { media: { ...media, publicUrl: url, url, previewPending: false } };
    },
    deleteMedia(media) { return this.deleteMediaBatch([media]); },
    deleteMediaBatch: media => mutate(() => deleteBatches('media', media)),
    getTrash: () => request('/trash'),
    restoreTrash: (kind, item) => mutate(() => {
      const selected = kind === 'post' ? postSelection([item])[0] : kind === 'media' ? mediaSelection([item])[0] : null;
      if (!selected) throw new ContentError('恢复内容类型无效。');
      revision(selected.revision);
      return request('/trash/restore', { method: 'POST', body: { kind, item: selected } });
    }),
    getHistory(kind, id) {
      historyTarget(kind, id);
      return request(`/history?kind=${kind}&id=${encodeURIComponent(id)}`);
    },
    restoreRevision: (kind, id, selectedRevision, expectedRevision) => mutate(() => request('/history/restore', {
      method: 'POST', body: { ...historyTarget(kind, id), revision: revision(selectedRevision), expectedRevision: revision(expectedRevision) },
    })),
    async exportBackup() {
      const response = await request('/backups/export', { binary: true });
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-tar') {
        await response.body?.cancel().catch(() => {});
        throw new ContentError('服务未返回包含图片文件的完整备份，请检查备份格式后重试。', 502, 'invalid_backup');
      }
      const candidate = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1];
      const filename = candidate && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(candidate) ? candidate : 'huaovo-content-backup.tar';
      try { return { blob: await response.blob(), filename }; }
      catch { throw new ContentError('完整备份未能下载完成，请重新导出。', 503, 'connection'); }
    },
    async validateBackup(file) {
      if (file?.size > 32 * 1024 * 1024) throw new ContentError('浏览器预检支持不超过 32 MB 的备份，更大的备份请通过部署命令校验。', 413);
      return request('/backups/validate', { method: 'POST', body: uploadFile(file) });
    },
    getSession: () => request('/session'),
    login,
    async logout() { cancelLogin?.(); await mutationQueue; return request('/session', { method: 'DELETE' }); },
  };
}
