import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ContentError } from '../src/admin/content-model.js';

const posts = await import('../src/utils/posts.ts').catch(() => ({}));
const config = await import('../src/config/site.ts');
const record = (slug, pubDate, status = 'published') => ({ slug, status, revision: 'revision', bodyLoaded: false, data: { title: slug, description: '摘要', pubDate, category: '软件工程与系统', tags: [] } });

test('public article metadata is read again after publication and normalized for chronological views', async () => {
  assert.equal(typeof posts.getPublishedPosts, 'function', 'runtime article metadata is not implemented');
  const records = [record('earlier', '2026-10-13'), record('later', '2026-10-15')];
  const store = { async getPublishedPosts() { return records; } };
  const initial = await posts.getPublishedPosts(store);
  assert.deepEqual(initial.map(post => post.slug), ['later', 'earlier']);
  assert.ok(initial[0].data.pubDate instanceof Date);
  assert.equal(posts.formatDate(initial[0].data.pubDate), '2026-10-15');
  assert.equal(records[0].data.pubDate, '2026-10-13');
  records.push(record('newly-published', '2099-01-01'));
  assert.equal((await posts.getPublishedPosts(store))[0].slug, 'newly-published');
});

test('article reads request only the published copy and do not fall back to a private draft', async () => {
  assert.equal(typeof posts.getPublishedPost, 'function', 'runtime article lookup is not implemented');
  const records = [
    { ...record('both', '2026-10-15'), body: 'Published body' },
    { ...record('both', '2026-10-15', 'draft'), body: 'Private edit' },
    { ...record('draft-only', '2026-10-15', 'draft'), body: 'Private draft' },
  ];
  const store = { async getPost(slug, status) { return records.find(post => post.slug === slug && post.status === status) || null; } };
  assert.equal((await posts.getPublishedPost(store, 'both')).body, 'Published body');
  assert.equal(await posts.getPublishedPost(store, 'draft-only'), null);
  assert.equal(await posts.getPublishedPost(store, 'deleted'), null);
});

test('invalid article addresses become missing pages while storage failures remain visible', async () => {
  const store = { async getPost() { throw new ContentError('Invalid slug'); } };
  assert.equal(await posts.getPublishedPost(store, 'bad slug'), null);
  store.getPost = async () => { throw new Error('Database unavailable'); };
  await assert.rejects(posts.getPublishedPost(store, 'valid-slug'), /Database unavailable/);
});

test('site identity follows each published settings snapshot without sharing request state', () => {
  assert.equal(typeof config.siteFor, 'function', 'request-specific site identity is not implemented');
  const first = { ...config.settings, identity: { ...config.settings.identity, name: 'First site', brand: 'First' } };
  const second = { ...config.settings, identity: { ...config.settings.identity, name: 'Second site', brand: 'Second' } };
  const firstSite = config.siteFor(first);
  assert.equal(config.siteFor(second).brand, 'Second');
  assert.equal(firstSite.name, 'First site');
  assert.equal(firstSite.brand, 'First');
  assert.equal(firstSite.fonts, config.site.fonts);
});

function searchDialog(request) {
  class Element {
    listeners = {};
    children = [];
    textContent = '';
    value = '';
    open = false;
    addEventListener(event, listener) { this.listeners[event] = listener; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
  }
  const elements = Object.fromEntries(['site-search', 'search-input', 'search-results-list', 'search-state', 'btn-open-search', 'search-close'].map(id => [id, new Element()]));
  const timers = [];
  const source = readFileSync(new URL('../src/components/common/SearchModal.astro', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    document: { getElementById: id => elements[id], createElement: () => new Element(), activeElement: null },
    window: { addEventListener() {} }, location: { origin: 'https://blog.example' }, URL, AbortController,
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {}, fetch: request,
  });
  elements['btn-open-search'].listeners.click();
  return { elements, async search(query) { elements['search-input'].value = query; elements['search-input'].listeners.input(); await timers.at(-1)(); } };
}

test('search requests current full text results and renders result text without executing markup', async () => {
  const requests = [];
  const { elements, search } = searchDialog(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, async json() { return { results: [{ url: '/posts/current/', title: '当前标题', excerpt: '<script>literal text</script>' }] }; } };
  });
  await search('当前 内容');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/v1/search?q=%E5%BD%93%E5%89%8D%20%E5%86%85%E5%AE%B9');
  assert.equal(requests[0].options.cache, 'no-store');
  const result = elements['search-results-list'].children[0];
  assert.equal(result.href, 'https://blog.example/posts/current/');
  assert.equal(result.children[0].textContent, '当前标题');
  assert.equal(result.children[1].textContent, '<script>literal text</script>');
});

test('search clears outdated results and reports a request failure without showing stale matches', async () => {
  const { elements, search } = searchDialog(async () => { throw new Error('offline'); });
  elements['search-results-list'].append({ textContent: 'Old result' });
  await search('query');
  assert.equal(elements['search-results-list'].children.length, 0);
  assert.match(elements['search-state'].textContent, /暂时无法搜索/);
  await search('');
  assert.equal(elements['search-state'].textContent, '输入关键词，开始查找文章。');
});
