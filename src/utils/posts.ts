import { getCollection, type CollectionEntry } from 'astro:content';
import { selectPublishedPosts } from './post-policy';
export type BlogPost = CollectionEntry<'posts'> & { slug: string };
export function isPreviewEnvironment(): boolean {
  return !import.meta.env.PROD || process.env.SHOW_DRAFTS === 'true' || Boolean(process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== 'main');
}
export async function getPublishedPosts(options?: { forceIncludeDrafts?: boolean }): Promise<BlogPost[]> {
  const posts = selectPublishedPosts(await getCollection('posts'), options?.forceIncludeDrafts ?? isPreviewEnvironment());
  return posts.map(post => ({ ...post, slug: post.id }));
}
export function formatDate(date: Date): string { return date.toISOString().split('T')[0]; }
