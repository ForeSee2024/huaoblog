import assert from 'node:assert/strict';
import test from 'node:test';
const model = await import('../src/admin/content-model.js').catch(() => ({}));
const post = () => ({ slug: 'test-post', status: 'draft', data: { title: '测试文章', description: '摘要', pubDate: '2026-10-13', category: '软件工程与系统', tags: ['Rust'], featured: false }, body: '## 正文\n\n内容。' });

test('published posts require the complete content contract while drafts may be incomplete', () => {
  assert.equal(typeof model.validatePost, 'function', 'post validation is not implemented');
  assert.equal(model.validatePost({ slug: 'new-post', data: {}, body: '' }).status, 'draft');
  assert.throws(() => model.validatePost({ slug: 'new-post', data: {}, body: '' }, { publish: true }), /标题/);
  assert.equal(model.validatePost(post(), { publish: true }).status, 'published');
  for (const data of [{ title: 'x'.repeat(101) }, { description: 'x'.repeat(261) }, { pubDate: '2026-02-30' }, { category: '任意类别' }, { coverImage: 'javascript:alert(1)' }, { extraMeta: { repoUrl: 'data:text/html,test' } }]) {
    assert.throws(() => model.validatePost({ ...post(), data: { ...post().data, ...data } }, { publish: true }));
  }
  assert.throws(() => model.validatePost({ ...post(), body: '  ' }, { publish: true }), /正文/);
});

test('slugs reject traversal and frontmatter roundtrips Chinese and optional metadata', () => {
  assert.equal(typeof model.validateSlug, 'function', 'slug validation is not implemented');
  for (const slug of ['../file', 'A', 'a/b', '%2e%2e', '.hidden', 'a\\b']) assert.throws(() => model.validateSlug(slug));
  const article = { ...post(), data: { ...post().data, extraMeta: { difficulty: '进阶', repoUrl: 'https://github.com/test/repo' }, series: '系统工程' } };
  const parsed = model.parsePost(model.stringifyPost(article), article.slug);
  assert.equal(parsed.body, article.body);
  assert.equal(parsed.data.extraMeta.repoUrl, article.data.extraMeta.repoUrl);
  assert.equal(parsed.data.pubDate, '2026-10-13');
  assert.equal(parsed.status, 'draft');
});

test('image inspection verifies bytes and matching extensions and rejects SVG uploads', () => {
  assert.equal(typeof model.inspectMediaBytes, 'function', 'image inspection is not implemented');
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
  assert.equal(model.inspectMediaBytes(png, 'one.png').mime, 'image/png');
  for (const name of ['../one.png', 'one.svg', 'one.jpg', 'one.png.exe']) assert.throws(() => model.inspectMediaBytes(png, name));
  assert.throws(() => model.inspectMediaBytes(new TextEncoder().encode('<svg></svg>'), 'one.png'));
  assert.throws(() => model.inspectMediaBytes(png.subarray(0, 24), 'one.png'));
  const corrupted = png.slice(); corrupted[48] ^= 1;
  assert.throws(() => model.inspectMediaBytes(corrupted, 'one.png'), /损坏/);
  assert.throws(() => model.inspectMediaBytes(new Uint8Array(10 * 1024 * 1024 + 1), 'one.png'), /10 MB/);
});

test('media reference detection covers markdown, HTML, frontmatter and settings', () => {
  assert.equal(typeof model.findMediaReferences, 'function', 'reference detection is not implemented');
  const path = '/images/posts/one.png';
  const references = model.findMediaReferences(path, [{ ...post(), body: '![图](/images/posts/one.png)', data: { ...post().data, coverImage: path } }], { identity: { avatar: path } });
  assert.deepEqual(references, ['文章「测试文章」', '站点设置']);
  assert.equal(model.findMediaReferences(path, [{ ...post(), body: '![别的](/images/posts/one.png-extra)' }], {}).length, 0);
  assert.equal(model.findMediaReferences(path, [{ ...post(), body: '100% complete\n\n![图](/images/posts/%6fne.png)' }], {}).length, 1);
});
