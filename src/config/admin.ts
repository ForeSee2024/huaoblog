type Environment = Record<string, unknown>;
function secureAddress(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
export function createAdminConfiguration(env: Environment, local: boolean) {
  const repo = String(env.CMS_REPO || '').trim();
  const authUrl = String(env.CMS_AUTH_URL || '').trim().replace(/\/$/, '');
  const siteUrl = String(env.SITE_URL || env.CF_PAGES_URL || (local ? 'http://127.0.0.1:4321' : '')).trim().replace(/\/$/, '');
  const issues: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repo)) issues.push('CMS_REPO');
  if (!secureAddress(authUrl)) issues.push('CMS_AUTH_URL');
  if (!local && !secureAddress(siteUrl)) issues.push('SITE_URL');
  return { local, repo, authUrl, siteUrl, branch: 'main', ready: local || issues.length === 0, issues };
}
