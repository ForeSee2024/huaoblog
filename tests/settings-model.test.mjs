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
