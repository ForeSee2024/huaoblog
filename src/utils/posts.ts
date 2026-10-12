import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * 获取经过安全过滤的已发布文章列表
 * 规则：
 * 1. 过滤草稿 (draft === true)；
 * 2. 在生产构建环境自动排除未来发布日期的文章 (pubDate > now)；
 * 3. 默认按发布时间倒序排序 (最新在前)。
 */
export async function getPublishedPosts(): Promise<CollectionEntry<'posts'>[]> {
  const posts = await getCollection('posts');
  const now = new Date();
  const isProd = import.meta.env.PROD;

  return posts
    .filter(post => {
      // 排除草稿
      if (post.data.draft) return false;
      // 生产环境排除未来定时发布的文章
      if (isProd && post.data.pubDate > now) return false;
      return true;
    })
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/**
 * 格式化展示日期 (UTC+8 对应中文显示)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
