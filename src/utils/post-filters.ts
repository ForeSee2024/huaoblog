interface FilterablePost { category: string; tags: string[]; series?: string; }
export function matchesPostFilters(post: FilterablePost, params: URLSearchParams): boolean {
  const category = params.get('cat');
  const tag = params.get('tag');
  const series = params.get('series');
  return (!category || category === post.category) && (!tag || post.tags.includes(tag)) && (!series || series === post.series);
}
export function sortFeedPosts<T extends { data: { featured?: boolean; pubDate: Date } }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => Number(Boolean(b.data.featured)) - Number(Boolean(a.data.featured)) || b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
