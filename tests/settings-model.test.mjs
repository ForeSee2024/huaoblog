import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const model = await import('../src/admin/settings-model.js').catch(() => ({}));
const canonical = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));

test('settings preserve the canonical schema and strip transport or unknown properties', () => {
  assert.equal(typeof model.validateSettings, 'function', 'settings validation is not implemented');
  const valid = model.validateSettings({ ...canonical, token: 'never-write-this', revision: 'revision-1' });
  assert.equal(valid.identity.name, canonical.identity.name);
  assert.equal(valid.revision, 'revision-1');
  assert.equal(valid.token, undefined);
  assert.equal(model.serializeSettings(valid).includes('revision'), false);
  assert.equal(model.serializeSettings(valid).includes('never-write'), false);
  for (const accent of ['cyberblue', 'neoncyan', 'violet', 'lumine']) assert.equal(model.validateSettings({ ...canonical, appearance: { ...canonical.appearance, accent } }).appearance.accent, accent);
});

test('settings reject script urls, invalid palette keys and unsafe navigation', () => {
  assert.equal(typeof model.validateSettings, 'function', 'settings validation is not implemented');
  for (const settings of [
    { ...canonical, identity: { ...canonical.identity, avatar: 'data:image/svg+xml,<svg/>' } },
    { ...canonical, appearance: { ...canonical.appearance, accent: 'anything' } },
    { ...canonical, home: { ...canonical.home, postsPerPage: 999 } },
    { ...canonical, navigation: [{ label: 'x', href: 'http://example.com', enabled: true }] },
    { ...canonical, friends: [{ name: 'x', url: 'javascript:alert(1)', description: '' }] },
    { ...canonical, navigation: [{ label: 'x', href: '//evil.example', enabled: true }] },
    { ...canonical, navigation: [{ label: 'x', href: '/%2e%2e/a', enabled: true }] },
    { ...canonical, navigation: [{ label: 'x', href: '/anything', enabled: true }] },
    { ...canonical, navigation: [{ label: 'x', href: '/admin', enabled: true }] },
  ]) assert.throws(() => model.validateSettings(settings));
  const valid = model.validateSettings({ ...canonical, friends: [{ name: '朋友', url: 'https://example.com', description: '朋友的博客', avatar: '/images/posts/friend.png' }], identity: { ...canonical.identity, socialLinks: [{ label: 'GitHub', url: 'https://github.com/example', icon: 'github' }] } });
  assert.equal(valid.friends[0].name, '朋友');
});

test('profile configuration survives a save and older settings remain editable', () => {
  const about = { ...canonical.about, introduction: '我是 Huao。', languages: '简体中文 / English', operatingSystems: ['macos', 'linux'], coverImage: '/images/posts/profile.webp', githubEnabled: false, tools: [{ name: 'Python', description: '实验与数据整理', icon: 'python' }] };
  const saved = JSON.parse(model.serializeSettings({ ...canonical, about }));
  assert.deepEqual(saved.about, about);
  const legacy = { title: '关于我', subtitle: '', body: '' };
  const upgraded = model.validateSettings({ ...canonical, about: legacy });
  assert.equal(upgraded.about.coverImage, '');
  assert.deepEqual(upgraded.about.tools, []);
  assert.equal(upgraded.about.githubEnabled, true);
  assert.equal(upgraded.about.introduction, '');
  assert.equal(upgraded.about.languages, '');
  assert.deepEqual(upgraded.about.operatingSystems, []);
  assert.equal(upgraded.about.recentPostsEnabled, undefined);
  const previous = model.validateSettings({ ...canonical, about: { ...legacy, recentPostsEnabled: true, tools: [{ name: 'Python', description: '', icon: 'code' }] } });
  assert.equal(previous.about.tools[0].icon, 'code');
  assert.equal(previous.about.recentPostsEnabled, undefined);
});

test('profile configuration rejects unsafe covers and malformed tool entries', () => {
  for (const patch of [
    { coverImage: 'javascript:alert(1)' },
    { coverImage: '//evil.example/cover.png' },
    { tools: [{ name: 'Python', description: '', icon: '<svg>' }] },
    { tools: [{ name: '', description: '', icon: 'code' }] },
    { tools: Array.from({ length: 13 }, () => ({ name: 'Python', description: '', icon: 'code' })) },
    { githubEnabled: 'false' },
    { operatingSystems: ['<svg>'] },
    { operatingSystems: 'macos' },
    { operatingSystems: Array(9).fill('macos') },
    { introduction: 'x'.repeat(301) },
  ]) assert.throws(() => model.validateSettings({ ...canonical, about: { ...canonical.about, ...patch } }));
});
