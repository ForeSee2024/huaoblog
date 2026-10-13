import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/common/ThemeScript.astro', import.meta.url), 'utf8');
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];

function initializeTheme({ theme = 'system', accent = 'cyberblue', saved = {}, systemDark = false, storageBlocked = false } = {}) {
  const attributes = {};
  let systemChange;
  const media = {
    matches: systemDark,
    addEventListener: (_event, callback) => { systemChange = callback; },
  };
  vm.runInNewContext(script, {
    defaultTheme: theme,
    defaultAccent: accent,
    document: { documentElement: { setAttribute: (key, value) => { attributes[key] = value; } } },
    localStorage: { getItem: key => { if (storageBlocked) throw new Error('Storage denied'); return saved[key] ?? null; } },
    window: {
      matchMedia: query => query.includes(': light') ? { ...media, matches: !systemDark } : media,
      dispatchEvent: () => {},
    },
    CustomEvent: class {},
  });
  return { attributes, changeSystem: dark => systemChange?.({ matches: dark }) };
}

test('configured light and dark themes take precedence over the system without a visitor override', () => {
  const dark = initializeTheme({ theme: 'dark', systemDark: false });
  assert.equal(dark.attributes['data-theme'], 'dark');
  dark.changeSystem(false);
  assert.equal(dark.attributes['data-theme'], 'dark');
  assert.equal(initializeTheme({ theme: 'light', systemDark: true }).attributes['data-theme'], 'light');
});

test('valid saved visitor preferences take precedence over configured theme and accent', () => {
  const result = initializeTheme({ theme: 'light', accent: 'neoncyan', saved: { 'blog-theme': 'dark', 'blog-accent': 'violet' } });
  assert.equal(result.attributes['data-theme'], 'dark');
  assert.equal(result.attributes['data-accent'], 'violet');
  result.changeSystem(false);
  assert.equal(result.attributes['data-theme'], 'dark');
});

test('system theme follows preference changes and ignores invalid stored values', () => {
  const result = initializeTheme({ accent: 'lumine', systemDark: true, saved: { 'blog-theme': 'invalid', 'blog-accent': 'invalid' } });
  assert.equal(result.attributes['data-theme'], 'dark');
  assert.equal(result.attributes['data-accent'], 'lumine');
  result.changeSystem(false);
  assert.equal(result.attributes['data-theme'], 'light');
});

test('site defaults still apply when browser storage is unavailable', () => {
  const result = initializeTheme({ theme: 'light', accent: 'neoncyan', storageBlocked: true });
  assert.equal(result.attributes['data-theme'], 'light');
  assert.equal(result.attributes['data-accent'], 'neoncyan');
});
