import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    // 基础元数据
    title: z.string().min(1, '标题必填').max(100, '标题不可超过 100 字符'),
    description: z.string().min(1, '文章摘要必填').max(260, '摘要不可超过 260 字符'),
    pubDate: z.coerce.date(), // 兼容原生 Date 与 ISO/YYYY-MM-DD 字符串日期输入
    updatedDate: z.coerce.date().optional(),
    
    // 五大核心知识板块 (统一命名规范)
    category: z.enum([
      '软件工程与系统',
      'AI 与前沿科研',
      '极客安全与攻防',
      '计算机体系沉淀',
      '生活随笔与杂项'
    ]),
    
    // 标签、系列与状态
    tags: z.array(z.string()).default([]),
    series: z.string().optional(), // 跨领域或系列文章聚合
    featured: z.boolean().default(false),
    draft: z.boolean().default(false), // 草稿标记
    views: z.string().default('1,000+'),
    
    // 封面图 (支持本地 /images/posts/... 绝对路径或外部 CDN URL)
    coverImage: z.string().optional(),
    
    // 扩展信息
    extraMeta: z.object({
      targetEvent: z.string().optional(),
      difficulty: z.enum(['入门', '进阶', '硬核']).optional(),
      paperDoi: z.string().optional(),
      repoUrl: z.string().url().optional(),
    }).optional()
  }),
});

export const collections = {
  posts: postsCollection,
};
