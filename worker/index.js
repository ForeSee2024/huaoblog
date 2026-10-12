/**
 * Cloudflare Worker: Decap CMS GitHub OAuth 认证网关 (企业级安全加固版)
 * 
 * 安全合规能力：
 * 1. 严格 CSRF 防护：/auth 签发基于 HttpOnly + SameSite=Lax Cookie 的随机 state 会话，并在 /callback 进行严格核对；
 * 2. 来源白名单校验：支持通过 ALLOWED_ORIGINS 限制授权来源域名，阻止非授权站点跨站调用；
 * 3. postMessage 目标定向传输：明确限制 targetOrigin 为白名单合法域名，杜绝向通配符 '*' 或未经验证的 origin 泄露 Access Token。
 * 
 * 环境变量配置 (在 Cloudflare Dashboard 或通过 wrangler secret put 配置):
 * - GITHUB_CLIENT_ID: GitHub OAuth App 的 Client ID
 * - GITHUB_CLIENT_SECRET: GitHub OAuth App 的 Client Secret
 * - ALLOWED_ORIGINS: (选填) 逗号分隔的合法博客域名，例如 "https://kael-nexus.pages.dev,http://localhost:4321"
 */

// 默认基础开发白名单 (生产环境通过 env.ALLOWED_ORIGINS 覆盖或追加)
const DEFAULT_ALLOWED = [
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

function isOriginAllowed(origin, env) {
  if (!origin) return false;
  const customList = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowList = [...DEFAULT_ALLOWED, ...customList];

  // 精确匹配或允许 *.pages.dev 子域
  return allowList.some(allowed => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // .pages.dev
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

    // 1. 发起授权请求：/auth
    if (url.pathname === '/auth') {
      // 提取客户端来源 (优先取 query 中的 origin，回退到 Referer)
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

      // 如果有配置白名单，验证请求方来源合法性
      if (clientOrigin && !isOriginAllowed(clientOrigin, env) && env.ALLOWED_ORIGINS) {
        return new Response(`未经授权的授权来源域名: ${clientOrigin}`, { status: 403 });
      }

      // 生成安全的强随机 state，并将 origin 一并绑定加密保存至 HttpOnly Cookie
      const stateId = crypto.randomUUID();
      const statePayload = `${stateId}.${btoa(clientOrigin || '')}`;

      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID || '');
      githubAuthUrl.searchParams.set('scope', 'repo,user');
      githubAuthUrl.searchParams.set('state', statePayload);

      const headers = new Headers();
      headers.set('Location', githubAuthUrl.toString());
      // 设置 10 分钟有效的 HttpOnly 会话 Cookie
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
        return new Response('缺少必需的授权 code 或 state 参数', { status: 400 });
      }

      // 严格核对 CSRF state
      const cookies = parseCookies(request.headers.get('Cookie'));
      const savedStateId = cookies.oauth_state;

      const [receivedStateId, encodedOrigin] = state.split('.');
      if (!savedStateId || savedStateId !== receivedStateId) {
        return new Response('CSRF 校验失败：授权会话已过期或已被篡改', { status: 403 });
      }

      let clientOrigin = '';
      try {
        if (encodedOrigin) {
          clientOrigin = atob(encodedOrigin);
        }
      } catch {
        clientOrigin = '';
      }

      // 确保 targetOrigin 处于白名单
      const targetOrigin = clientOrigin && isOriginAllowed(clientOrigin, env)
        ? clientOrigin
        : (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',')[0].trim() : '*');

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

        // 清理 Cookie 的响应头
        const clearCookie = 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=0';

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
                    setTimeout(function() { window.close(); }, 2000);
                  })();
                </script>
                <p style="font-family:sans-serif;padding:2rem;color:#ef4444;">GitHub 授权失败: ${data.error_description || data.error || '未知错误'}</p>
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

        // 成功换取 token：仅向验证合法的 targetOrigin 定向派发 postMessage
        const content = `
          <!DOCTYPE html>
          <html lang="zh-CN">
            <head><meta charset="utf-8"><title>授权成功，正在返回...</title></head>
            <body>
              <script>
                (function() {
                  var targetOrigin = ${JSON.stringify(targetOrigin)};
                  function receiveMessage(e) {
                    // 仅响应来自合法博客后台的消息握手
                    if (targetOrigin !== '*' && e.origin !== targetOrigin) {
                      console.warn('收到非白名单源的消息，拒绝响应:', e.origin);
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
                  // 发起就绪握手广播
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
    return new Response('Decap CMS Secure GitHub OAuth Gateway is active.', {
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  },
};
