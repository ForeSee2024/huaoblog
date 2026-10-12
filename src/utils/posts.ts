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
 * 发布语义规范 (杜绝静默隐藏)：
 * 1. 网页后台日常写作：
 *    - 后台已移除表单草稿开关，完全由工作流状态 (Editorial Workflow) 控制；
 *    - 一旦文章在后台点击 Publish 合并入 main 分支，即代表博主确认上线。
 * 2. 本地 Git / Obsidian 写作兼容与显式告警：
 *    - 若文章显式包含 draft: true，在预览环境正常渲染以供自查；
 *    - 在生产环境构建 (main 分支) 时，若检测到 draft: true，系统将输出显式控制台提示，
 *      明确告知文章已按其声明排除，杜绝“合并成功却静默消失”引发的排查困惑。
 * 3. 未来日期无例外放行：
 *    - 彻底移除对未来日期的过滤拦截，pubDate 仅作为展示与排序元数据，避免定时时差误伤。
 */
export async function getPublishedPosts(options?: { forceIncludeDrafts?: boolean }): Promise<CollectionEntry<'posts'>[]> {
  const posts = await getCollection('posts');
  const allowDrafts = options?.forceIncludeDrafts ?? isPreviewEnvironment();

  return posts
    .filter(post => {
      if (post.data.draft) {
        if (!allowDrafts) {
          // 显式告警：告知该文章因本地 draft: true 被跳过，杜绝静默隐藏
          console.warn(
            `\x1b[33m[CONTENT NOTICE]\x1b[0m 文章 "${post.data.title}" (${post.id}) 包含 draft: true。在生产环境已按其声明排除。若需发布，请将 draft 修改为 false 或删除该字段。`
          );
          return false;
        }
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
