import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentError } from '../src/admin/content-model.js';
const publication = await import('../src/admin/publication.js').catch(() => ({}));
const release = { id: 7, branch: 'huaovo/delete-posts-abc', sha: 'exact-head' };

test('publication waits for pending checks and returns the confirmed merged state', async () => {
  assert.equal(typeof publication.publishWhenReady, 'function');
  let time = 0;
  const calls = [], progress = [], merged = { state: { posts: [] }, release: { state: 'merged' } };
  const repo = { async publishRelease(target) { calls.push({ ...target }); if (calls.length < 3) throw new ContentError('checks pending', 409, 'checks_pending'); return merged; } };
  const result = await publication.publishWhenReady(repo, release, { clock: () => time, delay: async ms => { time += ms; }, onProgress: message => progress.push(message) });
  assert.equal(result, merged);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(target => target.sha === 'exact-head' && target.id === 7 && target.branch === release.branch));
  assert.ok(progress.length >= 2);
});

test('publication never retries failures, ambiguous writes or changed versions', async () => {
  assert.equal(typeof publication.publishWhenReady, 'function');
  for (const code of ['checks_failed', 'conflict', 'connection', 'github_error', 'permission', 'merge_blocked']) {
    let calls = 0, pauses = 0;
    const error = new ContentError('stop here', 409, code);
    await assert.rejects(publication.publishWhenReady({ async publishRelease() { calls++; throw error; } }, release, { delay: async () => { pauses++; } }), value => value === error);
    assert.equal(calls, 1);
    assert.equal(pauses, 0);
  }
});

test('publication pending timeout retains a clear continuation message', async () => {
  assert.equal(typeof publication.publishWhenReady, 'function');
  let time = 0, calls = 0;
  await assert.rejects(publication.publishWhenReady({ async publishRelease() { calls++; throw new ContentError('still running', 409, 'checks_pending'); } }, release, { timeoutMs: 10000, clock: () => time, delay: async ms => { time += ms; } }), error => error.code === 'checks_pending' && /发布与连接/.test(error.message));
  assert.equal(time, 10000);
  assert.equal(calls, 2);
});

test('publication retries preserve the selected version if the caller object changes', async () => {
  assert.equal(typeof publication.publishWhenReady, 'function');
  const selected = { ...release }, calls = [];
  const repo = { async publishRelease(target) { calls.push({ ...target }); if (calls.length === 1) throw new ContentError('pending', 409, 'checks_pending'); return { state: {}, release: { state: 'merged' } }; } };
  await publication.publishWhenReady(repo, selected, { delay: async () => { selected.sha = 'changed-after-selection'; } });
  assert.equal(calls[1].sha, 'exact-head');
});

test('publication resumes only with a confirmed update of the same release branch', async () => {
  let calls = 0, updates = 0;
  const repo = {
    async publishRelease(target) { calls++; if (target.sha === release.sha) throw new ContentError('behind main', 409, 'merge_blocked'); return { release: { state: 'merged' } }; },
    async prepareRelease(target) { updates++; return { ...target, sha: 'confirmed-base-update' }; },
  };
  const result = await publication.publishWhenReady(repo, release);
  assert.equal(result.release.state, 'merged');
  assert.equal(calls, 2);
  assert.equal(updates, 1);
});

test('publication rejects a base update that changes release identity', async () => {
  let calls = 0;
  await assert.rejects(publication.publishWhenReady({
    async publishRelease() { calls++; throw new ContentError('blocked', 409, 'merge_blocked'); },
    async prepareRelease(target) { return { ...target, id: 99, sha: 'different' }; },
  }, release), error => error.code === 'conflict');
  assert.equal(calls, 1);
});

test('only declared deletion releases automatically publish after removal', () => {
  assert.equal(typeof publication.isDeletionPublication, 'function');
  for (const kind of ['post-delete', 'draft-delete', 'post-delete-batch', 'media-delete-batch']) assert.equal(publication.isDeletionPublication({kind,state:'review'}), true);
  for (const value of [{kind:'post',state:'review'},{kind:'media',state:'review'},{kind:'settings',state:'review'},{kind:'post-delete-batch',state:'closed'}]) assert.equal(publication.isDeletionPublication(value), false);
});
