export function runtimeConfig(env, deployment) {
  const devAuth = deployment === 'node' && env.APP_DEV_AUTH === '1';
  if (devAuth && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(env.HOST || ''))) throw new Error('APP_DEV_AUTH requires an explicit loopback HOST.');
  const siteUrl = String(env.SITE_URL || (devAuth ? 'http://127.0.0.1:4321' : 'https://huaoblog.cn')).replace(/\/$/, '');
  const parsed = new URL(siteUrl);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || !['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid SITE_URL');
  return {
    deployment, devAuth, siteUrl, apiUrl: '/api/v1', backend: 'api', direct: true,
    githubUserId: String(env.ADMIN_GITHUB_ID || '160737293'),
    authUrl: String(env.CMS_AUTH_URL || 'https://huaoblog-oauth.huaoqaq.workers.dev').replace(/\/$/, ''),
    sessionTtlSeconds: 7 * 86400,
  };
}
