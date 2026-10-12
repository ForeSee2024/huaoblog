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
 * 过滤与即时发布准则：
 * 1. 草稿过滤：
 *    - 正式生产构建 (main 分支) 严格排除 draft === true 的文章；
 *    - 若处于预览环境 (如 Cloudflare Pages 分支预览或本地开发)，放行草稿以便 Decap CMS 后台预览与校对。
 * 2. 时区与即时发布保护 (消除 UTC/北京时间 8 小时时差陷阱)：
 *    - 采用“即时发布优先”策略：作者在后台点击 Publish 并合并到 main 分支后即刻上线。
 *    - 对当天日期 (YYYY-MM-DD) 采取宽容放行保护：以北京时间 (UTC+8) 当日结束时刻为界，
 *      杜绝因 JavaScript 将 YYYY-MM-DD 解析为 UTC 00:00:00 (北京时间早 8:00) 导致早间构建被误判为未来文章的问题。
 */
export async function getPublishedPosts(options?: { forceIncludeDrafts?: boolean }): Promise<CollectionEntry<'posts'>[]> {
  const posts = await getCollection('posts');
  const allowDrafts = options?.forceIncludeDrafts ?? isPreviewEnvironment();
  
  // 计算北京时间当天结束时刻的 UTC 时间戳
  // 当前时间加上 8 小时偏移获取北京时间日期对象，并设置为当天 23:59:59.999
  const now = new Date();
  const cstTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const endOfTodayCST = new Date(Date.UTC(
    cstTime.getUTCFullYear(),
    cstTime.getUTCMonth(),
    cstTime.getUTCDate(),
    15, 59, 59, 999 // UTC 15:59:59 对应 CST 23:59:59
  ));

  return posts
    .filter(post => {
      // 1. 草稿过滤
      if (!allowDrafts && post.data.draft) return false;

      // 2. 远期定时文章过滤 (当天发布的文章无条件放行，只有超出当天 24 小时之后的未来文章在正式生产环境才拦截)
      if (!allowDrafts && post.data.pubDate.getTime() > endOfTodayCST.getTime()) {
        return false;
      }

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
