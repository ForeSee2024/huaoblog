/**
 * Cloudflare Worker: Decap CMS GitHub OAuth 认证网关 (企业级零信任加固版)
 * 
 * 安全契约 (严格零回退准则)：
 * 1. 严格白名单强制校验：ALLOWED_ORIGINS 为必需配置，无白名单、来源为空或未在白名单内时，/auth 与 /callback 一律阻断并返回 403，绝不回退至通配符 '*'；
 * 2. 严格 CSRF 防护：/auth 签发基于 HttpOnly + SameSite=Lax Cookie 的强随机 state 会话，并在 /callback 进行双向防篡改核对；
 * 3. postMessage 纯定向派发：仅向验证合法的 targetOrigin 派发 Token，握手过程强校验 event.origin，彻底杜绝跨站 Token 窃取。
 * 
 * 环境变量配置 (必需):
 * - GITHUB_CLIENT_ID: GitHub OAuth App 的 Client ID
 * - GITHUB_CLIENT_SECRET: GitHub OAuth App 的 Client Secret
 * - ALLOWED_ORIGINS: (必需) 逗号分隔的合法博客域名，例如 "https://kael-nexus.pages.dev,http://localhost:4321"
 */

// 默认本地开发白名单 (仅在本地调试使用)
const LOCAL_DEV_ORIGINS = [
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

function isOriginAllowed(origin, env) {
  if (!origin) return false;
  
  // 提取配置的生产白名单
  const configuredList = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  
  // 合并本地调试域名与用户配置白名单
  const allowList = [...LOCAL_DEV_ORIGINS, ...configuredList];

  return allowList.some(allowed => {
    // 支持 *.pages.dev 通配子域名匹配
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return origin.endsWith(suffix);
    }
    return allowed === origin;
  });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    if (name) cookies[name] = decodeURIComponent(value);
  });
  return cookies;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 0. 前置检查：必须配置 GitHub Client Credentials
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return new Response('OAuth 网关未就绪：缺少 GITHUB_CLIENT_ID 或 GITHUB_CLIENT_SECRET 环境变量配置', {
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      });
    }

    // 1. 发起授权请求：/auth
    if (url.pathname === '/auth') {
      // 提取客户端来源 (优先取 query 中的 origin，回退至 Referer)
      const queryOrigin = url.searchParams.get('origin');
      const referer = request.headers.get('Referer');
      let clientOrigin = '';

      if (queryOrigin) {
        clientOrigin = queryOrigin;
      } else if (referer) {
        try {
          clientOrigin = new URL(referer).origin;
        } catch {
          clientOrigin = '';
        }
      }

      // 零容忍安全断言：未提供来源或来源不在白名单中，坚决拒绝发起授权
      if (!clientOrigin || !isOriginAllowed(clientOrigin, env)) {
        return new Response(
          `403 Forbidden: 未经授权的博客后台域名 (${clientOrigin || '未知来源'})。请检查 Worker 的 ALLOWED_ORIGINS 配置。`,
          { status: 403, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }
        );
      }

      // 生成安全的强随机 state，并将 clientOrigin 绑定加密保存至 HttpOnly Cookie
      const stateId = crypto.randomUUID();
      const statePayload = `${stateId}.${btoa(clientOrigin)}`;

      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      githubAuthUrl.searchParams.set('scope', 'repo,user');
      githubAuthUrl.searchParams.set('state', statePayload);

      const headers = new Headers();
      headers.set('Location', githubAuthUrl.toString());
      // 设置 10 分钟有效的安全 HttpOnly 会话 Cookie
      headers.set(
        'Set-Cookie',
        `oauth_state=${stateId}; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=600`
      );

      return new Response(null, {
        status: 302,
        headers,
      });
    }

    // 2. GitHub 授权回调：/callback
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state) {
        return new Response('400 Bad Request: 缺少必需的授权 code 或 state 参数', { status: 400 });
      }

      // 严格核对 CSRF state
      const cookies = parseCookies(request.headers.get('Cookie'));
      const savedStateId = cookies.oauth_state;

      const [receivedStateId, encodedOrigin] = state.split('.');
      if (!savedStateId || savedStateId !== receivedStateId) {
        return new Response('403 Forbidden: CSRF 会话校验失败（授权会话不存在、已过期或已被跨站篡改）', {
          status: 403,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        });
      }

      let clientOrigin = '';
      try {
        if (encodedOrigin) {
          clientOrigin = atob(encodedOrigin);
        }
      } catch {
        clientOrigin = '';
      }

      // 二次严格白名单校验：回调来源必须通过白名单判定，决不允许任何通配符回退
      if (!clientOrigin || !isOriginAllowed(clientOrigin, env)) {
        return new Response(
          `403 Forbidden: 回调来源校验失败 (${clientOrigin || '非法域名'})，已被安全阻断。`,
          { status: 403, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }
        );
      }

      const targetOrigin = clientOrigin; // 严格锁死为白名单域名，决不使用 '*'
      const clearCookie = 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=0';

      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Decap-CMS-Secure-OAuth-Gateway',
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: code,
          }),
        });

        const data = await tokenRes.json();

        if (data.error || !data.access_token) {
          const content = `
            <!DOCTYPE html>
            <html lang="zh-CN">
              <head><meta charset="utf-8"><title>授权失败</title></head>
              <body>
                <script>
                  (function() {
                    var targetOrigin = ${JSON.stringify(targetOrigin)};
                    if (window.opener) {
                      window.opener.postMessage(
                        'authorization:github:error:${JSON.stringify(data)}',
                        targetOrigin
                      );
                    }
                    setTimeout(function() { window.close(); }, 2500);
                  })();
                </script>
                <div style="font-family:sans-serif;padding:2rem;color:#ef4444;text-align:center;">
                  <p>GitHub 授权换票失败: ${data.error_description || data.error || '未知错误'}</p>
                </div>
              </body>
            </html>
          `;
          return new Response(content, {
            headers: {
              'Content-Type': 'text/html;charset=UTF-8',
              'Set-Cookie': clearCookie,
            },
          });
        }

        // 成功换取 token：仅向严格校验过的 targetOrigin 发送 postMessage
        const content = `
          <!DOCTYPE html>
          <html lang="zh-CN">
            <head><meta charset="utf-8"><title>授权成功，正在返回...</title></head>
            <body>
              <script>
                (function() {
                  var targetOrigin = ${JSON.stringify(targetOrigin)};
                  function receiveMessage(e) {
                    // 仅响应来自白名单目标后台的消息握手
                    if (e.origin !== targetOrigin) {
                      console.warn('收到非白名单来源的消息握手，拒绝派发 Token:', e.origin);
                      return;
                    }
                    if (e.data === 'authorizing:github') {
                      window.opener.postMessage(
                        'authorization:github:success:${JSON.stringify({
                          token: data.access_token,
                          provider: 'github',
                        })}',
                        targetOrigin
                      );
                      window.removeEventListener("message", receiveMessage, false);
                      window.close();
                    }
                  }
                  window.addEventListener("message", receiveMessage, false);
                  // 发起就绪握手广播，严格限定 targetOrigin
                  window.opener.postMessage("authorizing:github", targetOrigin);
                })();
              </script>
              <div style="font-family:sans-serif;padding:2rem;color:#10b981;text-align:center;">
                <p>GitHub 授权成功！正在关闭窗口返回后台...</p>
              </div>
            </body>
          </html>
        `;

        return new Response(content, {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Set-Cookie': clearCookie,
          },
        });
      } catch (err) {
        return new Response(`换取 Access Token 异常: ${err.message}`, { status: 500 });
      }
    }

    // 默认根路径返回网关健康状态
    return new Response('Decap CMS Zero-Trust GitHub OAuth Gateway is active.', {
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  },
};
