/**
 * Cloudflare Worker: Decap CMS GitHub OAuth 认证网关 (完整会话绑定与常数时间比对版)
 * 
 * 安全合规能力：
 * 1. 严格全量 state 会话绑定：/auth 生成的 stateId 与 clientOrigin 完整写入 HttpOnly Cookie，并在 /callback 使用 Web Crypto 常数时间比对 (timingSafeEqual)，防范 CSRF 与时序侧信道攻击；
 * 2. 来源严格信任自 Cookie：目标 origin 统一从经过防篡改核验的 Cookie state 中解析，决不盲从 URL 参数；
 * 3. 严格精确白名单：ALLOWED_ORIGINS 为必需配置，禁止通配符 *.pages.dev，无默认本地后门；
 * 4. postMessage 纯定向传输：仅向白名单内的目标域名定向派发 Token，杜绝跨站 Token 窃取。
 * 
 * 环境变量配置 (必需):
 * - GITHUB_CLIENT_ID: GitHub OAuth App 的 Client ID
 * - GITHUB_CLIENT_SECRET: GitHub OAuth App 的 Client Secret
 * - ALLOWED_ORIGINS: (必需) 逗号分隔的精确博客后台域名，例如 "https://kael-nexus.pages.dev,http://localhost:4321"
 */

function isOriginAllowed(origin, env) {
  if (!origin || !env.ALLOWED_ORIGINS) return false;
  
  const allowList = env.ALLOWED_ORIGINS
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return allowList.includes(origin);
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

/**
 * 使用 Web Crypto API 的 timingSafeEqual 进行常数时间字符串比对
 * 避免因短路比对引起的时序侧信道攻击
 */
async function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 0. 前置严格检查：必需环境变量
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return new Response('500 Internal Error: 缺少 GITHUB_CLIENT_ID 或 GITHUB_CLIENT_SECRET 环境变量配置', {
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      });
    }

    if (!env.ALLOWED_ORIGINS || !env.ALLOWED_ORIGINS.trim()) {
      return new Response('500 Internal Error: 必需配置 ALLOWED_ORIGINS 环境变量以确保来源白名单安全', {
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      });
    }

    // 1. 发起授权请求：/auth
    if (url.pathname === '/auth') {
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

      // 严格白名单前置断言
      if (!clientOrigin || !isOriginAllowed(clientOrigin, env)) {
        return new Response(
          `403 Forbidden: 未经授权的博客后台域名 (${clientOrigin || '未知来源'})。必须显式配置在 Worker 的 ALLOWED_ORIGINS 白名单中。`,
          { status: 403, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }
        );
      }

      // 生成安全的强随机 state，并将 clientOrigin 完整绑定保存至 HttpOnly 会话 Cookie
      const stateId = crypto.randomUUID();
      const fullState = `${stateId}.${btoa(clientOrigin)}`;

      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      githubAuthUrl.searchParams.set('scope', 'repo,user');
      githubAuthUrl.searchParams.set('state', fullState);

      const headers = new Headers();
      headers.set('Location', githubAuthUrl.toString());
      // 将完整 fullState (包含 stateId 与 clientOrigin) 完整写入 HttpOnly Cookie
      headers.set(
        'Set-Cookie',
        `oauth_session_state=${encodeURIComponent(fullState)}; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=600`
      );

      return new Response(null, {
        status: 302,
        headers,
      });
    }

    // 2. GitHub 授权回调：/callback
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const receivedState = url.searchParams.get('state');

      if (!code || !receivedState) {
        return new Response('400 Bad Request: 缺少必需的授权 code 或 state 参数', { status: 400 });
      }

      // 从安全 Cookie 读取完整的保存状态
      const cookies = parseCookies(request.headers.get('Cookie'));
      const savedFullState = cookies.oauth_session_state;

      // 使用常数时间安全比对核验完整 state
      const isStateValid = await timingSafeEqualStr(savedFullState || '', receivedState);
      if (!isStateValid) {
        return new Response('403 Forbidden: CSRF 会话核验失败（state 不匹配、已过期或已被跨站篡改）', {
          status: 403,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        });
      }

      // 关键安全点：目标来源从 Cookie 保存的经过常数时间校验通过的状态中解析，决不盲信 URL
      let verifiedOrigin = '';
      try {
        const parts = savedFullState.split('.');
        if (parts.length >= 2) {
          verifiedOrigin = atob(parts.slice(1).join('.'));
        }
      } catch {
        verifiedOrigin = '';
      }

      // 二次严格白名单复核
      if (!verifiedOrigin || !isOriginAllowed(verifiedOrigin, env)) {
        return new Response(
          `403 Forbidden: 会话中保存的来源域名 (${verifiedOrigin || '非法内容'}) 未通过白名单校验。`,
          { status: 403, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }
        );
      }

      const targetOrigin = verifiedOrigin; // 严格锁死为防篡改校验通过的白名单域名
      const clearCookie = 'oauth_session_state=; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=0';

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

    return new Response('Decap CMS Secure GitHub OAuth Gateway is active.', {
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  },
};
