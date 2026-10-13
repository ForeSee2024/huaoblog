import assert from 'node:assert/strict';
import test from 'node:test';

const preview = await import('../src/lib/markdown-preview.js').catch(() => ({}));

test('preview renders math on repeated edits without carrying the old result forward', () => {
  assert.equal(typeof preview.renderMarkdownPreview, 'function', 'shared preview rendering is not implemented');
  const first = preview.renderMarkdownPreview('公式 $x^2$ 与 $$\\frac{a}{b}$$');
  const updated = preview.renderMarkdownPreview('公式 $y^3$');
  assert.match(first, /class="katex"/);
  assert.match(first, /<math/);
  assert.match(updated, /y\^3/);
  assert.doesNotMatch(updated, /x\^2/);
});

test('preview supports tables, highlighted code and pending uploaded assets', () => {
  assert.equal(typeof preview.renderMarkdownPreview, 'function', 'shared preview rendering is not implemented');
  const html = preview.renderMarkdownPreview('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```javascript\nconst n = 1;\n```\n\n![测试](/images/posts/upload.png)', path => path === '/images/posts/upload.png' ? 'blob:https://blog.example/upload' : path);
  assert.match(html, /<table>/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /blob:https:\/\/blog.example\/upload/);
});

test('preview blocks executable HTML and unsafe Markdown link protocols', () => {
  assert.equal(typeof preview.renderMarkdownPreview, 'function', 'shared preview rendering is not implemented');
  const html = preview.renderMarkdownPreview('<script>alert(1)</script>\n\n[link](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:/);
});
