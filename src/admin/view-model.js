export function filterPosts(
  posts,
  { search = "", state = "all", category = "", tag = "" } = {},
) {
  const query = search.trim().toLocaleLowerCase();
  return posts.filter(
    (post) =>
      (state === "all" || state === post.status) &&
      (!category || post.data.category === category) &&
      (!tag || (post.data.tags || []).includes(tag)) &&
      (!query ||
        [
          post.data.title,
          post.data.description,
          post.slug,
          ...(post.data.tags || []),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
  );
}
export function collectTaxonomy(posts) {
  const categories = {},
    tags = {},
    series = {};
  for (const post of posts.filter((post) => post.status === "published")) {
    if (post.data.category)
      categories[post.data.category] =
        (categories[post.data.category] || 0) + 1;
    for (const tag of new Set(post.data.tags || []))
      tags[tag] = (tags[tag] || 0) + 1;
    if (post.data.series)
      series[post.data.series] = (series[post.data.series] || 0) + 1;
  }
  return { categories, tags, series };
}
export function summarizeWorkspace({ posts = [], media = [], settings = {} }) {
  return {
    published: posts.filter((post) => post.status === "published").length,
    drafts: posts.filter((post) => post.status === "draft").length,
    media: media.length,
    friends: (settings.friends || []).length,
  };
}
export const parseTags = (value) => [
  ...new Set(
    String(value)
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];
