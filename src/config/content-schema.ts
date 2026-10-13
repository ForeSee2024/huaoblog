import { z } from 'astro/zod';
import { categories } from './site.ts';

const emptyToUndefined = (value: unknown) => value === null || (typeof value === 'string' && !value.trim()) ? undefined : value;
export const postSchema = z.object({
  title: z.string().trim().min(1, '标题必填').max(100, '标题不可超过 100 字符'),
  description: z.string().trim().min(1, '文章摘要必填').max(260, '摘要不可超过 260 字符'),
  pubDate: z.preprocess(emptyToUndefined, z.coerce.date()),
  updatedDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  category: z.enum(categories),
  tags: z.preprocess(value => value ?? [], z.array(z.string().trim().min(1)).default([])),
  series: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
  views: z.preprocess(emptyToUndefined, z.string().optional()),
  coverImage: z.preprocess(emptyToUndefined, z.string().optional()),
  extraMeta: z.preprocess(emptyToUndefined, z.object({
    targetEvent: z.preprocess(emptyToUndefined, z.string().optional()),
    difficulty: z.preprocess(emptyToUndefined, z.enum(['入门', '进阶', '硬核']).optional()),
    paperDoi: z.preprocess(emptyToUndefined, z.string().optional()),
    repoUrl: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/, error: '请填写完整的 HTTP 或 HTTPS 仓库网址' }).optional()),
  }).optional()),
});
