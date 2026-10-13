import { parseDocument, stringify } from 'yaml';

export const CATEGORIES = ['软件工程与系统', 'AI 与前沿科研', '极客安全与攻防', '计算机体系沉淀', '生活随笔与杂项'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_POST_BYTES = 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); return crc >>> 0; });

export class ContentError extends Error {
  constructor(message, status = 400, code = 'validation') { super(message); this.name = 'ContentError'; this.status = status; this.code = code; }
}

export function validateSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(value)) throw new ContentError('文章路径只能包含小写字母、数字和连字符，最多 120 个字符。');
  return value;
}

export function textField(value, label, max, required = false) {
  if (value == null || value === '') { if (required) throw new ContentError(`${label}必填。`); return ''; }
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ContentError(`${label}格式不正确，最多 ${max} 个字符。`);
  const result = value.trim();
  if (required && !result) throw new ContentError(`${label}必填。`);
  return result;
}

export function safeUrl(value, { local = true, optional = true, label = '网址' } = {}) {
  const url = textField(value, label, 2048, !optional);
  if (!url) return '';
  let decoded;
  try { decoded = decodeURIComponent(url); } catch { throw new ContentError(`${label}包含无效编码。`); }
  if (/[\s\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) throw new ContentError(`${label}必须是安全的站内路径或 HTTP / HTTPS 网址。`);
  if (local && decoded.startsWith('/') && !decoded.split(/[/?#]/).includes('..')) return url;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return url;
  } catch { throw new ContentError(`${label}必须是${local ? '安全的站内路径或 ' : ''}HTTP / HTTPS 网址。`); }
}

function dateField(value, label, required) {
  const date = textField(value, label, 10, required);
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new ContentError(`${label}请使用有效的 YYYY-MM-DD 日期。`);
  return date;
}

export function validatePost(input, { publish = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContentError('文章数据格式不正确。');
  const slug = validateSlug(input.slug);
  const data = input.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ContentError('文章信息格式不正确。');
  const title = textField(data.title, '标题', 100, publish);
  const description = textField(data.description, '摘要', 260, publish);
  const pubDate = dateField(data.pubDate, '发布日期', publish);
  const category = textField(data.category, '分类', 40, publish);
  if (category && !CATEGORIES.includes(category)) throw new ContentError('请选择有效的文章分类。');
  const tags = data.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 20) throw new ContentError('标签最多 20 个。');
  const normalized = { title, description, pubDate, category, tags: [...new Set(tags.map(tag => textField(tag, '标签', 40, true)))], series: textField(data.series, '专栏', 100), featured: data.featured ?? false, coverImage: safeUrl(data.coverImage, { label: '封面地址' }) };
  if (typeof normalized.featured !== 'boolean') throw new ContentError('精选状态必须为布尔值。');
  if (data.updatedDate) normalized.updatedDate = dateField(data.updatedDate, '更新日期', false);
  if (data.views != null && data.views !== '') normalized.views = textField(String(data.views), '阅读量', 30);
  if (data.extraMeta != null) {
    if (typeof data.extraMeta !== 'object' || Array.isArray(data.extraMeta)) throw new ContentError('扩展信息格式不正确。');
    const meta = data.extraMeta;
    const difficulty = textField(meta.difficulty, '难度', 10);
    if (difficulty && !['入门', '进阶', '硬核'].includes(difficulty)) throw new ContentError('请选择有效的文章难度。');
    normalized.extraMeta = { targetEvent: textField(meta.targetEvent, '赛事', 100), difficulty, paperDoi: textField(meta.paperDoi, '论文 DOI', 200), repoUrl: safeUrl(meta.repoUrl, { local: false, label: '仓库网址' }) };
  }
  if (typeof input.body !== 'string' || new TextEncoder().encode(input.body).length > MAX_POST_BYTES) throw new ContentError('文章正文必须为文本，且不能超过 1 MB。');
  if (publish && !input.body.trim()) throw new ContentError('正文必填。');
  return { slug, status: publish ? 'published' : 'draft', data: normalized, body: input.body, ...(typeof input.revision === 'string' ? { revision: input.revision } : {}), ...(typeof input.branch === 'string' ? { branch: input.branch } : {}) };
}

export function parsePost(source, slug, { draft = false, revision } = {}) {
  validateSlug(slug);
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new ContentError(`文章 ${slug} 缺少有效的 YAML 信息。`);
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw new ContentError(`文章 ${slug} 的 YAML 信息无法解析。`);
  let data;
  try { data = doc.toJS({ maxAliasCount: 0 }); } catch { throw new ContentError(`文章 ${slug} 不支持 YAML 别名。`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ContentError(`文章 ${slug} 的信息格式不正确。`);
  if (data.pubDate instanceof Date) data.pubDate = data.pubDate.toISOString().slice(0, 10);
  const isDraft = draft || data.draft === true;
  delete data.draft;
  return { slug, status: isDraft ? 'draft' : 'published', data, body: match[2].replace(/^\r?\n/, '').replace(/\r\n/g, '\n'), ...(revision ? { revision } : {}) };
}

export function stringifyPost(post) {
  const clean = validatePost(post, { publish: post.status === 'published' });
  const data = { ...clean.data, draft: clean.status === 'draft' };
  for (const key of Object.keys(data)) if (data[key] === '') delete data[key];
  if (data.extraMeta) { data.extraMeta = Object.fromEntries(Object.entries(data.extraMeta).filter(([, value]) => value !== '')); if (!Object.keys(data.extraMeta).length) delete data.extraMeta; }
  return `---\n${stringify(data, { lineWidth: 0 })}---\n\n${clean.body}`;
}

export function validateMediaName(name) {
  if (typeof name !== 'string' || name.includes('..') || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}\.(?:png|jpe?g|webp|gif|avif)$/i.test(name)) throw new ContentError('图片名称无效，仅支持 PNG、JPG、WebP、GIF 和 AVIF。');
  return name;
}

// Structural checks run on both upload paths; browsers also decode using createImageBitmap.
export function inspectMediaBytes(input, name) {
  validateMediaName(name);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ContentError('图片大小必须在 1 字节至 10 MB 之间。', 413);
  const ascii = (start, length) => new TextDecoder('latin1').decode(bytes.subarray(start, start + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = '';
  const invalid = () => { throw new ContentError('图片数据损坏，或文件内容与图片格式不符。'); };
  if (bytes.length >= 45 && [...bytes.subarray(0, 8)].join(',') === '137,80,78,71,13,10,26,10') {
    let offset = 8, imageData = false, end = false;
    if (ascii(12, 4) !== 'IHDR' || view.getUint32(8) !== 13 || !view.getUint32(16) || !view.getUint32(20)) invalid();
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), kind = ascii(offset + 4, 4);
      if (offset + length + 12 > bytes.length) invalid();
      let checksum = 0xffffffff;
      for (let index = offset + 4; index < offset + length + 8; index++) checksum = CRC_TABLE[(checksum ^ bytes[index]) & 255] ^ (checksum >>> 8);
      if (((checksum ^ 0xffffffff) >>> 0) !== view.getUint32(offset + length + 8)) invalid();
      if (kind === 'IDAT' && length > 0) imageData = true;
      offset += length + 12;
      if (kind === 'IEND') { if (length || offset !== bytes.length) invalid(); end = true; break; }
    }
    if (!imageData || !end) invalid();
    format = 'png';
  } else if (bytes.length >= 14 && /^GIF8[79]a$/.test(ascii(0, 6))) {
    if (!view.getUint16(6, true) || !view.getUint16(8, true) || bytes.at(-1) !== 0x3b || !bytes.includes(0x2c, 13)) invalid();
    format = 'gif';
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length || !['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 4)) || view.getUint32(16, true) + 20 > bytes.length) invalid();
    format = 'webp';
  } else if (bytes.length >= 16 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    let offset = 2, frame = false, scan = false;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) break;
      if (marker === 0xda) { scan = true; break; }
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8 || !view.getUint16(offset + 3) || !view.getUint16(offset + 5)) invalid();
        frame = true;
      }
      offset += length;
    }
    if (!frame || !scan) invalid();
    format = 'jpg';
  } else if (bytes.length >= 32 && ascii(4, 4) === 'ftyp') {
    const ftypLength = view.getUint32(0);
    if (ftypLength < 16 || ftypLength > bytes.length || !/avif|avis/.test(ascii(8, ftypLength - 8))) invalid();
    let offset = 0, metadata = false, imageData = false;
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset), kind = ascii(offset + 4, 4);
      if (length < 8 || offset + length > bytes.length) invalid();
      if (kind === 'meta') metadata = length > 12;
      if (kind === 'mdat') imageData = length > 8;
      offset += length;
    }
    if (offset !== bytes.length || !metadata || !imageData) invalid();
    format = 'avif';
  } else invalid();
  const extension = name.split('.').at(-1).toLowerCase().replace('jpeg', 'jpg');
  if (extension !== format) invalid();
  return { size: bytes.length, mime: `image/${format === 'jpg' ? 'jpeg' : format}`, extension: format };
}

export function normalizePercentEncoding(source) {
  return source.replace(/(?:%[a-fA-F0-9]{2})+/g, encoded => { try { return decodeURIComponent(encoded); } catch { return encoded; } });
}

export function findMediaReferences(url, posts, settings) {
  const target = url.startsWith('public/') ? `/${url.slice(7)}` : url;
  const contains = value => {
    const source = normalizePercentEncoding(JSON.stringify(value ?? {}));
    let start = source.indexOf(target);
    while (start !== -1) { const next = source[start + target.length]; if (!next || !/[a-zA-Z0-9._-]/.test(next)) return true; start = source.indexOf(target, start + 1); }
    return false;
  };
  const refs = posts.filter(contains).map(post => `文章「${post.data?.title || post.slug}」`);
  if (contains(settings)) refs.push('站点设置');
  return [...new Set(refs)];
}
