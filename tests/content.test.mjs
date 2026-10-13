import assert from 'node:assert/strict';
import test from 'node:test';

const filters = await import('../src/utils/post-filters.ts').catch(() => ({}));
const policy = await import('../src/utils/post-policy.ts').catch(() => ({}));
const schema = await import('../src/config/content-schema.ts').catch(() => ({}));
const post = (id, data = {}) => ({ id, data: { title: id, pubDate: new Date('2026-10-12'), category: '软件工程与系统', tags: ['Rust'], series: '网关实战', draft: false, ...data } });

test('category, tag and series filters apply together and preserve other URL parameters', () => {
  assert.equal(typeof filters.matchesPostFilters, 'function', 'post filtering is not implemented');
  const selected = new URLSearchParams('cat=软件工程与系统&tag=Rust&series=网关实战');
  assert.equal(filters.matchesPostFilters(post('a').data, selected), true);
  assert.equal(filters.matchesPostFilters(post('b', { tags: ['Python'] }).data, selected), false);
  assert.equal(filters.matchesPostFilters(post('c', { series: '其他专栏' }).data, selected), false);
  assert.equal(filters.matchesPostFilters(post('d').data, new URLSearchParams('tag=不存在')), false);
});

test('feed sorting pins featured posts without changing chronological archive input', () => {
  assert.equal(typeof filters.sortFeedPosts, 'function', 'featured ordering is not implemented');
  const posts = [post('new', { pubDate: new Date('2026-10-20') }), post('pinned', { featured: true, pubDate: new Date('2026-09-01') }), post('old', { pubDate: new Date('2026-08-01') })];
  assert.deepEqual(filters.sortFeedPosts(posts).map(p => p.id), ['pinned', 'new', 'old']);
  assert.deepEqual(posts.map(p => p.id), ['new', 'pinned', 'old']);
});

test('production rejects drafts while preview permits drafts and future metadata dates', () => {
  assert.equal(typeof policy.selectPublishedPosts, 'function', 'publication policy is not independently implemented');
  assert.throws(() => policy.selectPublishedPosts([post('unfinished', { draft: true })], false), /unfinished/);
  assert.equal(policy.selectPublishedPosts([post('draft', { draft: true })], true).length, 1);
  assert.equal(policy.selectPublishedPosts([post('future', { pubDate: new Date('2099-01-01') })], false).length, 1);
});

test('optional CMS metadata may be blank without blocking a valid article', () => {
  assert.ok(schema.postSchema, 'content schema is not independently implemented');
  const valid = schema.postSchema.safeParse({ ...post('Article').data, description: '摘要', updatedDate: '', extraMeta: { repoUrl: '', difficulty: '' } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.extraMeta.repoUrl, undefined);
  assert.equal(schema.postSchema.safeParse({ ...post(' ').data, description: '摘要' }).success, false);
});


test('publication dates cannot be missing or blank', async () => {
  const { postSchema } = await import('../src/config/content-schema.ts');
  const article = { title: '日期校验', description: '验证必填日期的内容契约。', category: '软件工程与系统' };
  assert.equal(postSchema.safeParse({ ...article, pubDate: '2026-10-13' }).success, true);
  for (const pubDate of [undefined, null, '']) {
    assert.equal(postSchema.safeParse({ ...article, pubDate }).success, false, `pubDate=${String(pubDate)}`);
  }
});
