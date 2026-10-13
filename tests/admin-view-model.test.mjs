import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPosts, collectTaxonomy, summarizeWorkspace, parseTags } from '../src/admin/view-model.js';
const posts = [
  { slug: 'one', status: 'published', data: { title: 'Rust 系统实践', category: '软件工程与系统', tags: ['Rust', 'Linux'], description: '安全网关' } },
  { slug: 'one', status: 'draft', data: { title: 'Rust 草稿修订', category: '软件工程与系统', tags: ['Rust'], description: '' } },
  { slug: 'two', status: 'draft', data: { title: '', category: 'AI 与前沿科研', tags: ['LLM'], description: '' } },
];
test('搜索、状态与分类同时筛选，保留同名文章草稿的独立版本', () => {
  assert.equal(filterPosts(posts, { search: 'RUST', state: 'draft' }).length, 1);
  assert.equal(filterPosts(posts, { search: '安全', state: 'published' })[0].slug, 'one');
  assert.equal(filterPosts(posts, { category: 'AI 与前沿科研' }).length, 1);
  assert.equal(posts.length, 3);
});
test('前台分类与标签统计只计算已发表文章，工作区分别统计草稿', () => {
  const taxonomy = collectTaxonomy(posts);
  assert.equal(taxonomy.categories['软件工程与系统'], 1);
  assert.equal(taxonomy.tags.LLM, undefined);
  assert.equal(taxonomy.tags.Rust, 1);
  assert.deepEqual(summarizeWorkspace({posts,media:[{}],settings:{friends:[]}}), {published:1,drafts:2,media:1,friends:0});
});
test('标签支持中英文逗号，去重并忽略空值', () => {
  assert.deepEqual(parseTags('Rust, Linux， Rust,  '), ['Rust','Linux']);
});
