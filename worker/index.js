const cookieName = 'oauth_session_state';
const cookieOptions = 'HttpOnly; Secure; SameSite=Lax; Path=/callback';
const clearCookie = `${cookieName}=; ${cookieOptions}; Max-Age=0`;

function isOriginAllowed(origin, env) {
  return Boolean(origin && env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean).includes(origin));
}

function readCookie(header) {
  const value = (header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  try { return value ? decodeURIComponent(value.slice(cookieName.length + 1)) : ''; } catch { return ''; }
}

function equalState(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

// Safe inside an HTML script element, including untrusted upstream error text.
function scriptJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function authorizationPage(origin, data, error = '') {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const protocolMessage = `authorization:github:${error ? 'error' : 'success'}:${JSON.stringify(data)}`;
  const payload = scriptJson({ origin, message: protocolMessage, error });
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>返回写作后台</title></head>
    <body><p id="auth-status">正在返回写作后台…</p><script nonce="${nonce}">
      (function() {
        const payload = ${payload};
        if (payload.error) document.getElementById('auth-status').textContent = '授权失败：' + payload.error;
        if (!window.opener) { document.getElementById('auth-status').textContent = '请从写作后台重新打开登录窗口。'; return; }
        function receiveMessage(event) {
          if (event.origin !== payload.origin || event.source !== window.opener || event.data !== 'authorizing:github') return;
          window.opener.postMessage(payload.message, payload.origin);
          window.removeEventListener('message', receiveMessage);
          window.close();
        }
        window.addEventListener('message', receiveMessage);
        window.opener.postMessage('authorizing:github', payload.origin);
      })();
    </script></body></html>`, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie, 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      'Referrer-Policy': 'no-referrer',
    } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.ALLOWED_ORIGINS?.trim()) return new Response('OAuth service is not configured.', { status: 500 });

    if (url.pathname === '/auth') {
      let origin = url.searchParams.get('origin') || '';
      if (!origin) { try { origin = new URL(request.headers.get('Referer')).origin; } catch { /* deny unknown origins */ } }
      if (!isOriginAllowed(origin, env)) return new Response('Unauthorized origin.', { status: 403 });
      const fullState = `${crypto.randomUUID()}.${btoa(origin)}`;
      const authorization = new URL('https://github.com/login/oauth/authorize');
      authorization.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorization.searchParams.set('scope', env.GITHUB_OAUTH_SCOPE === 'read:user' || url.searchParams.get('identity') === '1' ? 'read:user' : 'repo');
      authorization.searchParams.set('state', fullState);
      authorization.searchParams.set('redirect_uri', new URL('/callback', url.origin).href);
      return new Response(null, { status: 302, headers: {
        Location: authorization.href, 'Set-Cookie': `${cookieName}=${encodeURIComponent(fullState)}; ${cookieOptions}; Max-Age=600`,
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      } });
    }

    if (url.pathname === '/callback') {
      const received = url.searchParams.get('state') || '';
      const saved = readCookie(request.headers.get('Cookie'));
      if (!saved || !received || !equalState(saved, received)) return new Response('OAuth session validation failed. Please sign in again.', { status: 403 });
      let origin;
      try { origin = atob(saved.slice(saved.indexOf('.') + 1)); } catch { return new Response('Invalid OAuth session.', { status: 403 }); }
      if (!isOriginAllowed(origin, env)) return new Response('Unauthorized session origin.', { status: 403 });
      if (url.searchParams.has('error')) return authorizationPage(origin, { error: 'access_denied' }, 'GitHub 授权已取消，请回到后台重新登录。');
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing authorization code.', { status: 400 });
      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'HuaOvO-Decap-OAuth' },
          body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: new URL('/callback', url.origin).href }),
        });
        const data = await response.json();
        if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) return authorizationPage(origin, { error: data.error || 'token_exchange_failed' }, String(data.error_description || '授权凭据已过期，请重新登录。'));
        return authorizationPage(origin, { token: data.access_token, provider: 'github' });
      } catch { return authorizationPage(origin, { error: 'token_exchange_failed' }, '登录服务暂时不可用，请稍后重试。'); }
    }
    return new Response('Decap OAuth gateway is active.', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  },
};
