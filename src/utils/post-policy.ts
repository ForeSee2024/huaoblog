interface PublishablePost { id: string; data: { title: string; pubDate: Date; draft?: boolean }; }
export function selectPublishedPosts<T extends PublishablePost>(posts: T[], allowDrafts: boolean): T[] {
  const drafts = posts.filter(post => post.data.draft);
  if (!allowDrafts && drafts.length) {
    const details = drafts.map(post => `  - ${post.data.title} (src/content/posts/${post.id})`).join('\n');
    throw new Error(`[PRODUCTION BUILD BLOCKED] 正式构建发现 ${drafts.length} 篇未发布草稿：\n${details}\n确认发布后删除 draft 字段或改为 false；未完成的文章请保留在草稿分支。`);
  }
  return [...posts].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
