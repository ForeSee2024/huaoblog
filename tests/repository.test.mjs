import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { stringifyPost } from '../src/admin/content-model.js';
const { createRepository } = await import('../src/admin/repository.js').catch(() => ({}));
const canonical = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const post = () => ({ slug: 'existing', status: 'published', data: { title: '已有文章', description: '摘要', pubDate: '2026-10-13', category: '软件工程与系统', tags: [] }, body: '原始正文。' });
const digest = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
function github() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map(), prs = [];
  const addBlob = content => { const bytes = Buffer.from(content), sha = createHash('sha1').update(bytes).digest('hex'); blobs.set(sha, bytes); return sha; };
  const initial = new Map([['src/data/site.json', addBlob(JSON.stringify(canonical))], ['src/content/posts/existing.md', addBlob(stringifyPost(post()))]]);
  const treeSha = digest([...initial]); trees.set(treeSha, initial);
  const head = digest({ tree: treeSha, parents: [] }); commits.set(head, { sha: head, tree: { sha: treeSha }, parents: [] }); refs.set('main', head);
  const calls = [];
  let checks = [{ status: 'completed', conclusion: 'success', name: 'build' }], statuses = [], truncate = false;
  const json = (value, status = 200) => Response.json(value, { status });
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url), method = options.method || 'GET', route = parsed.pathname.replace('/repos/test/blog', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method, route, body, headers: options.headers });
    if (route === '/graphql') {
      const pr = prs.find(item => item.node_id === body.variables.id);
      if (!pr) return json({ errors: [{ message: 'Not found' }] });
      pr.draft = body.query.includes('convertPullRequestToDraft');
      return json({ data: { result: { pullRequest: { id: pr.node_id } } } });
    }
    if (route === '') return json({ full_name: 'test/blog', permissions: { push: true } });
    const page = Number(parsed.searchParams.get('page') || 1), start = (page - 1) * 100;
    if (route === '/pulls' && method === 'GET') return json(prs.filter(pr => pr.state === 'open').slice(start, start + 100).map(pr => ({ ...pr, head: { ...pr.head, sha: refs.get(pr.head.ref) } })));
    if (route === '/git/refs' && method === 'POST') {
      const branch = body.ref.replace('refs/heads/', ''); if (refs.has(branch)) return json({ message: 'exists' }, 422);
      refs.set(branch, body.sha); return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    let match = route.match(/^\/git\/ref\/heads\/(.+)$/);
    if (match) { const sha = refs.get(decodeURIComponent(match[1])); return sha ? json({ object: { sha } }) : json({ message: 'missing' }, 404); }
    match = route.match(/^\/git\/refs\/heads\/(.+)$/);
    if (match && method === 'PATCH') {
      const branch = decodeURIComponent(match[1]); if (!commits.get(body.sha)?.parents.includes(refs.get(branch))) return json({ message: 'not a fast forward' }, 422);
      refs.set(branch, body.sha); return json({ object: { sha: body.sha } });
    }
    match = route.match(/^\/git\/commits\/([^/]+)$/);
    if (match) return commits.has(match[1]) ? json(commits.get(match[1])) : json({ message: 'missing' }, 404);
    match = route.match(/^\/git\/trees\/([^/]+)$/);
    if (match) {
      const files = trees.get(match[1]);
      if (!files) return json({ message: 'missing' }, 404);
      if (truncate && parsed.searchParams.has('recursive')) return json({ sha: match[1], tree: [], truncated: true });
      if (truncate) {
        const items = [], folders = new Set();
        for (const [path, sha] of files) {
          if (!path.includes('/')) items.push({ path, sha, type: 'blob', mode: '100644', size: blobs.get(sha).length });
          else folders.add(path.split('/')[0]);
        }
        for (const folder of folders) { const children = new Map([...files].filter(([name]) => name.startsWith(folder + '/')).map(([name, sha]) => [name.slice(folder.length + 1), sha])); const childSha = digest([...children]); trees.set(childSha, children); items.push({ path: folder, sha: childSha, type: 'tree', mode: '040000' }); }
        return json({ sha: match[1], tree: items, truncated: false });
      }
      return json({ sha: match[1], tree: [...files].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644', size: blobs.get(sha).length })), truncated: false });
    }
    match = route.match(/^\/git\/blobs\/([^/]+)$/);
    if (match) return json({ sha: match[1], encoding: 'base64', content: blobs.get(match[1]).toString('base64') });
    if (route === '/git/blobs' && method === 'POST') { const sha = addBlob(body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : body.content); return json({ sha }, 201); }
    if (route === '/git/trees' && method === 'POST') {
      const files = new Map(trees.get(body.base_tree));
      for (const item of body.tree) { if (item.sha === null) files.delete(item.path); else files.set(item.path, item.sha || addBlob(item.content)); }
      const sha = digest([...files]); trees.set(sha, files); return json({ sha }, 201);
    }
    if (route === '/git/commits' && method === 'POST') { const sha = digest(body); commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents }); return json({ sha }, 201); }
    if (route === '/pulls' && method === 'POST') {
      const number = prs.length + 1; const pr = { number, node_id: `PR_${number}`, title: body.title, body: body.body, draft: body.draft ?? false, state: 'open', html_url: `https://github.com/test/blog/pull/${number}`, mergeable: true, mergeable_state: 'clean', comparisonBase: refs.get('main'), head: { ref: body.head, sha: refs.get(body.head), repo: { full_name: 'test/blog' } }, base: { ref: body.base, repo: { full_name: 'test/blog' } } };
      prs.push(pr); return json(pr, 201);
    }
    match = route.match(/^\/pulls\/(\d+)(?:\/(files|merge))?$/);
    if (match) {
      const pr = prs.find(item => item.number === Number(match[1]));
      if (!pr) return json({ message: 'missing' }, 404);
      pr.head.sha = refs.get(pr.head.ref);
      if (match[2] === 'files') {
        const before = trees.get(commits.get(pr.comparisonBase).tree.sha), after = trees.get(commits.get(pr.head.sha).tree.sha);
        return json([...new Set([...before.keys(), ...after.keys()])].filter(name => before.get(name) !== after.get(name)).map(filename => ({ filename, status: after.has(filename) ? (before.has(filename) ? 'modified' : 'added') : 'removed' })));
      }
      if (match[2] === 'merge' && method === 'PUT') {
        assert.equal(body.sha, pr.head.sha); const after = commits.get(pr.head.sha); const sha = digest({ tree: after.tree.sha, parents: [refs.get('main'), pr.head.sha] }); commits.set(sha, { sha, tree: after.tree, parents: [refs.get('main'), pr.head.sha] }); refs.set('main', sha); pr.state = 'closed'; pr.merged = true; return json({ merged: true, sha });
      }
      if (method === 'PATCH') Object.assign(pr, body);
      return json(pr);
    }
    if (/\/commits\/.+\/check-runs$/.test(route)) return json({ total_count: checks.length, check_runs: checks.slice(start, start + 100) });
    if (/\/commits\/.+\/status$/.test(route)) return json({ state: statuses.length ? (statuses.every(item => item.state === 'success') ? 'success' : 'pending') : 'pending', total_count: statuses.length, statuses: statuses.slice(start, start + 100) });
    throw new Error(`Unexpected GitHub route: ${method} ${route}`);
  };
  const storage = { getItem: () => 'test-token', setItem() {}, removeItem() {} };
  const putMain = (path, content) => { const before = refs.get('main'), files = new Map(trees.get(commits.get(before).tree.sha)); files.set(path, addBlob(content)); const treeSha = digest([...files]); trees.set(treeSha, files); const sha = digest({ tree: treeSha, parents: [before] }); commits.set(sha, { sha, tree: { sha: treeSha }, parents: [before] }); refs.set('main', sha); };
  return { fetch, storage, refs, blobs, trees, commits, prs, calls, putMain, setChecks: value => { checks = value; }, setStatuses: value => { statuses = value; }, truncate: () => { truncate = true; } };
}
function repository(fake, extra = {}) {
  assert.equal(typeof createRepository, 'function', 'repository adapter is not implemented');
  return createRepository({ local: false, repo: 'test/blog', authUrl: 'https://auth.example', siteUrl: 'https://blog.example', branch: 'main' }, { fetch: fake.fetch, sessionStorage: fake.storage, ...extra });
}

test('unchanged synchronization reuses immutable snapshots while reading current heads', async t => {
  const fake = github(), repo = repository(fake);
  await repo.load();
  const start = fake.calls.length;
  await repo.load();
  const calls = fake.calls.slice(start);
  t.diagnostic(`unchanged synchronization: ${calls.length} API requests`);
  assert.equal(calls.some(call => /\/git\/(commits|trees|blobs)\//.test(call.route)), false);
  assert.ok(calls.some(call => call.route === '/git/ref/heads/main'));
  assert.ok(calls.length <= 4);
});

test('concurrent synchronization shares a single remote read', async () => {
  const fake = github(), repo = repository(fake);
  const states = await Promise.all([repo.load(), repo.load()]);
  assert.deepEqual(states[0], states[1]);
  assert.equal(fake.calls.filter(call => call.route === '/git/ref/heads/main').length, 1);
});

test('cold synchronization reads pending workspaces without waiting for the main tree', async () => {
  const fake = github(), seed = repository(fake);
  const initial = await seed.load();
  const draft = await seed.savePost({ ...initial.posts[0], body: '待同步草稿' });
  const mainTree = fake.commits.get(fake.refs.get('main')).tree.sha;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const start = fake.calls.length;
  const repo = repository(fake, { fetch: async (url, options) => {
    if (new URL(url).pathname.endsWith(`/git/trees/${mainTree}`)) await gate;
    return fake.fetch(url, options);
  } });
  const pending = repo.load();
  await new Promise(resolve => setImmediate(resolve));
  try { assert.ok(fake.calls.slice(start).some(call => call.route === `/git/commits/${draft.release.sha}`), 'pending branches should start loading while the main tree is in flight'); }
  finally { release(); await pending; }
});

test('writing a post avoids repeated full synchronization and returns its confirmed workspace', async t => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  const start = fake.calls.length;
  const saved = await repo.savePost({ ...initial.posts[0], body: '更快地保存。' });
  const calls = fake.calls.slice(start);
  t.diagnostic(`save existing article as a draft: ${calls.length} API requests`);
  assert.ok(calls.length <= 12, 'a single save should not rescan the complete workspace twice');
  assert.equal(saved.state.posts.find(item => item.status === 'draft').body, '更快地保存。');
  assert.equal(saved.state.posts.find(item => item.status === 'published').body, initial.posts[0].body);
  assert.equal(saved.state.releases[0].sha, saved.release.sha);
});

test('batch article deletion creates one commit and preserves main until reviewed publication', async () => {
  const fake = github(), repo = repository(fake);
  fake.putMain('src/content/posts/second.md', stringifyPost({ ...post(), slug: 'second' }));
  const state = await repo.load(), before = fake.refs.get('main');
  assert.equal(typeof repo.deletePosts, 'function');
  const result = await repo.deletePosts(state.posts);
  assert.equal(fake.refs.get('main'), before);
  assert.equal(fake.prs.length, 1);
  assert.equal(fake.calls.filter(call => call.method === 'POST' && call.route === '/git/commits').length, 1);
  assert.equal(result.deleted.length, 2);
  assert.ok(result.state.posts.every(item => item.pendingDeletion));
  assert.ok((await repo.load()).posts.every(item => item.pendingDeletion));
  await repo.publishRelease(result.release);
  assert.equal((await repo.load()).posts.length, 0);
});

test('batch deletion validates every revision before changing any branch', async () => {
  const fake = github(), repo = repository(fake);
  fake.putMain('src/content/posts/second.md', stringifyPost({ ...post(), slug: 'second' }));
  const state = await repo.load();
  fake.putMain('src/content/posts/second.md', stringifyPost({ ...post(), slug: 'second', body: '另一窗口已修改。' }));
  const before = [...fake.refs], start = fake.calls.length;
  assert.equal(typeof repo.deletePosts, 'function');
  await assert.rejects(repo.deletePosts(state.posts), /修改|刷新/);
  assert.deepEqual([...fake.refs], before);
  assert.equal(fake.calls.slice(start).some(call => call.method !== 'GET'), false);
});

test('batch deletion confirms an existing release after its final diff read fails', async () => {
  const fake = github();
  let fail = true;
  const repo = repository(fake, { fetch: (url, options = {}) => {
    if (fail && new URL(url).pathname.endsWith('/pulls/1/files')) {
      fail = false;
      return Promise.resolve(Response.json({ message: 'temporary' }, { status: 503 }));
    }
    return fake.fetch(url, options);
  } });
  const result = await repo.deletePosts((await repo.load()).posts);
  assert.equal(fake.prs.length, 1);
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.state.posts[0].pendingDeletion, true);
  assert.equal(result.release.id, fake.prs[0].number);
  assert.equal(result.release.sha, fake.prs[0].head.sha);
  assert.equal(result.release.state, 'review');
  assert.equal(result.refreshRequired, false);
});

test('batch deletion reconciles successful PR creation despite a failed response', async () => {
  const fake = github(), repo = repository(fake, { fetch: async (url, options = {}) => {
    const response = await fake.fetch(url, options);
    if (new URL(url).pathname.endsWith('/pulls') && options.method === 'POST') return Response.json({ message: 'temporary' }, { status: 503 });
    return response;
  } });
  const result = await repo.deletePosts((await repo.load()).posts);
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.release.id, fake.prs[0].number);
  assert.equal(result.state.posts[0].pendingDeletion, true);
});

test('batch draft withdrawal confirms a closed PR after its response fails', async () => {
  const fake = github(), repo = repository(fake, { fetch: async (url, options = {}) => {
    const response = await fake.fetch(url, options);
    if (new URL(url).pathname.endsWith('/pulls/1') && options.method === 'PATCH' && JSON.parse(options.body).state === 'closed') return Response.json({ message: 'temporary' }, { status: 503 });
    return response;
  } });
  const original = (await repo.load()).posts[0];
  const saved = await repo.savePost({ ...original, body: '修订草稿。' });
  const result = await repo.deletePosts(saved.state.posts.filter(item => item.status === 'draft'));
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.state.posts.length, 1);
  assert.equal(result.state.posts[0].body, original.body);
  assert.equal(result.release.state, 'closed');
});

test('pending media withdrawal confirms its updated branch after the diff read fails', async () => {
  const fake = github();
  let fail = false;
  const repo = repository(fake, { fetch: (url, options = {}) => {
    if (fail && new URL(url).pathname.endsWith('/pulls/1/files')) {
      fail = false;
      return Promise.resolve(Response.json({ message: 'temporary' }, { status: 503 }));
    }
    return fake.fetch(url, options);
  } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const saved = await repo.uploadMedia({ name: 'temporary.png', size: png.length, type: 'image/png', arrayBuffer: async () => png });
  fail = true;
  const result = await repo.deleteMediaBatch(saved.state.media);
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.state.media.length, 0);
  assert.equal(result.state.releases.length, 0);
  assert.equal(result.release.state, 'closed');
});

test('pending media withdrawal reconciles a successful branch update with a failed response', async () => {
  const fake = github();
  let fail = false;
  const repo = repository(fake, { fetch: async (url, options = {}) => {
    const response = await fake.fetch(url, options);
    if (fail && new URL(url).pathname.includes('/git/refs/heads/') && options.method === 'PATCH') {
      fail = false;
      return Response.json({ message: 'temporary' }, { status: 503 });
    }
    return response;
  } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const saved = await repo.uploadMedia({ name: 'temporary.png', size: png.length, type: 'image/png', arrayBuffer: async () => png });
  fail = true;
  const result = await repo.deleteMediaBatch(saved.state.media);
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.state.media.length, 0);
  assert.equal(result.release.state, 'closed');
});

test('batch draft withdrawal leaves published articles and reports partial network failures', async () => {
  const fake = github();
  const failingFetch = (url, options = {}) => {
    if (new URL(url).pathname.endsWith('/pulls/2') && options.method === 'PATCH' && JSON.parse(options.body).state === 'closed') return Promise.resolve(Response.json({ message: 'temporarily unavailable' }, { status: 503 }));
    return fake.fetch(url, options);
  };
  const repo = repository(fake, { fetch: failingFetch });
  const original = (await repo.load()).posts[0];
  await repo.savePost({ ...original, body: '修订草稿。' });
  await repo.savePost({ ...post(), slug: 'second-draft', status: 'draft', body: '另一草稿。' });
  const drafts = (await repo.load()).posts.filter(item => item.status === 'draft');
  assert.equal(typeof repo.deletePosts, 'function');
  const result = await repo.deletePosts(drafts);
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.state.posts.find(item => item.status === 'published').body, original.body);
  assert.equal(result.state.posts.filter(item => item.status === 'draft').length, 1);
  assert.equal(fake.prs[0].state, 'closed');
});

test('batch deletion rejects duplicate versions, oversized selections and repeated pending removals', async () => {
  const fake = github(), repo = repository(fake), state = await repo.load();
  assert.equal(typeof repo.deletePosts, 'function');
  await assert.rejects(repo.deletePosts([state.posts[0], state.posts[0]]), /重复/);
  await assert.rejects(repo.deletePosts(Array.from({ length: 101 }, (_, index) => ({ ...state.posts[0], slug: `item-${index}` }))), /100|数量/);
  const result = await repo.deletePosts([state.posts[0]]);
  await assert.rejects(repo.deletePosts(result.state.posts), /待删除|删除变更/);
  assert.equal(fake.prs.length, 1);
});

test('batch media deletion protects referenced files before staging the whole selection', async () => {
  const fake = github(), repo = repository(fake), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  fake.putMain('public/images/posts/one.png', png);
  fake.putMain('public/images/posts/two.png', png);
  fake.putMain('src/content/posts/existing.md', stringifyPost({ ...post(), body: '![使用中](/images/posts/one.png)' }));
  const state = await repo.load(), before = [...fake.refs];
  assert.equal(typeof repo.deleteMediaBatch, 'function');
  await assert.rejects(repo.deleteMediaBatch(state.media), /引用/);
  assert.deepEqual([...fake.refs], before);
  assert.equal(fake.prs.length, 0);
  fake.putMain('src/content/posts/existing.md', stringifyPost(post()));
  const result = await repo.deleteMediaBatch((await repo.load()).media);
  assert.equal(fake.prs.length, 1);
  assert.equal(result.deleted.length, 2);
  assert.ok(result.state.media.every(item => item.pendingDeletion));
  await repo.publishRelease(result.release);
  assert.equal((await repo.load()).media.length, 0);
});

test('batch publication refuses deletion files omitted from its declared selection', async () => {
  const fake = github(), repo = repository(fake);
  fake.putMain('src/content/posts/second.md', stringifyPost({ ...post(), slug: 'second' }));
  assert.equal(typeof repo.deletePosts, 'function');
  const result = await repo.deletePosts((await repo.load()).posts), head = fake.refs.get('main');
  const meta = JSON.parse(fake.prs[0].body.match(/<!-- huaovo-admin:(\{[^\n]*\}) -->/)[1]);
  meta.items = meta.items.slice(0, 1);
  fake.prs[0].body = `<!-- huaovo-admin:${JSON.stringify(meta)} -->`;
  await assert.rejects(repo.publishRelease(result.release), /范围|文件/);
  assert.equal(fake.refs.get('main'), head);
});

test('batch publication cannot disguise a published article removal as draft deletion', async () => {
  const fake = github(), repo = repository(fake);
  const result = await repo.deletePosts((await repo.load()).posts), head = fake.refs.get('main');
  const meta = JSON.parse(fake.prs[0].body.match(/<!-- huaovo-admin:(\{[^\n]*\}) -->/)[1]);
  meta.items[0].status = 'draft';
  fake.prs[0].body = `<!-- huaovo-admin:${JSON.stringify(meta)} -->`;
  await assert.rejects(repo.publishRelease(result.release), /版本|范围|文件/);
  assert.equal(fake.refs.get('main'), head);
});

test('GitHub draft editing preserves main and publishing stages a reviewed PR', async () => {
  const fake = github(), repo = repository(fake), originalHead = fake.refs.get('main');
  const loaded = await repo.load();
  const original = loaded.posts.find(item => item.status === 'published');
  let saved = await repo.savePost({ ...original, body: '更新后的正文。' });
  assert.equal(fake.refs.get('main'), originalHead);
  assert.equal(saved.post.status, 'draft');
  assert.equal(saved.release.state, 'draft');
  let staged = await repo.savePost(saved.post, { publish: true });
  assert.equal(staged.release.state, 'review');
  assert.equal(fake.refs.get('main'), originalHead);
  assert.equal(staged.post.pendingPublication, true);
  const state = await repo.load();
  assert.equal(state.posts.find(item => item.status === 'published').body, original.body);
  assert.equal(state.posts.find(item => item.status === 'draft').body, '更新后的正文。');
  const merged = await repo.publishRelease(staged.release);
  assert.equal(merged.release.state, 'merged');
  assert.notEqual(fake.refs.get('main'), originalHead);
  assert.equal((await repo.load()).posts.find(item => item.status === 'published').body, '更新后的正文。');
  assert.ok(fake.calls.filter(call => call.route.startsWith('/git/refs/heads/')).every(call => call.route !== '/git/refs/heads/main' && call.body.force === false));
});

test('publish refuses pending, failing, absent checks and stale PR heads', async () => {
  const fake = github(), repo = repository(fake), state = await repo.load();
  const staged = await repo.savePost({ ...state.posts[0], body: '新正文。' }, { publish: true });
  for (const checks of [[{ status: 'in_progress', conclusion: null }], [{ status: 'completed', conclusion: 'failure' }], []]) {
    fake.setChecks(checks);
    await assert.rejects(repo.publishRelease(staged.release), /检查/);
  }
  fake.setChecks([{ status: 'completed', conclusion: 'success' }]);
  await assert.rejects(repo.publishRelease({ ...staged.release, sha: 'stale' }), /更新|修改/);
  fake.prs[0].mergeable_state = 'blocked';
  await assert.rejects(repo.publishRelease(staged.release), /保护|合并/);
  assert.equal(fake.calls.some(call => call.route.endsWith('/merge')), false);
});

test('production settings and image writes stay in PRs, copy images into consuming post branch', async () => {
  const fake = github(), repo = repository(fake), mainHead = fake.refs.get('main');
  const initial = await repo.load();
  const settings = await repo.saveSettings({ ...initial.settings, identity: { ...initial.settings.identity, brand: '修改品牌' } });
  assert.equal(settings.release.state, 'review');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const image = new File([bytes], 'one.png', { type: 'image/png' });
  const uploaded = await repo.uploadMedia(image);
  assert.ok(uploaded.media.url.startsWith('blob:') || uploaded.media.url.startsWith('data:image/'));
  assert.match(uploaded.media.path, /^public\/images\/posts\/.+\.png$/);
  const saved = await repo.savePost({ ...initial.posts[0], body: `![图](${uploaded.media.publicUrl})` }, { publish: true });
  const branchFiles = fake.trees.get(fake.commits.get(fake.refs.get(saved.release.branch)).tree.sha);
  assert.ok(branchFiles.has(uploaded.media.path));
  assert.equal(fake.refs.get('main'), mainHead);
  await assert.rejects(repo.deleteMedia(uploaded.media), /引用/);
});

test('production stale content revision cannot overwrite a newer draft', async () => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  const first = await repo.savePost(initial.posts[0]);
  await repo.savePost({ ...first.post, body: '新的草稿' });
  await assert.rejects(repo.savePost(first.post), /修改|更新/);
});

test('OAuth popup only accepts messages from the expected popup and auth origin', async () => {
  const fake = github(), listeners = new Map(), popup = { closed: false, postMessage() {}, close() { this.closed = true; } };
  let stored;
  const window = { location: { origin: 'https://blog.example' }, open: () => popup, addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) };
  const repo = repository(fake, { window, sessionStorage: { getItem: () => null, setItem: (_key, token) => { stored = token; }, removeItem() {} } });
  const login = repo.login();
  const receive = listeners.get('message');
  receive({ origin: 'https://evil.example', source: popup, data: 'authorization:github:success:{"token":"bad"}' });
  receive({ origin: 'https://auth.example', source: {}, data: 'authorization:github:success:{"token":"bad"}' });
  assert.equal(stored, undefined);
  receive({ origin: 'https://auth.example', source: popup, data: 'authorization:github:success:{"token":"good","provider":"github"}' });
  await login;
  assert.equal(stored, 'good');
  assert.equal(listeners.has('message'), false);
});

test('GitHub loading traverses truncated trees and paginates open PRs', async () => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  const saved = await repo.savePost({ ...initial.posts[0], body: '草稿正文' });
  fake.prs.unshift(...Array.from({ length: 100 }, (_, index) => ({ number: index + 1000, state: 'open', head: { ref: `other-${index}`, repo: { full_name: 'elsewhere/repo' } }, base: { ref: 'main' } })));
  fake.truncate();
  const loaded = await repo.load();
  assert.equal(loaded.releases.find(item => item.id === saved.release.id).state, 'draft');
  assert.ok(loaded.posts.find(item => item.status === 'draft'));
  assert.ok(fake.calls.some(call => call.route.startsWith('/git/trees/') && !call.route.includes('?')));
});

test('publication reads all latest statuses and stops paginated checks at total_count', async () => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  const staged = await repo.savePost({ ...initial.posts[0], body: '发布内容' }, { publish: true });
  fake.setChecks(Array.from({ length: 100 }, (_, index) => ({ name: `check-${index}`, status: 'completed', conclusion: 'success' })));
  fake.setStatuses(Array.from({ length: 101 }, (_, index) => ({ context: `status-${index}`, state: 'success' })));
  const merged = await repo.publishRelease(staged.release);
  assert.equal(merged.release.state, 'merged');
  assert.equal(fake.calls.filter(call => call.route.endsWith('/check-runs')).length, 1);
});

test('an unused pending image can be withdrawn without leaving an empty release', async () => {
  const fake = github(), repo = repository(fake);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const uploaded = await repo.uploadMedia(new File([bytes], 'unused.png', { type: 'image/png' }));
  await repo.deleteMedia(uploaded.media);
  const loaded = await repo.load();
  assert.equal(loaded.media.length, 0);
  assert.equal(loaded.releases.length, 0);
});

test('image deletion publication rechecks references added after it was staged', async () => {
  const fake = github(), repo = repository(fake);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const uploaded = await repo.uploadMedia(new File([bytes], 'unused.png', { type: 'image/png' }));
  await repo.publishRelease(uploaded.release);
  const media = (await repo.load()).media[0];
  const deletion = await repo.deleteMedia(media);
  fake.putMain('src/content/posts/external.md', stringifyPost({ ...post(), slug: 'external', body: `![新引用](${media.publicUrl})` }));
  await assert.rejects(repo.publishRelease(deletion.release), /引用/);
});

test('a stale settings workspace does not invent article drafts after main changes', async () => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  await repo.saveSettings({ ...initial.settings, identity: { ...initial.settings.identity, brand: '待发布品牌' } });
  fake.putMain('src/content/posts/existing.md', stringifyPost({ ...post(), body: '主分支由其他窗口更新。' }));
  const loaded = await repo.load();
  assert.equal(loaded.posts.filter(item => item.status === 'draft').length, 0);
  assert.equal(loaded.posts.find(item => item.status === 'published').body, '主分支由其他窗口更新。');
  assert.equal(loaded.settings.identity.brand, '待发布品牌');
});

test('a stale media workspace does not restore old settings references', async () => {
  const fake = github(), repo = repository(fake);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  fake.putMain('public/images/posts/existing.png', bytes);
  fake.putMain('src/data/site.json', JSON.stringify({ ...canonical, identity: { ...canonical.identity, avatar: '/images/posts/existing.png' } }));
  await repo.uploadMedia(new File([bytes], 'pending.png', { type: 'image/png' }));
  fake.putMain('src/data/site.json', JSON.stringify(canonical));
  const existing = (await repo.load()).media.find(item => item.name === 'existing.png');
  const deleted = await repo.deleteMedia(existing);
  assert.equal(deleted.deleted.path, 'public/images/posts/existing.png');
});

test('a legacy draft in posts can be prepared and merged without deleting its body', async () => {
  const fake = github(), repo = repository(fake);
  fake.putMain('src/content/posts/imported.md', stringifyPost({ ...post(), slug: 'imported', status: 'draft', body: '导入草稿的正文。' }));
  const legacy = (await repo.load()).posts.find(item => item.slug === 'imported');
  assert.equal(legacy.status, 'draft');
  const staged = await repo.savePost(legacy, { publish: true });
  await repo.publishRelease(staged.release);
  const imported = (await repo.load()).posts.find(item => item.slug === 'imported');
  assert.equal(imported.status, 'published');
  assert.equal(imported.body, '导入草稿的正文。');
});

test('publication detects missing encoded image URLs alongside ordinary percent text', async () => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  const staged = await repo.savePost({ ...initial.posts[0], body: '100% complete\n\n![图](/images/posts/%6dissing.png)' }, { publish: true });
  await assert.rejects(repo.publishRelease(staged.release), /图片/);
});

test('legacy drafts are identified as unpublished and their deletion can be merged', async () => {
  const fake = github(), repo = repository(fake);
  fake.putMain('src/content/posts/imported.md', stringifyPost({ ...post(), slug: 'imported', status: 'draft' }));
  const legacy = (await repo.load()).posts.find(item => item.slug === 'imported');
  assert.equal(legacy.hasPublishedVersion, false);
  const deleted = await repo.deletePost(legacy);
  assert.equal(deleted.release.state, 'review');
  await repo.publishRelease(deleted.release);
  assert.equal((await repo.load()).posts.some(item => item.slug === 'imported'), false);
});

test('an active workspace replaces its older main draft in the visible article list', async () => {
  for (const folder of ['posts', 'drafts']) {
    const fake = github(), repo = repository(fake);
    fake.putMain(`src/content/${folder}/imported.md`, stringifyPost({ ...post(), slug: 'imported', status: 'draft', body: '旧正文' }));
    const original = (await repo.load()).posts.find(item => item.slug === 'imported');
    await repo.savePost({ ...original, body: '最新草稿正文' });
    const loaded = await repo.load(), drafts = loaded.posts.filter(item => item.slug === 'imported' && item.status === 'draft');
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].body, '最新草稿正文');
    assert.equal(drafts[0].hasPublishedVersion, false);
  }
});

test('resuming a prepared post after main changes shows only its editable draft', async () => {
  const fake = github(), repo = repository(fake), initial = await repo.load();
  await repo.savePost({ ...initial.posts[0], body: '待发布正文' }, { publish: true });
  fake.putMain('src/content/posts/existing.md', stringifyPost({ ...post(), body: '主分支的新正文' }));
  const pending = (await repo.load()).posts.find(item => item.status === 'draft');
  await repo.savePost({ ...pending, body: '继续编辑后的最新草稿' });
  const loaded = await repo.load();
  assert.equal(loaded.posts.filter(item => item.status === 'draft').length, 1);
  assert.equal(loaded.posts.find(item => item.status === 'draft').body, '继续编辑后的最新草稿');
  assert.equal(loaded.posts.find(item => item.status === 'published').body, '主分支的新正文');
});

test('article read-budget rejection happens before creating or updating a branch', async () => {
  const fake = github(), repo = repository(fake), body = 'x'.repeat(1024 * 1024);
  for (let index = 0; index < 24; index++) fake.putMain(`src/content/posts/bulk-${index}.md`, stringifyPost({ ...post(), slug: `bulk-${index}`, body }));
  const loaded = await repo.load(), before = [...fake.refs];
  await assert.rejects(repo.savePost(loaded.posts.find(item => item.slug === 'bulk-0')), /总大小|容量|读取限制/);
  assert.deepEqual([...fake.refs], before);
  assert.equal(fake.prs.length, 0);
});

function largePng(size, padding = 120) {
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const table = Uint32Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); return crc >>> 0; });
  const content = Buffer.alloc(size - original.length - 12, padding); content.write('padding\0');
  const chunk = Buffer.alloc(content.length + 12); chunk.writeUInt32BE(content.length); chunk.write('tEXt', 4); content.copy(chunk, 8);
  let crc = 0xffffffff; for (const value of chunk.subarray(4, -4)) crc = table[(crc ^ value) & 255] ^ (crc >>> 8); chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]);
}

test('several large pending images keep load, preview and withdrawal usable', async () => {
  const fake = github(), repo = repository(fake), images = [];
  for (let index = 0; index < 3; index++) {
    const bytes = largePng(9 * 1024 * 1024, 120 + index);
    const result = await repo.uploadMedia(new File([bytes], `large-${index}.png`, { type: 'image/png' }));
    assert.ok(result.media.url.startsWith('blob:'));
    images.push(result.media);
  }
  const loaded = await repo.load();
  assert.equal(loaded.media.length, 3);
  const preview = await repo.getMediaPreview(loaded.media[0]);
  assert.ok(preview.media.url.startsWith('blob:'));
  await repo.deleteMedia(images[2]);
  assert.equal((await repo.load()).media.length, 2);
});

test('an existing oversized pending library can load, delete and publish', async () => {
  const fake = github(), seed = repository(fake), bytes = largePng(9 * 1024 * 1024);
  const uploaded = await seed.uploadMedia(new File([bytes], 'initial.png', { type: 'image/png' }));
  const branch = uploaded.release.branch, previous = fake.refs.get(branch), entries = new Map(fake.trees.get(fake.commits.get(previous).tree.sha));
  for (let index = 0; index < 3; index++) { const altered = largePng(9 * 1024 * 1024, 121 + index); const sha = createHash('sha1').update(altered).digest('hex'); fake.blobs.set(sha, altered); entries.set(`public/images/posts/imported-${index}.png`, sha); }
  const treeSha = digest([...entries]); fake.trees.set(treeSha, entries); const head = digest({ tree: treeSha, parents: [previous] }); fake.commits.set(head, { sha: head, tree: { sha: treeSha }, parents: [previous] }); fake.refs.set(branch, head);
  const repo = repository(fake), loaded = await repo.load();
  assert.equal(loaded.media.length, 4);
  assert.ok(loaded.media.every(item => item.previewPending));
  await repo.deleteMedia(loaded.media[0]);
  const after = await repo.load();
  await repo.publishRelease(after.releases[0]);
  assert.equal((await repo.load()).media.length, 3);
});
