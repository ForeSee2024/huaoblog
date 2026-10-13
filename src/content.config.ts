import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { postSchema } from './config/content-schema';
export const collections = {
  posts: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/posts', generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
    schema: postSchema,
  }),
};
