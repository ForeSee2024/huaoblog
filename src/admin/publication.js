import { ContentError } from './content-model.js';

export async function publishWhenReady(repository, release, options = {}) {
  let target = { id: release.id, branch: release.branch, sha: release.sha };
  const clock = options.clock || Date.now;
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 120000;
  const started = clock();
  const timeout = () => new ContentError('检查仍在运行，变更已保存。请在“发布与连接”继续发布。', 409, 'checks_pending');
  let attempted = false, prepared = false;
  while (true) {
    if (attempted && clock() - started >= timeoutMs) throw timeout();
    attempted = true;
    try { return await repository.publishRelease(target); }
    catch (error) {
      if (error.code === 'merge_blocked' && !prepared && repository.prepareRelease) {
        prepared = true;
        const next = await repository.prepareRelease(target);
        if (next.id !== target.id || next.branch !== target.branch || typeof next.sha !== 'string' || !next.sha) throw new ContentError('发布版本已改变，请刷新后重新核对。', 409, 'conflict');
        if (next.sha === target.sha) throw error;
        target = { id: next.id, branch: next.branch, sha: next.sha };
        options.onProgress?.('发布分支已同步，正在等待新的构建检查…');
        continue;
      }
      if (error.code !== 'checks_pending') throw error;
      const remaining = timeoutMs - (clock() - started);
      if (remaining <= 0) throw timeout();
      options.onProgress?.(`正在等待发布检查完成…（${Math.floor((clock() - started) / 1000)} 秒）`);
      await delay(Math.min(5000, remaining));
    }
  }
}

export function isDeletionPublication(release) {
  return release.state === 'review' && ['post-delete', 'draft-delete', 'post-delete-batch', 'media-delete-batch'].includes(release.kind);
}
