import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * 判断当前是否处于草稿预览环境
 * 满足以下任一条件时，生成草稿文章以供作者审核预览：
 * 1. 处于本地开发调试环境 (!import.meta.env.PROD)
 * 2. 环境变量明确指定 SHOW_DRAFTS === 'true'
 * 3. 处于 Cloudflare Pages 分支预览环境 (CF_PAGES_BRANCH 存在且不等于 'main')
 */
export function isPreviewEnvironment(): boolean {
  if (!import.meta.env.PROD) return true;
  if (process.env.SHOW_DRAFTS === 'true') return true;
  if (process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== 'main') return true;
  return false;
}

/**
 * 获取符合发布状态的文章列表
 * 
 * 核心准则 (单一发布状态与即时生效)：
 * 1. 发布状态唯一性：
 *    - 线上可见性完全由是否合并入生产分支 (main) 决定；
 *    - 在 main 分支正式构建中，仅过滤显式标有 draft === true 的本地测试草稿；
 *    - 若处于预览分支 (如 Cloudflare Pages 分支预览或本地开发)，放行所有草稿。
 * 2. 彻底废除未来日期隐藏限制 (零例外即时发布)：
 *    - 既然第一版已取消每日定时重建，pubDate 仅作为文章卡片展示与倒序排列的时间戳；
 *    - 彻底移除对未来日期的过滤拦截，作者无论选择当天还是未来日期，一旦在后台点击 Publish 合并入 main，
 *      文章 100% 即刻在线可见，彻底消除“显示已发布却找不到文章”的逻辑陷阱。
 */
export async function getPublishedPosts(options?: { forceIncludeDrafts?: boolean }): Promise<CollectionEntry<'posts'>[]> {
  const posts = await getCollection('posts');
  const allowDrafts = options?.forceIncludeDrafts ?? isPreviewEnvironment();

  return posts
    .filter(post => {
      // 仅在正式环境过滤明确声明 draft === true 的文章
      if (!allowDrafts && post.data.draft) return false;
      return true;
    })
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/**
 * 格式化展示日期 (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
