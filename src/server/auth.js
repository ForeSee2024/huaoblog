import { ContentError } from '../admin/content-model.js';

const COOKIE = 'huaovo_session';
const loopback = url => ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function tokenFrom(request) {
  const value = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function createAuth(database, config, deps = {}) {
  const now = deps.now || Date.now;
  const fetcher = deps.fetch || globalThis.fetch.bind(globalThis);
  const ownerId = String(config.githubUserId || '');
  const ttl = Math.max(300, Math.min(365 * 86400, Number(config.sessionTtlSeconds) || 365 * 86400));
  const renewIntervalMs = Math.max(60 * 1000, Math.min(24 * 3600 * 1000, Math.floor((ttl * 1000) / 4)));
  const dev = request => config.deployment === 'node' && config.devAuth === true && loopback(new URL(request.url)) && loopback(new URL(config.siteUrl));
  const cookie = (value, request, maxAge = ttl) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
  async function authenticateSession(request, { renew = true } = {}) {
    if (dev(request)) return { user: { id: ownerId, login: 'local-owner', local: true }, cookie: null };
    const token = tokenFrom(request);
    if (!token) return { user: null, cookie: null };
    const tokenHash = await sha256(token);
    const [session] = await database.all('SELECT user_id, login, expires_at FROM auth_sessions WHERE token_hash = ?', [tokenHash]);
    const currentNow = now();
    if (!session || session.expires_at <= currentNow || session.user_id !== ownerId) return { user: null, cookie: null };
    const user = { id: session.user_id, login: session.login };
    const nextExpiresAt = currentNow + ttl * 1000;
    if (renew && nextExpiresAt - session.expires_at >= renewIntervalMs) {
      await database.batch([{ sql: 'UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?', params: [nextExpiresAt, tokenHash, currentNow] }]);
      return { user, cookie: cookie(token, request, ttl) };
    }
    return { user, cookie: null };
  }
  return {
    ttlSeconds: ttl,
    assertSameOrigin(request) {
      const url = new URL(request.url);
      if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ContentError('请求来源无效，请从本站后台重新操作。', 403, 'origin');
      if (url.protocol !== 'https:' && !dev(request)) throw new ContentError('管理操作需要 HTTPS。', 403, 'origin');
    },
    authenticateSession,
    async authenticate(request) {
      const { user } = await authenticateSession(request, { renew: false });
      return user;
    },
    async login(token, request) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 512 || !/^[a-zA-Z0-9_]+$/.test(token)) throw new ContentError('登录凭据无效，请重新登录。', 401, 'authentication');
      let response;
      try { response = await fetcher('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'HuaOvO-Content', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000), redirect: 'manual' }); }
      catch { throw new ContentError('暂时无法验证 GitHub 身份，请稍后重试。', 503, 'authentication'); }
      if (!response.ok) throw new ContentError('GitHub 登录已失效，请重新登录。', 401, 'authentication');
      const user = await response.json();
      if (!ownerId || String(user.id) !== ownerId) throw new ContentError('此账号没有博客管理权限。', 403, 'permission');
      const secret = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      await database.batch([
        { sql: 'DELETE FROM auth_sessions WHERE expires_at <= ?', params: [now()] },
        { sql: 'INSERT INTO auth_sessions (token_hash, user_id, login, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', params: [await sha256(secret), ownerId, String(user.login || ''), now(), now() + ttl * 1000] },
      ]);
      return { user: { id: ownerId, login: String(user.login || '') }, cookie: cookie(secret, request) };
    },
    async logout(request) {
      const token = tokenFrom(request);
      if (token) await database.batch([{ sql: 'DELETE FROM auth_sessions WHERE token_hash = ?', params: [await sha256(token)] }]);
      return cookie('', request, 0);
    },
  };
}
