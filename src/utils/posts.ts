import type { CollectionEntry } from 'astro:content';

type PostData = CollectionEntry<'posts'>['data'];
interface StoredPost {
  slug: string;
  status: string;
  data: Omit<PostData, 'pubDate' | 'updatedDate'> & { pubDate: string | Date; updatedDate?: string | Date };
  revision: string;
  body?: string;
  bodyLoaded?: boolean;
}
export interface PublicPostStore {
  getPublishedPosts(): Promise<StoredPost[]>;
  getPost(slug: string, status: string): Promise<StoredPost | null>;
}
export type BlogPost = Omit<StoredPost, 'data'> & { id: string; data: PostData };

function toBlogPost(post: StoredPost): BlogPost {
  return {
    ...post,
    id: post.slug,
    data: {
      ...post.data,
      pubDate: new Date(post.data.pubDate),
      updatedDate: post.data.updatedDate ? new Date(post.data.updatedDate) : undefined,
    },
  };
}

export async function getPublishedPosts(store: Pick<PublicPostStore, 'getPublishedPosts'>): Promise<BlogPost[]> {
  const posts = await store.getPublishedPosts();
  return posts.map(toBlogPost).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getPublishedPost(store: Pick<PublicPostStore, 'getPost'>, slug: string): Promise<BlogPost | null> {
  try {
    const post = await store.getPost(slug, 'published');
    return post ? toBlogPost(post) : null;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 400 && 'code' in error && error.code === 'validation') return null;
    throw error;
  }
}

export function formatDate(date: Date): string { return date.toISOString().split('T')[0]; }
