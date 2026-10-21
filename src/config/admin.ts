type Environment = Record<string, unknown>;
function secureAddress(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
export function createAdminConfiguration(env: Environment, local: boolean, runtime: Environment = {}) {
  const backend = String(env.CMS_BACKEND || 'api').trim();
  const direct = backend === 'api';
  const repo = String(env.CMS_REPO || (direct ? 'ForeSee2024/huaoblog' : '')).trim();
  const authUrl = String(runtime.authUrl || env.CMS_AUTH_URL || (direct ? 'https://huaoblog-oauth.huaoqaq.workers.dev' : '')).trim().replace(/\/$/, '');
  const siteUrl = String(runtime.siteUrl || env.SITE_URL || env.CF_PAGES_URL || (local ? 'http://127.0.0.1:4321' : direct ? 'https://huaoblog.cn' : '')).trim().replace(/\/$/, '');
  const issues: string[] = [];
  if (!['api', 'github'].includes(backend)) issues.push('CMS_BACKEND');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repo)) issues.push('CMS_REPO');
  if (!secureAddress(authUrl)) issues.push('CMS_AUTH_URL');
  if (!local && !secureAddress(siteUrl)) issues.push('SITE_URL');
  const deployment = ['cloudflare', 'node'].includes(String(runtime.deployment)) ? String(runtime.deployment) : '';
  return { backend, direct, apiUrl: '/api/v1', local, repo, authUrl, siteUrl, deployment, branch: 'main', ready: (local && !direct) || issues.length === 0, issues };
}
