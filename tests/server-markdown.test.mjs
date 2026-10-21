import assert from 'node:assert/strict';
import test from 'node:test';

const renderer = await import('../src/server/render-markdown.js').catch(() => ({}));

test('stored Markdown renders tables, highlighted code and mathematics', () => {
  assert.equal(typeof renderer.renderMarkdown, 'function', 'public Markdown renderer is not implemented');
  const { html } = renderer.renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```javascript\nconst answer = 42;\n```\n\n公式 $x^2$\n\n$$\\frac{a}{b}$$\n\n![附件](/images/posts/new-upload.png)');
  assert.match(html, /<table>/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<math/);
  assert.match(html, /src="\/images\/posts\/new-upload.png"/);
});

test('stored Markdown creates matching unique heading anchors for the table of contents', () => {
  assert.equal(typeof renderer.renderMarkdown, 'function', 'public Markdown renderer is not implemented');
  const { html, headings } = renderer.renderMarkdown('## 开始：Hello `world`\n\n### 重复标题\n\n### 重复标题');
  assert.deepEqual(headings, [
    { depth: 2, text: '开始：Hello world', slug: '开始hello-world' },
    { depth: 3, text: '重复标题', slug: '重复标题' },
    { depth: 3, text: '重复标题', slug: '重复标题-1' },
  ]);
  for (const heading of headings) assert.ok(html.includes(`id="${heading.slug}"`));
  assert.equal(renderer.renderMarkdown('## 重复标题').headings[0].slug, '重复标题');
});

test('stored Markdown removes executable HTML, unsafe links and untrusted math commands', () => {
  assert.equal(typeof renderer.renderMarkdown, 'function', 'public Markdown renderer is not implemented');
  const { html } = renderer.renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n![unsafe](data:image/svg+xml;base64,PHN2Zz4=)\n\n$\\href{javascript:alert(1)}{bad}$\n\n[safe](https://example.com)');
  assert.doesNotMatch(html, /<script|onerror=|(?:href|src)="(?:javascript:|data:)/i);
  assert.match(html, /href="https:\/\/example.com"/);
});
