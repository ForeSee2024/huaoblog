export const RECOVERY_PREFIX = 'huaovo-recovery:';

/** 判断一篇草稿快照是否包含用户输入过的内容，避免恢复空壳或用空壳覆盖旧草稿。 */
export function hasDraftContent(post) {
  if (!post || typeof post !== 'object') return false;
  const data = post.data || {};
  return Boolean(
    String(data.title || '').trim() ||
    String(data.description || '').trim() ||
    String(post.body || '').trim()
  );
}

/** 构造浏览器本地草稿暂存键名（与历史版本兼容，绝不更改命名规则）。 */
export function buildRecoveryKey(repo, route, slug) {
  const scope = repo || 'local';
  const slot = route === 'editor/new' ? 'new' : slug || 'new';
  return `${RECOVERY_PREFIX}${scope}:${slot}`;
}

/**
 * 扫描浏览器 localStorage 中未同步的草稿恢复记录，按保存时间降序返回。
 * 兼容旧版写入的数据格式 `{ post, savedAt }`。
 */
export function scanLocalDrafts(storage, repo = 'local', remotePosts = []) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return [];
  const prefix = `${RECOVERY_PREFIX}${repo || 'local'}:`;
  const found = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    try {
      const raw = JSON.parse(storage.getItem(key) || 'null');
      const post = raw?.post;
      if (!hasDraftContent(post)) continue;
      const slot = key.slice(prefix.length) || 'new';
      const slug = post.slug || slot;
      const targetRoute = slot === 'new' ? 'editor/new' : `editor/${slug}/${post.status || 'draft'}`;
      const matchedRemote = slot === 'new'
        ? null
        : remotePosts.find((item) => item.slug === slug && item.status === (post.status || 'draft'))
          || remotePosts.find((item) => item.slug === slug);
      found.push({
        key,
        slot,
        slug,
        route: targetRoute,
        title: String(post.data?.title || '').trim() || (slot === 'new' ? '未命名新草稿' : slug),
        description: String(post.data?.description || '').trim(),
        savedAt: Number(raw?.savedAt) || 0,
        remoteExists: Boolean(matchedRemote),
        post,
      });
    } catch {
      // 忽略损坏的本地条目，保持安全读取
    }
  }
  return found.sort((a, b) => b.savedAt - a.savedAt);
}

/** 生成登录弹窗所需的场景标题与草稿保护提示。 */
export function buildLoginPromptCopy({ route = '', activePost = null, dirty = false, localDrafts = [], reason = 'welcome' } = {}) {
  const currentHasContent = Boolean(activePost && (dirty || hasDraftContent(activePost)));
  const draftTitles = [];
  if (currentHasContent) {
    draftTitles.push(String(activePost.data?.title || '').trim() || '当前正在编辑的草稿');
  }
  for (const item of localDrafts) {
    if (draftTitles.length >= 2) break;
    if (currentHasContent && route === 'editor/new' && item.slot === 'new') continue;
    if (currentHasContent && activePost?.slug && item.slug === activePost.slug) continue;
    if (!draftTitles.includes(item.title)) draftTitles.push(item.title);
  }
  const hasPendingDraft = currentHasContent || localDrafts.length > 0;
  const expiredOrAction = reason === 'expired' || reason === 'action';
  const title = expiredOrAction ? '登录会话已失效，请重新登录' : '欢迎回到内容工作室';
  const description = expiredOrAction
    ? '管理操作需要验证管理员身份。登录后将自动延续会话（365 天有效，访问后台自动续期）。'
    : '当前处于未登录只读状态，授权登录后即可编辑保存草稿、发布文章与查看完整统计（会话 365 天有效并自动续期）。';
  const draftNotice = hasPendingDraft
    ? `已为你安全锁定浏览器中的未保存草稿（${draftTitles.join('、')}${localDrafts.length > draftTitles.length ? ` 等 ${localDrafts.length} 篇` : ''}）。登录过程不会清空或覆盖当前内容，授权完成后即可直接保存。`
    : '';
  return {
    title,
    description,
    hasPendingDraft,
    draftNotice,
  };
}
