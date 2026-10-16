import { execFileSync } from 'node:child_process';
import { ContentError, inspectMediaBytes, parsePost, validatePost } from '../admin/content-model.js';
import { validateSettings } from '../admin/settings-model.js';
import { validateSnapshot } from './storage/content-store.js';
import { sha256 } from './auth.js';

export async function snapshotFromGit({ cwd, publishedRef = 'origin/main', settingsRef, mediaRef, exportedAt = new Date().toISOString() }) {
  const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const pin = ref => {
    if (typeof ref !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,199}$/.test(ref)) throw new ContentError('Git 来源分支或提交格式无效。');
    return git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim();
  };
  const published = pin(publishedRef), settingsHead = settingsRef ? pin(settingsRef) : null, mediaHead = mediaRef ? pin(mediaRef) : null;
  const list = (ref, ...paths) => git('ls-tree', '-rz', '--name-only', ref, '--', ...paths).toString().split('\0').filter(Boolean);
  const read = (ref, path) => git('show', `${ref}:${path}`);
  const revision = () => crypto.randomUUID();
  const baseSettings = validateSettings(JSON.parse(read(published, 'src/data/site.json').toString('utf8')));
  const draftSettings = settingsHead ? validateSettings(JSON.parse(read(settingsHead, 'src/data/site.json').toString('utf8'))) : null;
  const snapshot = { format: 'huaovo-content', formatVersion: 1, exportedAt, settings: { revision: revision(), published: baseSettings, draft: draftSettings && JSON.stringify(draftSettings) !== JSON.stringify(baseSettings) ? draftSettings : null, updatedAt: exportedAt }, posts: [], media: [], history: [] };
  const posts = new Map(), objects = new Map();
  for (const path of list(published, 'src/content/posts', 'src/content/drafts')) {
    const match = path.match(/^src\/content\/(posts|drafts)\/([a-z0-9-]+)\.mdx?$/); if (!match) continue;
    const parsed = parsePost(read(published, path).toString('utf8'), match[2], { draft: match[1] === 'drafts' });
    const post = validatePost(parsed, { publish: parsed.status === 'published' });
    const aggregate = posts.get(post.slug) || { slug: post.slug, revision: revision(), published: null, draft: null, publishedDeletedAt: null, draftDeletedAt: null, updatedAt: exportedAt };
    if (aggregate[post.status]) throw new ContentError(`文章存在重复版本：${post.slug}`);
    aggregate[post.status] = post; posts.set(post.slug, aggregate);
  }
  snapshot.posts = [...posts.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const images = new Map();
  async function image(ref, path, publicImage) {
    const name = path.slice('public/images/posts/'.length), bytes = new Uint8Array(read(ref, path)), info = inspectMediaBytes(bytes, name), checksum = await sha256(bytes);
    const previous = images.get(name);
    if (previous) { if (previous.checksum !== checksum) throw new ContentError(`不同分支的同名图片内容冲突：${name}`); previous.public ||= publicImage; return; }
    const objectKey = `media/${name}`;
    const record = { name, objectKey, path, publicUrl: `/images/posts/${name}`, size: info.size, mime: info.mime, contentType: info.mime, checksum, revision: revision(), public: publicImage, deletedAt: null, createdAt: exportedAt, updatedAt: exportedAt };
    images.set(name, record); objects.set(objectKey, bytes);
  }
  for (const path of list(published, 'public/images/posts')) if (/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) await image(published, path, true);
  if (mediaHead) {
    const ancestor = git('merge-base', published, mediaHead).toString().trim();
    const changed = git('diff', '--name-only', '-z', '--diff-filter=AM', ancestor, mediaHead, '--', 'public/images/posts').toString().split('\0').filter(Boolean);
    for (const path of changed) if (/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) await image(mediaHead, path, false);
  }
  snapshot.media = [...images.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { snapshot: validateSnapshot(snapshot), objects, provenance: { format: 'huaovo-git-migration', formatVersion: 1, exportedAt, published: { ref: publishedRef, sha: published }, pendingSettings: settingsHead ? { ref: settingsRef, sha: settingsHead } : null, pendingMedia: mediaHead ? { ref: mediaRef, sha: mediaHead } : null, counts: { published: snapshot.posts.filter(post => post.published).length, drafts: snapshot.posts.filter(post => post.draft).length, media: snapshot.media.length, pendingSettings: Boolean(snapshot.settings.draft) } } };
}
