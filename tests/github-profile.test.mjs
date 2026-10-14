import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGitHubProfile, loadGitHubProfile } from '../src/lib/github-profile.js';

const user = { login: 'Huao', public_repos: 4, followers: 3, following: 2 };
const repos = [
  { private: false, fork: false, language: 'Python', stargazers_count: 5 },
  { private: false, fork: false, language: 'Python', stargazers_count: 2 },
  { private: false, fork: true, language: 'JavaScript', stargazers_count: 99 },
  { private: true, fork: false, language: 'Rust', stargazers_count: 20 },
];

test('GitHub profile statistics only describe public original repositories', () => {
  const stats = summarizeGitHubProfile(user, repos);
  assert.equal(stats.publicRepos, 4);
  assert.equal(stats.stars, 7);
  assert.equal(stats.languageRepos, 2);
  assert.deepEqual(stats.languages, [{ name: 'Python', count: 2 }]);
  assert.equal(stats.followers, 3);
  assert.throws(() => summarizeGitHubProfile({ ...user, public_repos: '4' }, repos));
});

test('GitHub failures preserve dated public data only for the matching account', async () => {
  const snapshot = { ...summarizeGitHubProfile(user, repos), updatedAt: '2026-10-14T00:00:00.000Z' };
  const offline = async () => { throw new Error('Unavailable'); };
  assert.deepEqual(await loadGitHubProfile('Huao', snapshot, offline), snapshot);
  assert.equal(await loadGitHubProfile('SomeoneElse', snapshot, offline), undefined);
  assert.equal(await loadGitHubProfile('../Huao', snapshot, offline), undefined);
});

test('GitHub successful refreshes discard the previous account data', async () => {
  const request = async url => ({ ok: true, json: async () => url.includes('/repos?') ? repos : user });
  const stats = await loadGitHubProfile('Huao', undefined, request);
  assert.equal(stats.username, 'Huao');
  assert.equal(stats.stars, 7);
  assert.ok(Number.isFinite(Date.parse(stats.updatedAt)));
});
