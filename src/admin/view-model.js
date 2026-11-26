import { getPostOrigin } from "../utils/post-origin.js";

export function filterPosts(
  posts,
  { search = "", state = "all", category = "", tag = "", origin = "", sort = "" } = {},
) {
  const query = search.trim().toLocaleLowerCase();
  const matched = posts.filter(
    (post) =>
      (state === "all" || state === post.status) &&
      (!origin || getPostOrigin(post) === origin) &&
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
  if (!sort) return matched;
  const sorters = {
    newest: (a, b) =>
      String(b.data.pubDate || "").localeCompare(String(a.data.pubDate || "")) ||
      String(a.slug).localeCompare(String(b.slug)),
    oldest: (a, b) =>
      String(a.data.pubDate || "").localeCompare(String(b.data.pubDate || "")) ||
      String(a.slug).localeCompare(String(b.slug)),
    title: (a, b) =>
      String(a.data.title || a.slug).localeCompare(String(b.data.title || b.slug), "zh-CN"),
  };
  return sorters[sort] ? [...matched].sort(sorters[sort]) : matched;
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
export function collectAllKnownTags(posts = []) {
  const freq = new Map();
  for (const post of posts) {
    for (const tag of post.data?.tags || []) {
      if (tag) freq.set(tag, (freq.get(tag) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([tag]) => tag);
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
