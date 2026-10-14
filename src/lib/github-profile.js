// Only public account totals and public original repositories enter the page.
/** @typedef {{ username: string, publicRepos: number, followers: number, following: number, stars: number, repositorySample: number, languageRepos: number, languages: Array<{name: string, count: number}>, updatedAt: string }} GitHubSnapshot */
/** @returns {Omit<GitHubSnapshot, 'updatedAt'>} */
export function summarizeGitHubProfile(user, repositories) {
  const counts = ['public_repos', 'followers', 'following'];
  if (!user || !/^[a-z0-9-]+$/i.test(user.login) || !Array.isArray(repositories) || counts.some(key => !Number.isSafeInteger(user[key]) || user[key] < 0)) throw new Error('Invalid public GitHub profile');
  const original = repositories.filter(repo => repo.private === false && repo.fork === false);
  /** @type {Map<string, number>} */
  const languages = new Map();
  let stars = 0;
  for (const repo of original) {
    if (Number.isSafeInteger(repo.stargazers_count) && repo.stargazers_count >= 0) stars += repo.stargazers_count;
    if (typeof repo.language === 'string' && repo.language) languages.set(repo.language, (languages.get(repo.language) || 0) + 1);
  }
  return {
    username: user.login,
    publicRepos: user.public_repos,
    followers: user.followers,
    following: user.following,
    stars,
    repositorySample: repositories.length,
    languageRepos: [...languages.values()].reduce((sum, count) => sum + count, 0),
    languages: [...languages].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** @param {string} username
 * @param {GitHubSnapshot | undefined} snapshot
 * @param {typeof fetch} request
 * @returns {Promise<GitHubSnapshot | undefined>}
 */
export async function loadGitHubProfile(username, snapshot, request = fetch) {
  if (typeof username !== 'string' || !/^[a-z0-9-]+$/i.test(username)) return undefined;
  try {
    const options = { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000) };
    const responses = await Promise.all([
      request(`https://api.github.com/users/${username}`, options),
      request(`https://api.github.com/users/${username}/repos?per_page=100&type=owner&sort=updated`, options),
    ]);
    if (responses.some(response => !response.ok)) throw new Error('GitHub unavailable');
    const [user, repos] = await Promise.all(responses.map(response => response.json()));
    if (user.login?.toLowerCase() !== username.toLowerCase()) throw new Error('GitHub account mismatch');
    return { ...summarizeGitHubProfile(user, repos), updatedAt: new Date().toISOString() };
  } catch {
    // Keep the last verified public snapshot, with its original update date.
    return snapshot?.username.toLowerCase() === username.toLowerCase() ? snapshot : undefined;
  }
}
