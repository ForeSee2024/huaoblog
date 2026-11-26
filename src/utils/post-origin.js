/** @typedef {'human' | 'ai'} PostOrigin */

/** @type {readonly PostOrigin[]} */
export const POST_ORIGINS = ['human', 'ai'];
/** @type {PostOrigin} */
export const DEFAULT_POST_ORIGIN = 'ai';

export const ORIGIN_DISPLAY = {
  human: {
    label: '手写',
    adminLabel: '手写',
    hint: '作者亲笔撰写',
    choiceLabel: '亲笔手写',
  },
  ai: {
    label: '整理',
    adminLabel: '整理 · AI',
    hint: '整理归档发布',
    choiceLabel: '整理发布 (AI)',
  },
};

/**
 * 规范化文章创作来源标识；未知非空值返回 null 供校验拒绝。
 * @param {unknown} value
 * @param {PostOrigin} [fallback]
 * @returns {PostOrigin | null}
 */
export function normalizePostOrigin(value, fallback = DEFAULT_POST_ORIGIN) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'human' || normalized === 'ai' ? normalized : null;
}

/**
 * 读取文章数据中的创作来源，缺失或旧数据按默认策略归类。
 * @param {any} post
 * @returns {PostOrigin}
 */
export function getPostOrigin(post) {
  const raw = post?.data?.origin ?? post?.origin;
  return normalizePostOrigin(raw, DEFAULT_POST_ORIGIN) || DEFAULT_POST_ORIGIN;
}

/**
 * 返回用于前后台界面展示的文案与元数据。
 * @param {unknown} value
 */
export function originMeta(value) {
  const key = normalizePostOrigin(value, DEFAULT_POST_ORIGIN) || DEFAULT_POST_ORIGIN;
  return { key, ...ORIGIN_DISPLAY[key] };
}
