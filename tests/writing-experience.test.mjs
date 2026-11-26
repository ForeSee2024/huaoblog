import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSlug } from '../src/admin/content-model.js';
import { editorView, renderOutlineItems } from '../src/admin/editor-view.js';
import { validateSettings } from '../src/admin/settings-model.js';
import { collectAllKnownTags, filterPosts } from '../src/admin/view-model.js';
import { buildLoginPromptCopy, buildRecoveryKey, scanLocalDrafts } from '../src/admin/session-recovery.js';
import { mediaView, overview, postsView } from '../src/admin/views.js';
import {
  estimateReadingStats,
  extractMarkdownHeadings,
  suggestSlugFromTitle,
} from '../src/utils/reading-time.js';

test('reading stats count mixed CJK and English words and factor in fenced code lines', () => {
  assert.deepEqual(estimateReadingStats(''), { words: 0, minutes: 1, label: '约 1 分钟阅读' });

  const shortText = '这是一段包含 Rust async runtime 的简短测试文本。';
  const shortStats = estimateReadingStats(shortText);
  assert.ok(shortStats.words >= 15);
  assert.equal(shortStats.minutes, 1);

  const longDoc = `${'深入剖析分布式存储系统架构原理。'.repeat(60)}\n\n\`\`\`rust\n${'let x = 42;\n'.repeat(36)}\`\`\``;
  const longStats = estimateReadingStats(longDoc);
  assert.ok(longStats.minutes >= 5);
  assert.match(longStats.label, /约 \d+ 分钟阅读/);
});

test('markdown outline extraction skips fenced code comments and strips inline formatting', () => {
  const md = [
    '# 顶层标题',
    '',
    '```bash',
    '# 这是脚本注释，不应进入大纲',
    'echo "hello"',
    '```',
    '',
    '## 第二节：`epoll` 与 **异步 I/O**',
    '### [子章节链接](https://example.com)',
    '#### 四级标题不进入主大纲',
  ].join('\n');

  const headings = extractMarkdownHeadings(md);
  assert.deepEqual(headings, [
    { depth: 1, text: '顶层标题', line: 1 },
    { depth: 2, text: '第二节：epoll 与 异步 I/O', line: 8 },
    { depth: 3, text: '子章节链接', line: 9 },
  ]);

  const outlineHtml = renderOutlineItems('## <script>alert(1)</script>');
  assert.doesNotMatch(outlineHtml, /<script>/);
  assert.match(outlineHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('slug generator produces valid slugs for both Latin and pure Chinese titles', () => {
  const fromEnglish = suggestSlugFromTitle('Building Cloudflare Workers in 2026!', '2026-11-18');
  assert.equal(fromEnglish, 'building-cloudflare-workers-in-2026');
  assert.equal(validateSlug(fromEnglish), fromEnglish);

  const fromChinese = suggestSlugFromTitle('深入理解现代浏览器渲染管线', '2026-11-18');
  assert.match(fromChinese, /^2026-11-18-post-[a-z0-9]+$/);
  assert.equal(validateSlug(fromChinese), fromChinese);
});

test('post filtering supports non-mutating sorting and known tag aggregation', () => {
  const list = [
    { slug: 'b', status: 'published', data: { title: 'Beta', pubDate: '2026-10-02', category: '软件工程与系统', tags: ['Rust', 'Web'] } },
    { slug: 'a', status: 'draft', data: { title: 'Alpha', pubDate: '2026-10-10', category: '软件工程与系统', tags: ['Rust'] } },
    { slug: 'c', status: 'published', data: { title: 'Gamma', pubDate: '2026-09-01', category: '软件工程与系统', tags: ['Linux'] } },
  ];

  assert.deepEqual(filterPosts(list, { sort: 'newest' }).map((p) => p.slug), ['a', 'b', 'c']);
  assert.deepEqual(filterPosts(list, { sort: 'oldest' }).map((p) => p.slug), ['c', 'b', 'a']);
  assert.deepEqual(filterPosts(list, { sort: 'title' }).map((p) => p.slug), ['a', 'b', 'c']);
  assert.equal(list[0].slug, 'b');

  assert.deepEqual(collectAllKnownTags(list), ['Rust', 'Linux', 'Web']);
});

test('editor and workspace views render split mode, zen toggle, quick tags, continue banner and dropzone', () => {
  const draftPost = {
    slug: '2026-11-18-note-demo',
    status: 'draft',
    data: {
      title: '草稿标题',
      description: '草稿摘要',
      pubDate: '2026-11-18',
      category: '软件工程与系统',
      tags: ['Rust'],
      featured: false,
    },
    body: '## 架构总览\n\n正文内容。',
  };

  const editorHtml = editorView(
    { ...draftPost, data: { ...draftPost.data, origin: 'human' } },
    ['软件工程与系统'],
    false,
    (v) => v,
    { direct: true, knownTags: ['Rust', 'Wasm'], zen: false, mode: 'split' },
  );
  assert.match(editorHtml, /data-mode="split"/);
  assert.match(editorHtml, /aria-selected="true" data-action="editor-mode" data-mode="split"/);
  assert.match(editorHtml, /data-action="toggle-zen"/);
  assert.match(editorHtml, /data-action="suggest-slug"/);
  assert.match(editorHtml, /data-action="toggle-editor-tag" data-tag="Wasm"/);
  assert.match(editorHtml, /name="origin"/);
  assert.match(editorHtml, /class="badge origin-human"/);
  assert.match(editorHtml, /架构总览/);

  const workspace = {
    posts: [
      { ...draftPost, data: { ...draftPost.data, origin: 'human' } },
      { slug: 'ai-curated', status: 'published', data: { title: '归档笔记', description: '摘要', pubDate: '2026-11-12', category: '软件工程与系统', tags: [], origin: 'ai' } },
    ],
    media: [],
    settings: { identity: { brand: 'HUAOVO', description: '简介', avatar: '' }, friends: [] },
    connection: { mode: 'database' },
  };
  const overviewHtml = overview(workspace, false, { direct: true });
  const postsHtml = postsView(workspace, { state: 'all', search: '', origin: '', sort: 'newest' });
  assert.match(overviewHtml, /CONTINUE WRITING/);
  assert.match(overviewHtml, /class="badge origin-human"/);
  assert.match(postsHtml, /id="post-sort"/);
  assert.match(postsHtml, /id="post-origin"/);
  assert.match(postsHtml, /class="badge origin-ai"/);
  assert.match(mediaView(workspace), /id="media-dropzone"/);
});

test('public origin distinction stays subtle without explicit AI writing labels', async () => {
  const originJs = await readFile(new URL('../src/utils/post-origin.js', import.meta.url), 'utf8');
  const badgeAstro = await readFile(new URL('../src/components/post/OriginBadge.astro', import.meta.url), 'utf8');
  const postsIndex = await readFile(new URL('../src/pages/posts/index.astro', import.meta.url), 'utf8');
  assert.match(originJs, /label:\s*'手写'/);
  assert.match(originJs, /label:\s*'整理'/);
  assert.match(badgeAstro, /origin-badge--\$\{meta\.key\}/);
  assert.match(postsIndex, /id="origin-filter-bar"/);
  assert.doesNotMatch(badgeAstro + postsIndex, /AI\s*写作|AI\s*生成/);
});

test('article reading stage stays visually centered and TOC never calls scrollIntoView', async () => {
  const tocSource = await readFile(new URL('../src/components/post/TableOfContents.astro', import.meta.url), 'utf8');
  const scriptPart = tocSource.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  assert.doesNotMatch(scriptPart, /\.scrollIntoView\s*\(/);

  const postLayout = await readFile(new URL('../src/layouts/PostLayout.astro', import.meta.url), 'utf8');
  assert.match(postLayout, /class="post-reading-stage"/);
  assert.match(postLayout, /class="post-reading-main"/);
});

test('canonical site.json validates cleanly and contains no personal PII', async () => {
  const raw = await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(raw);
  const validated = validateSettings(parsed);
  assert.equal(validated.identity.brand, 'HuaOvO');
  assert.ok(validated.about.tools.length >= 15);
  assert.doesNotMatch(raw, /胡敖|宜宾学院|成都工业学院|西北师范大学|13308222685|2558307602|2026R11S/);
});

test('recovery scanning preserves compatible local draft keys and prompts login without losing drafts', () => {
  assert.equal(buildRecoveryKey('ForeSee2024/huaoblog', 'editor/new', 'temp'), 'huaovo-recovery:ForeSee2024/huaoblog:new');
  assert.equal(buildRecoveryKey('ForeSee2024/huaoblog', 'editor/my-post/draft', 'my-post'), 'huaovo-recovery:ForeSee2024/huaoblog:my-post');

  const store = new Map([
    ['huaovo-recovery:ForeSee2024/huaoblog:new', JSON.stringify({
      savedAt: 1795681000000,
      post: { slug: '2026-11-26-note-abc', status: 'draft', data: { title: '半成品草稿', description: '待同步' }, body: '还没保存的正文' },
    })],
    ['huaovo-recovery:ForeSee2024/huaoblog:empty', JSON.stringify({
      savedAt: 1795682000000,
      post: { slug: 'empty', status: 'draft', data: { title: '', description: '' }, body: '   ' },
    })],
  ]);
  const fakeStorage = {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) { return store.get(k) ?? null; },
  };
  const drafts = scanLocalDrafts(fakeStorage, 'ForeSee2024/huaoblog', []);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, '半成品草稿');
  assert.equal(drafts[0].route, 'editor/new');

  const copy = buildLoginPromptCopy({ route: 'overview', localDrafts: drafts, reason: 'welcome' });
  assert.equal(copy.hasPendingDraft, true);
  assert.match(copy.draftNotice, /半成品草稿/);
  assert.match(copy.description, /365 天/);

  const workspace = {
    posts: [],
    media: [],
    settings: { identity: { brand: 'HUAOVO', description: '简介', avatar: '' }, friends: [] },
    connection: { mode: 'database', authenticated: false },
  };
  const overviewHtml = overview(workspace, false, { direct: true, localDrafts: drafts });
  const postsHtml = postsView(workspace, { state: 'all', search: '', origin: '', sort: 'newest' }, new Set(), { localDrafts: drafts });
  assert.match(overviewHtml, /data-action="open-local-draft"/);
  assert.match(overviewHtml, /半成品草稿/);
  assert.match(postsHtml, /data-action="open-local-draft"/);
});

