import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit production HTTP gate; intentionally excluded from tests/*.test.mjs.
// Run with: node tests/runtime-node.integration.mjs
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'huaovo-node-http-'));
const dataDir = join(temporary, 'data');
const children = new Set();
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
let completed = 0;
let stopping = false;

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function port() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const value = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return value;
}

function launch(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const processState = { child, logs: '', settled: false, error: undefined };
  const capture = chunk => { processState.logs = (processState.logs + chunk).slice(-64000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  processState.finished = new Promise(resolve => {
    child.once('error', error => { processState.error = error; processState.settled = true; resolve(null); });
    child.once('exit', code => { processState.settled = true; resolve(code); });
  });
  children.add(processState);
  return processState;
}

async function stop(processState) {
  if (!processState || processState.settled) return;
  processState.child.kill('SIGTERM');
  let timer;
  await Promise.race([processState.finished, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
  clearTimeout(timer);
  if (!processState.settled) { processState.child.kill('SIGKILL'); await processState.finished; }
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(stop));
  await rm(temporary, { recursive: true, force: true });
}

const interrupt = signal => {
  void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
};
const onInterrupt = () => interrupt('SIGINT');
const onTerminate = () => interrupt('SIGTERM');
process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);

async function stage(label, work) {
  await work();
  process.stdout.write(`PASS ${++completed}: ${label}\n`);
}

async function fetchAt(base, pathname, options = {}) {
  return fetch(base + pathname, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options });
}

async function page(base, pathname, status = 200) {
  const response = await fetchAt(base, pathname);
  const html = await response.text();
  assert.equal(response.status, status, `${pathname}: ${response.status}\n${html.slice(0, 1000)}`);
  assert.match(response.headers.get('Cache-Control') || '', /no-store/, `${pathname} must not cache dynamic HTML`);
  return html;
}

async function api(base, pathname, { method = 'GET', data, body, headers = {}, status = 200 } = {}) {
  const response = await fetchAt(base, `/api/v1/${pathname}`, {
    method,
    headers: { ...(method !== 'GET' ? { Origin: base } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(data !== undefined ? { body: JSON.stringify(data) } : body ? { body } : {}),
  });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${pathname}: ${response.status}\n${text.slice(0, 1000)}`);
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  return JSON.parse(text);
}

async function start(base, authenticated) {
  const processState = launch(process.execPath, ['dist/server/entry.mjs'], {
    ...process.env, NODE_ENV: 'production', APP_DATA_DIR: dataDir, APP_DEV_AUTH: authenticated ? '1' : '0',
    SITE_URL: base, HOST: '127.0.0.1', PORT: new URL(base).port,
    ADMIN_GITHUB_ID: '100000001', CMS_AUTH_URL: 'https://auth.example.invalid', ASTRO_NODE_LOGGING: 'disabled',
  });
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (processState.settled) throw new Error(`Node server exited during startup: ${processState.error || ''}\n${processState.logs}`);
    try {
      const response = await fetchAt(base, '/api/v1/session', { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) {
        const session = await response.json();
        assert.equal(session.connection.authenticated, authenticated);
        return processState;
      }
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await pause(100);
  }
  throw new Error(`Node server did not become ready\n${processState.logs}`);
}

function fixtureSettings() {
  return {
    identity: { name: 'Node integration fixture', brand: 'HTTP-LAB', author: 'Fixture Author', description: 'A local HTTP integration fixture.', avatar: '/favicon.svg', tagline: 'Local fixture', bio: 'Fixture biography', socialLinks: [] },
    home: { eyebrow: 'INTEGRATION', title: 'Initial home fixture', intro: 'Fixture introduction', primaryLabel: 'Read fixture', secondaryLabel: 'About fixture', announcementEnabled: true, announcementTitle: 'Fixture notice', announcement: 'Local test announcement', feedTitle: 'Fixture feed', postsPerPage: 6 },
    navigation: [{ label: 'Fixture home', href: '/', enabled: true }, { label: 'Fixture posts', href: '/posts', enabled: true }, { label: 'Fixture archive', href: '/archive', enabled: true }, { label: 'Fixture about', href: '/about', enabled: true }, { label: 'Fixture friends', href: '/friends', enabled: true }],
    appearance: { theme: 'light', accent: 'cyberblue', backgroundEffect: false },
    about: { title: 'Fixture about title', subtitle: 'Fixture subtitle', body: '## Fixture about\n\nInitial about fixture.', introduction: 'Fixture introduction', languages: 'English', operatingSystems: [], coverImage: '', tools: [], githubEnabled: false },
    friends: [{ name: 'Fixture friend', url: 'https://friend.example.invalid', description: 'Fixture friend description' }],
    footer: { text: 'Initial fixture footer', icp: '', icpUrl: '' },
  };
}

function article(slug, body, title = 'HTTP publication fixture') {
  return { slug, data: { title, description: 'A production runtime fixture.', pubDate: '2026-10-15', category: '软件工程与系统', tags: ['HTTP-fixture'] }, body };
}

async function expectImage(base, pathname, status, expectedBytes = png, etag) {
  for (const method of ['GET', 'HEAD']) {
    const response = await fetchAt(base, pathname, { method, ...(etag ? { headers: { 'If-None-Match': etag } } : {}) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, status, `${method} ${pathname}`);
    if (method === 'HEAD') assert.equal(bytes.length, 0);
    if (status === 200) {
      assert.equal(response.headers.get('Content-Type'), 'image/png');
      assert.equal(Number(response.headers.get('Content-Length')), expectedBytes.length);
      assert.ok(response.headers.get('ETag'));
      if (method === 'GET') assert.deepEqual(bytes, expectedBytes);
    } else if (status === 404) assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  }
}

let primary, anonymous;
try {
  const primaryPort = await port();
  let anonymousPort;
  do { anonymousPort = await port(); } while (anonymousPort === primaryPort);
  const origin = `http://127.0.0.1:${primaryPort}`;
  const publicOrigin = `http://127.0.0.1:${anonymousPort}`;

  await stage('build the official Node production runtime', async () => {
    const build = launch(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:node'], { ...process.env, SITE_URL: origin, DEPLOY_TARGET: 'node' });
    const code = await build.finished;
    assert.equal(code, 0, `Production build failed\n${build.logs}`);
  });

  await stage('empty store returns public 503 while admin and local authentication remain available', async () => {
    primary = await start(origin, true);
    await page(origin, '/', 503);
    const admin = await page(origin, '/admin/');
    assert.match(admin, /CONTENT STUDIO/);
    assert.equal((await api(origin, 'session')).connection.writable, true);
    anonymous = await start(publicOrigin, false);
    assert.equal((await api(publicOrigin, 'session')).connection.authenticated, false);
    for (const method of ['GET', 'HEAD']) assert.equal((await fetchAt(origin, '/images/posts/Scorify-a2cb09b9.jpg', { method })).status, 404, 'Source image must never bypass the database media route');
  });

  let settings;
  await stage('settings writes immediately refresh every public page and shared component', async () => {
    settings = (await api(origin, 'settings', { method: 'PUT', data: { settings: fixtureSettings() } })).settings;
    assert.match(await page(publicOrigin, '/'), /Initial home fixture/);
    settings = (await api(origin, 'settings', { method: 'PUT', data: { settings: {
      ...settings, identity: { ...settings.identity, name: 'Fresh site identity marker', brand: 'FRESH-LAB' },
      home: { ...settings.home, title: 'Fresh homepage marker' },
      navigation: settings.navigation.map((link, index) => index === 0 ? { ...link, label: 'Fresh navigation marker' } : link),
      appearance: { ...settings.appearance, theme: 'dark', accent: 'violet' },
      about: { ...settings.about, body: '## Fresh about marker\n\nUpdated about fixture.' },
      friends: [{ name: 'Fresh friend marker', url: 'https://friend.example.invalid', description: 'Updated friend fixture' }],
      footer: { ...settings.footer, text: 'Fresh footer marker' },
    } } })).settings;
    for (const pathname of ['/', '/posts/', '/archive/', '/about/', '/friends/']) {
      const html = await page(publicOrigin, pathname);
      assert.match(html, /FRESH-LAB/); assert.match(html, /Fresh navigation marker/); assert.match(html, /Fresh footer marker/);
      assert.match(html, /data-theme="dark"/); assert.match(html, /data-accent="violet"/);
      assert.doesNotMatch(html, /Initial fixture footer/);
    }
    assert.match(await page(publicOrigin, '/'), /Fresh homepage marker/);
    assert.match(await page(publicOrigin, '/about/'), /Fresh about marker/);
    assert.match(await page(publicOrigin, '/friends/'), /Fresh friend marker/);
  });

  const slug = 'http-integration-post';
  let draft, image, initialPublishedRevision;
  const needle = 'runtime-text-needle-7e4c';
  await stage('draft bodies stay out of public routes, listings and live search', async () => {
    draft = (await api(origin, 'posts', { method: 'POST', data: { post: article(slug, 'DRAFT_ONLY_SENTINEL_7e4c'), publish: false } })).post;
    await page(publicOrigin, `/posts/${slug}/`, 404);
    assert.doesNotMatch(await page(publicOrigin, '/posts/'), /HTTP publication fixture/);
    assert.deepEqual((await api(publicOrigin, 'search?q=DRAFT_ONLY_SENTINEL_7e4c')).results, []);
    assert.deepEqual((await api(publicOrigin, 'content')).posts, []);
    await api(publicOrigin, `posts/${slug}?status=draft`, { status: 401 });
  });

  await stage('new uploads are private through real GET and HEAD media routes', async () => {
    const form = new FormData(); form.set('file', new File([png], 'http-fixture.png', { type: 'image/png' }));
    image = (await api(origin, 'media', { method: 'POST', body: form })).media;
    await expectImage(origin, image.publicUrl, 200);
    await expectImage(publicOrigin, image.publicUrl, 404);
  });

  await stage('publishing immediately renders sanitized Markdown, TOC, full-text search and public image bytes', async () => {
    const body = `## Runtime integration heading\n\nPublished body marker ${needle}.\n\n### Duplicate heading\n\nFirst section.\n\n### Duplicate heading\n\nSecond section.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`javascript\nconst liveValue = 42;\n\`\`\`\n\nInline $x^2$.\n\n$$\\frac{a}{b}$$\n\n<script>window.__integrationUnsafe = true;</script>\n\n[unsafe](javascript:alert%281%29)\n\n![fixture](${image.publicUrl})`;
    const published = (await api(origin, 'posts', { method: 'POST', data: { post: { ...draft, body }, publish: true } })).post;
    initialPublishedRevision = published.revision;
    const html = await page(publicOrigin, `/posts/${slug}/`);
    for (const pattern of [/Published body marker/, /<table>/, /hljs-keyword/, /class="katex"/, /id="runtime-integration-heading"/, /href="#runtime-integration-heading"/, /id="duplicate-heading-1"/]) assert.match(html, pattern);
    assert.doesNotMatch(html, /window\.__integrationUnsafe|href="javascript:/i);
    assert.ok(html.includes(image.publicUrl));
    const results = (await api(publicOrigin, `search?q=${needle}`)).results;
    assert.equal(results.length, 1); assert.equal(results[0].url, `/posts/${slug}/`);
    assert.equal(results[0].title, published.data.title);
    assert.match(await page(publicOrigin, '/archive/'), /HTTP publication fixture/);
    await expectImage(publicOrigin, image.publicUrl, 200);
  });

  const escaped = '\\'.repeat(600 * 1024);
  await stage('private revisions remain private and valid heavily escaped bodies pass the JSON wire limit', async () => {
    const published = (await api(origin, `posts/${slug}?status=published`)).post;
    await api(origin, 'posts', { method: 'POST', data: { post: { ...published, body: 'PRIVATE_EDIT_ONLY_7e4c' }, publish: false } });
    const html = await page(publicOrigin, `/posts/${slug}/`);
    assert.match(html, /Published body marker/); assert.doesNotMatch(html, /PRIVATE_EDIT_ONLY_7e4c/);
    assert.deepEqual((await api(publicOrigin, 'search?q=PRIVATE_EDIT_ONLY_7e4c')).results, []);
    const payload = { post: article('escaped-body', escaped, 'Escaped draft fixture'), publish: false };
    assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length > 1153434);
    await api(origin, 'posts', { method: 'POST', data: payload });
    assert.equal((await api(origin, 'posts/escaped-body?status=draft')).post.body, escaped);
    await page(publicOrigin, '/posts/escaped-body/', 404);
    assert.ok((await api(origin, 'content')).posts.every(post => post.bodyLoaded === false && post.body === undefined));
  });

  await stage('soft deletion removes article/search/media immediately, including conditional GET and HEAD', async () => {
    const published = (await api(origin, `posts/${slug}?status=published`)).post;
    const etag = (await fetchAt(publicOrigin, image.publicUrl, { method: 'HEAD' })).headers.get('ETag');
    const removed = await api(origin, 'posts/delete', { method: 'POST', data: { posts: [published] } });
    assert.equal(removed.deleted.length, 1); assert.deepEqual(removed.failed, []);
    await page(publicOrigin, `/posts/${slug}/`, 404);
    assert.deepEqual((await api(publicOrigin, `search?q=${needle}`)).results, []);
    const currentImage = (await api(origin, 'content')).media.find(item => item.name === image.name);
    const deleted = await api(origin, 'media/delete', { method: 'POST', data: { media: [currentImage] } });
    assert.equal(deleted.deleted.length, 1); assert.deepEqual(deleted.failed, []);
    await expectImage(publicOrigin, image.publicUrl, 404, png, etag);
    await expectImage(origin, image.publicUrl, 404);
  });

  await stage('trash restoration enforces image dependencies and restores both published URLs', async () => {
    let trash = await api(origin, 'trash');
    const item = trash.posts.find(post => post.slug === slug && post.status === 'published');
    assert.ok(item); assert.ok(trash.media.some(media => media.name === image.name));
    await api(origin, 'trash/restore', { method: 'POST', data: { kind: 'post', item }, status: 409 });
    await api(origin, 'trash/restore', { method: 'POST', data: { kind: 'media', item: trash.media.find(media => media.name === image.name) } });
    trash = await api(origin, 'trash');
    await api(origin, 'trash/restore', { method: 'POST', data: { kind: 'post', item: trash.posts.find(post => post.slug === slug && post.status === 'published') } });
    assert.match(await page(publicOrigin, `/posts/${slug}/`), /Published body marker/);
    await expectImage(publicOrigin, image.publicUrl, 200);
  });

  await stage('history rollback restores published text while retaining public media access', async () => {
    let current = (await api(origin, `posts/${slug}?status=published`)).post;
    current = (await api(origin, 'posts', { method: 'POST', data: { post: { ...current, body: 'SECOND_PUBLISHED_BODY_7e4c' }, publish: true } })).post;
    assert.match(await page(publicOrigin, `/posts/${slug}/`), /SECOND_PUBLISHED_BODY_7e4c/);
    const history = await api(origin, `history?kind=post&id=${slug}`);
    assert.ok(history.versions.some(version => version.revision === initialPublishedRevision));
    await api(origin, 'history/restore', { method: 'POST', data: { kind: 'post', id: slug, revision: initialPublishedRevision, expectedRevision: current.revision } });
    const html = await page(publicOrigin, `/posts/${slug}/`);
    assert.match(html, /Published body marker/); assert.doesNotMatch(html, /SECOND_PUBLISHED_BODY_7e4c/);
    const currentImage = (await api(origin, 'content')).media.find(item => item.name === image.name);
    await api(origin, 'history/restore', { method: 'POST', data: { kind: 'media', id: image.name, revision: image.revision, expectedRevision: currentImage.revision } });
    await expectImage(publicOrigin, image.publicUrl, 200);
    assert.equal((await api(publicOrigin, `search?q=${needle}`)).results.length, 1);
  });

  await stage('restarting production Node preserves settings, full articles, drafts and image objects', async () => {
    const before = await api(origin, 'content');
    await Promise.all([stop(primary), stop(anonymous)]);
    primary = await start(origin, true); anonymous = await start(publicOrigin, false);
    const after = await api(origin, 'content');
    assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.posts, before.posts); assert.deepEqual(after.media, before.media);
    assert.match(await page(publicOrigin, '/'), /Fresh homepage marker/);
    assert.match(await page(publicOrigin, `/posts/${slug}/`), /Published body marker/);
    assert.equal((await api(origin, 'posts/escaped-body?status=draft')).post.body, escaped);
    await expectImage(publicOrigin, image.publicUrl, 200);
    assert.equal((await fetchAt(publicOrigin, '/images/posts/Scorify-a2cb09b9.jpg')).status, 404);
  });

  process.stdout.write(`Node production HTTP integration passed: ${completed} stages.\n`);
} catch (error) {
  process.stderr.write(`Node production HTTP integration failed after ${completed} stages:\n${error.stack || error}\n`);
  for (const processState of children) if (processState.logs && !processState.settled) process.stderr.write(`Server log tail:\n${processState.logs.slice(-8000)}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
}
