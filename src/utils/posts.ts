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

  // 生产环境硬门禁：若处于正式构建 (main 分支) 且检测到任何 draft: true 的文章，直接阻断构建
  if (!allowDrafts) {
    const unreleasedDrafts = posts.filter(post => post.data.draft === true);
    if (unreleasedDrafts.length > 0) {
      const details = unreleasedDrafts
        .map(p => `  • "${p.data.title}" (文件: src/content/posts/${p.id})`)
        .join('\n');
      throw new Error(
        `\n=======================================================\n` +
        `[PRODUCTION BUILD BLOCKED] 生产发布构建阻断：发现未就绪的草稿文章合入生产环境！\n` +
        `=======================================================\n` +
        `检测到以下 ${unreleasedDrafts.length} 篇本地文章显式声明了 "draft: true"：\n` +
        `${details}\n\n` +
        `阻断原因与原则：\n` +
        `- 生产环境以 main 分支为唯一事实发布基准，严禁将草稿文章直接带入线上生产环境；\n` +
        `- 为杜绝静默隐藏（即构建看似成功、但在前台无法找到文章引发排查迷惑），系统在生产构建期强制阻断未就绪草稿；\n\n` +
        `修复指引：\n` +
        `1. 若该文章已编写完成并确认发布：请删除其 Frontmatter 中的 draft 字段或将其修改为 false；\n` +
        `2. 若该文章仍在编写中：请将其保存在草稿分支 (PR) 或本地环境调试，切勿合入 main 分支。\n` +
        `=======================================================\n`
      );
    }
  }

  return posts
    .filter(post => allowDrafts || post.data.draft !== true)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/**
 * 格式化展示日期 (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
