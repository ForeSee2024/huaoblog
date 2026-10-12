/**
 * Cloudflare Worker: Decap CMS GitHub OAuth 认证网关
 * 
 * 作用：为静态 Decap CMS (/admin) 提供安全的 GitHub OAuth 授权代理，
 * 避免在前端暴露 GitHub Client Secret。
 * 
 * 环境变量配置 (在 Cloudflare Dashboard 或 wrangler secret put 配置):
 * - GITHUB_CLIENT_ID: GitHub OAuth App 的 Client ID
 * - GITHUB_CLIENT_SECRET: GitHub OAuth App 的 Client Secret
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 发起授权请求：重定向到 GitHub 授权页
    if (url.pathname === '/auth') {
      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      githubAuthUrl.searchParams.set('scope', 'repo,user');
      // 可选带上自定义 state
      githubAuthUrl.searchParams.set('state', crypto.randomUUID());

      return Response.redirect(githubAuthUrl.toString(), 302);
    }

    // 2. GitHub 授权回调：换取 token 并通知 Decap CMS 弹窗
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        return new Response('缺少授权 code', { status: 400 });
      }

      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Decap-CMS-Cloudflare-OAuth-Worker'
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: code,
          }),
        });

        const data = await response.json();

        if (data.error || !data.access_token) {
          const content = `
            <!DOCTYPE html>
            <html>
              <body>
                <script>
                  window.opener.postMessage(
                    'authorization:github:error:${JSON.stringify(data)}',
                    '*'
                  );
                  window.close();
                </script>
              </body>
            </html>
          `;
          return new Response(content, {
            headers: { 'Content-Type': 'text/html;charset=UTF-8' },
          });
        }

        // 成功换取 token，以 postMessage 格式回调 Decap CMS
        const content = `
          <!DOCTYPE html>
          <html>
            <body>
              <script>
                (function() {
                  function receiveMessage(e) {
                    window.opener.postMessage(
                      'authorization:github:success:${JSON.stringify({
                        token: data.access_token,
                        provider: 'github',
                      })}',
                      e.origin
                    );
                    window.removeEventListener("message", receiveMessage, false);
                    window.close();
                  }
                  window.addEventListener("message", receiveMessage, false);
                  window.opener.postMessage("authorizing:github", "*");
                })()
              </script>
            </body>
          </html>
        `;

        return new Response(content, {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      } catch (err) {
        return new Response(`OAuth 换票异常: ${err.message}`, { status: 500 });
      }
    }

    // 默认根路径返回存活状态
    return new Response('Decap CMS GitHub OAuth Gateway is running on Cloudflare Workers.', {
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  },
};
