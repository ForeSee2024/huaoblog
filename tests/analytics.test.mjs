import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHttpRepository } from '../src/admin/http-repository.js';
import {
  analyticsPostRows,
  analyticsView,
  filterAndSortAnalyticsPosts,
  formatDuration,
  formatPercent,
} from '../src/admin/analytics-view.js';
import { createEngagementTracker } from '../src/lib/reading-tracker.js';
import { createContentHandler } from '../src/server/api.js';
import { createAuth } from '../src/server/auth.js';
import {
  MAX_DAILY_DURATION_PER_POST,
  MAX_DAILY_VIEWS_PER_TARGET,
  VIEW_COOLDOWN_MS,
  beijingDay,
  isBotUserAgent,
  normalizeAnalyticsTarget,
  shiftDay,
} from '../src/server/storage/analytics.js';
import { CONTENT_SCHEMA, createContentStore } from '../src/server/storage/content-store.js';
import { createNodeDatabase } from '../src/server/storage/sqlite.js';

const siteSettings = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const sessionsSchema = await readFile(new URL('../migrations/002_sessions.sql', import.meta.url), 'utf8');
const analyticsSchema = await readFile(new URL('../migrations/004_analytics.sql', import.meta.url), 'utf8');

const makePost = (slug = 'hello-world', title = '你好，世界', category = '软件工程与系统', pubDate = '2026-10-15') => ({
  slug,
  data: { title, description: '摘要', pubDate, category, tags: [] },
  body: '## 标题\n\n正文内容。',
});

async function setupAnalyticsDb(t) {
  const database = createNodeDatabase(':memory:');
  t.after(() => database.close());
  await database.exec(CONTENT_SCHEMA);
  await database.exec(sessionsSchema);
  await database.exec(analyticsSchema);
  let seq = 0;
  const store = createContentStore(database, {
    uuid: () => `rev-${++seq}`,
    now: () => '2026-10-15T01:00:00.000Z',
  });
  await store.saveSettings(siteSettings);
  return { database, store };
}

test('date helpers, bot detection and target normalization handle boundaries safely', () => {
  assert.equal(beijingDay(Date.parse('2026-10-15T15:59:59Z')), '2026-10-15');
  assert.equal(beijingDay(Date.parse('2026-10-15T16:00:00Z')), '2026-10-16');
  assert.equal(shiftDay('2026-10-15', -1), '2026-10-14');

  assert.equal(isBotUserAgent(''), true);
  assert.equal(isBotUserAgent('curl/8.4.0'), true);
  assert.equal(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBotUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'), false);

  assert.deepEqual(normalizeAnalyticsTarget('page', '/'), { targetType: 'page', targetKey: '/' });
  assert.deepEqual(normalizeAnalyticsTarget('page', '/posts/'), { targetType: 'page', targetKey: '/posts' });
  assert.deepEqual(normalizeAnalyticsTarget('post', 'my-post'), { targetType: 'post', targetKey: 'my-post' });
  assert.throws(() => normalizeAnalyticsTarget('page', '/admin'), error => error.status === 400);
  assert.throws(() => normalizeAnalyticsTarget('page', '/not-a-page'), error => error.status === 400);
  assert.throws(() => normalizeAnalyticsTarget('post', '../escape'), error => error.status === 400);
  assert.throws(() => normalizeAnalyticsTarget('other', 'x'), error => error.status === 400);
});

test('analytics store deduplicates cooldown views, enforces daily caps and isolates drafts', async t => {
  const { database, store } = await setupAnalyticsDb(t);
  await store.savePost(makePost('pub-a', '已发布文章 A', '软件工程与系统', '2026-10-10'), { publish: true });
  await store.savePost(makePost('draft-only', '纯草稿文章', '软件工程与系统', '2026-10-12'), { publish: false });

  const baseNow = Date.parse('2026-10-15T04:00:00Z'); // 北京时间 2026-10-15 12:00:00
  const reqA = new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    headers: { 'cf-connecting-ip': '203.0.113.10', 'user-agent': 'Mozilla/5.0 Browser A' },
  });
  const reqB = new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    headers: { 'cf-connecting-ip': '203.0.113.11', 'user-agent': 'Mozilla/5.0 Browser B' },
  });
  const day = beijingDay(baseNow);
  const hashA = await store.resolveVisitorHash(reqA, day);
  const hashB = await store.resolveVisitorHash(reqB, day);
  assert.equal(hashA.length, 32);
  assert.notEqual(hashA, hashB);

  const metaSalt = await database.all("SELECT value FROM analytics_meta WHERE key = 'visitor_salt'");
  assert.equal(metaSalt.length, 1);
  assert.ok(!JSON.stringify(metaSalt).includes('203.0.113'));

  // 纯草稿不会被统计
  assert.deepEqual(
    await store.recordAnalyticsView({ targetType: 'post', targetKey: 'draft-only', visitorHash: hashA, now: baseNow }),
    { accepted: false, reason: 'not_published' },
  );

  // 访客 A 浏览首页与文章 A
  assert.equal((await store.recordAnalyticsView({ targetType: 'page', targetKey: '/', visitorHash: hashA, now: baseNow })).accepted, true);
  assert.equal((await store.recordAnalyticsView({ targetType: 'post', targetKey: 'pub-a', visitorHash: hashA, now: baseNow + 1000 })).accepted, true);

  // 30 分钟冷却期内反复刷新不计数
  assert.equal((await store.recordAnalyticsView({ targetType: 'post', targetKey: 'pub-a', visitorHash: hashA, now: baseNow + VIEW_COOLDOWN_MS - 1000 })).reason, 'throttled');

  // 超过冷却期，一直达到单日单目标上限 (共 10 次)
  let tCursor = baseNow + 1000;
  for (let i = 1; i < MAX_DAILY_VIEWS_PER_TARGET; i += 1) {
    tCursor += VIEW_COOLDOWN_MS + 1000;
    const res = await store.recordAnalyticsView({ targetType: 'post', targetKey: 'pub-a', visitorHash: hashA, now: tCursor });
    assert.equal(res.accepted, true);
  }
  // 注：10 * 30 分钟约 5 小时，仍在同一北京时间自然日（12:00 -> 17:05）
  assert.equal(beijingDay(tCursor), day);
  const overCap = await store.recordAnalyticsView({
    targetType: 'post',
    targetKey: 'pub-a',
    visitorHash: hashA,
    now: tCursor + VIEW_COOLDOWN_MS + 1000,
  });
  assert.deepEqual(overCap, { accepted: false, reason: 'throttled' });

  // 访客 B 首访文章 A
  assert.equal((await store.recordAnalyticsView({ targetType: 'post', targetKey: 'pub-a', visitorHash: hashB, now: baseNow + 2000 })).accepted, true);

  // 过期访客哈希表清理（只删 2 天前的 visitors，不删 daily 汇总）
  const fourDaysLater = baseNow + 4 * 86400 * 1000;
  const hashBNew = await store.resolveVisitorHash(reqB, beijingDay(fourDaysLater));
  await store.recordAnalyticsView({ targetType: 'page', targetKey: '/posts', visitorHash: hashBNew, now: fourDaysLater });
  const oldVisitorRows = await database.all('SELECT * FROM analytics_visitors WHERE day = ?', [day]);
  assert.equal(oldVisitorRows.length, 0);

  const report = await store.getAnalyticsReport({ days: 7, now: fourDaysLater });
  assert.equal(report.daily.length, 7);
  assert.equal(report.summary.totalViews, 13); // 1(home) + 10(A->pub-a) + 1(B->pub-a) + 1(B->posts)
  assert.equal(report.summary.totalVisitors, 3); // day1: A & B (2), day5: BNew (1)
  assert.equal(report.posts.length, 1); // 草稿不出现
  assert.equal(report.posts[0].slug, 'pub-a');
  assert.equal(report.posts[0].totalViews, 11);
  assert.equal(report.posts[0].totalVisitors, 2);
});

test('engagement tracking accumulates duration up to daily cap, deduplicates completions and handles midnight crossover', async t => {
  const { store } = await setupAnalyticsDb(t);
  await store.savePost(makePost('deep-read', '长文阅读测试'), { publish: true });

  const day1 = Date.parse('2026-10-14T15:50:00Z'); // 北京时间 2026-10-14 23:50:00
  const day2 = Date.parse('2026-10-14T16:05:00Z'); // 北京时间 2026-10-15 00:05:00

  // 没有前置 view 的上报拒绝入库
  assert.deepEqual(
    await store.recordAnalyticsEngagement({ targetType: 'post', targetKey: 'deep-read', visitorHash: 'visitor-1', durationDelta: 20, completed: true, now: day1 }),
    { accepted: false, reason: 'no_session' },
  );
  // 非文章目标拒绝
  assert.deepEqual(
    await store.recordAnalyticsEngagement({ targetType: 'page', targetKey: '/', visitorHash: 'visitor-1', durationDelta: 20, now: day1 }),
    { accepted: false, reason: 'not_post' },
  );

  // 访客 1 在 23:50 打开文章，跨零点后上报停留与读完
  await store.recordAnalyticsView({ targetType: 'post', targetKey: 'deep-read', visitorHash: 'visitor-1', now: day1 });
  const firstEngage = await store.recordAnalyticsEngagement({
    targetType: 'post',
    targetKey: 'deep-read',
    visitorHash: 'visitor-1',
    durationDelta: 120,
    completed: false,
    now: day2,
  });
  assert.equal(firstEngage.accepted, true);
  assert.equal(firstEngage.day, '2026-10-14');
  assert.equal(firstEngage.appliedDuration, 120);

  // 同一会话多次递增停留时间（触发单日 1800s 封顶）与完成读完去重
  for (let i = 0; i < 6; i += 1) {
    await store.recordAnalyticsEngagement({
      targetType: 'post',
      targetKey: 'deep-read',
      visitorHash: 'visitor-1',
      durationDelta: 300,
      completed: true,
      now: day2 + (i + 1) * 1000,
    });
  }
  const capped = await store.recordAnalyticsEngagement({
    targetType: 'post',
    targetKey: 'deep-read',
    visitorHash: 'visitor-1',
    durationDelta: 60,
    completed: true,
    now: day2 + 10_000,
  });
  assert.deepEqual(capped, { accepted: false, reason: 'unchanged' });

  // 访客 2 在第二天浏览但仅读 30s 未读完
  await store.recordAnalyticsView({ targetType: 'post', targetKey: 'deep-read', visitorHash: 'visitor-2', now: day2 });
  await store.recordAnalyticsEngagement({
    targetType: 'post',
    targetKey: 'deep-read',
    visitorHash: 'visitor-2',
    durationDelta: 30,
    completed: false,
    now: day2 + 30_000,
  });

  const report = await store.getAnalyticsReport({ days: 7, now: day2 });
  const postStats = report.posts.find(item => item.slug === 'deep-read');
  assert.equal(postStats.totalViews, 2);
  assert.equal(postStats.totalVisitors, 2);
  assert.equal(postStats.completedReads, 1);
  assert.equal(postStats.completionRate, 0.5);
  // visitor-1 封顶 1800s，visitor-2 30s，两人样本平均 (1800+30)/2 = 915s
  assert.equal(postStats.avgReadSeconds, Math.round((MAX_DAILY_DURATION_PER_POST + 30) / 2));
});

test('analytics API ignores bots, admins and cross-origin probes, and enforces auth on report queries', async t => {
  const { database, store } = await setupAnalyticsDb(t);
  await store.savePost(makePost('api-post', 'API 统计文章'), { publish: true });

  const objects = new Map();
  const blobs = {
    async put(key, bytes) { objects.set(key, bytes); },
    async get(key) { const body = objects.get(key); return body ? { body, size: body.length } : null; },
    async delete(key) { objects.delete(key); },
  };
  const config = {
    backend: 'api',
    direct: true,
    apiUrl: '/api/v1',
    deployment: 'cloudflare',
    devAuth: false,
    siteUrl: 'https://huaoblog.cn',
    githubUserId: '160737293',
    sessionTtlSeconds: 3600,
  };
  const auth = createAuth(database, config, {
    fetch: async () => Response.json({ id: 160737293, login: 'ForeSee2024' }),
  });
  const login = await auth.login('gho_' + 'x'.repeat(40), new Request('https://huaoblog.cn/api/v1/session'));
  const adminCookie = login.cookie.split(';')[0];

  const handler = createContentHandler({ database, store, blobs, config });

  // 跨站伪造 Origin 被拒绝
  const crossOrigin = await handler(new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 Real' },
    body: JSON.stringify({ type: 'view', targetType: 'post', targetKey: 'api-post' }),
  }));
  assert.equal(crossOrigin.status, 403);

  // 爬虫静默返回 204，不写入统计
  const botRes = await handler(new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    method: 'POST',
    headers: { Origin: 'https://huaoblog.cn', 'Content-Type': 'application/json', 'user-agent': 'curl/8.5.0' },
    body: JSON.stringify({ type: 'view', targetType: 'post', targetKey: 'api-post' }),
  }));
  assert.equal(botRes.status, 204);

  // 已登录管理员访问前台也不计入（排除站长自刷）
  const adminVisit = await handler(new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    method: 'POST',
    headers: {
      Origin: 'https://huaoblog.cn',
      Cookie: adminCookie,
      'Content-Type': 'application/json',
      'user-agent': 'Mozilla/5.0 Admin',
    },
    body: JSON.stringify({ type: 'view', targetType: 'post', targetKey: 'api-post' }),
  }));
  assert.equal(adminVisit.status, 204);

  // 真实匿名访客上报浏览与阅读完成
  const visitorHeaders = {
    Origin: 'https://huaoblog.cn',
    'Content-Type': 'application/json',
    'user-agent': 'Mozilla/5.0 Visitor',
    'cf-connecting-ip': '198.51.100.7',
  };
  const viewRes = await handler(new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    method: 'POST',
    headers: visitorHeaders,
    body: JSON.stringify({ type: 'view', targetType: 'post', targetKey: 'api-post' }),
  }));
  assert.equal(viewRes.status, 204);

  const engageRes = await handler(new Request('https://huaoblog.cn/api/v1/analytics/collect', {
    method: 'POST',
    headers: visitorHeaders,
    body: JSON.stringify({ type: 'engage', targetType: 'post', targetKey: 'api-post', durationDelta: 45, completed: true }),
  }));
  assert.equal(engageRes.status, 204);

  // 未鉴权读取统计返回 401
  const unauthReport = await handler(new Request('https://huaoblog.cn/api/v1/analytics?days=7'));
  assert.equal(unauthReport.status, 401);

  // 通过 HttpRepository 以管理员身份读取统计
  const repo = createHttpRepository(config, {
    fetch: (path, options) => {
      const headers = new Headers(options.headers);
      headers.set('Cookie', adminCookie);
      if (options.method !== 'GET') headers.set('Origin', config.siteUrl);
      return handler(new Request(config.siteUrl + path, { ...options, headers }));
    },
  });
  const report = await repo.getAnalytics(7);
  assert.equal(report.rangeDays, 7);
  assert.equal(report.summary.totalViews, 1);
  assert.equal(report.summary.totalCompletedReads, 1);
  assert.equal(report.summary.avgReadSeconds, 45);
  assert.equal(report.posts.find(item => item.slug === 'api-post').totalViews, 1);
});

test('reading tracker measures active time, pauses when idle and deduplicates completion', () => {
  let current = 1000;
  let visible = true;
  let reachedEnd = false;
  const sent = [];

  const tracker = createEngagementTracker({
    targetType: 'post',
    targetKey: 'post-1',
    now: () => current,
    isVisible: () => visible,
    hasReachedEnd: () => reachedEnd,
    send: (payload, meta) => sent.push({ payload, meta }),
    idleLimitMs: 60_000,
    minReadForCompletionMs: 5_000,
  });

  tracker.start();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, { type: 'view', targetType: 'post', targetKey: 'post-1' });

  // 前 30 秒持续阅读并定时触发 tick（>= 15s 增量触发上报）
  current += 20_000;
  tracker.onInteraction(current);
  current += 10_000;
  tracker.tick(current);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].payload, {
    type: 'engage',
    targetType: 'post',
    targetKey: 'post-1',
    durationDelta: 30,
    completed: false,
  });

  // 挂机 120 秒（超过 idleLimitMs = 60s），自上次交互起最多再计满剩余的 50s（总无交互缓冲 10+50=60s）
  current += 120_000;
  tracker.tick(current);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].payload.durationDelta, 50);

  // 恢复交互并到达正文底部，且累计已远超 5s，触发读完标记并只发一次
  tracker.onInteraction(current);
  current += 6_000;
  reachedEnd = true;
  tracker.onInteraction(current);
  assert.equal(sent.length, 4);
  assert.equal(sent[3].payload.completed, true);

  // 切换标签页隐藏时使用 beacon 上报剩余增量，且不会再发送 completed: true
  current += 5_000;
  visible = false;
  tracker.onVisibilityChange(current);
  assert.equal(sent.length, 5);
  assert.equal(sent[4].meta.preferBeacon, true);
  assert.equal(sent[4].payload.completed, false);

  // 非文章页面仅发 view
  const pageSent = [];
  const pageTracker = createEngagementTracker({
    targetType: 'page',
    targetKey: '/',
    send: payload => pageSent.push(payload),
  });
  pageTracker.start();
  pageTracker.tick(999_999);
  pageTracker.onUnload(999_999);
  assert.deepEqual(pageSent, [{ type: 'view', targetType: 'page', targetKey: '/' }]);
});

test('analytics view helpers format metrics, sort/filter rows and escape untrusted titles', () => {
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration(45), '45 秒');
  assert.equal(formatDuration(125), '2 分 5 秒');
  assert.equal(formatDuration(3660), '1 小时 1 分');
  assert.equal(formatPercent(0.678), '68%');

  const posts = [
    { slug: 'a', title: 'Alpha', category: 'Rust', pubDate: '2026-10-01', status: 'published', totalViews: 10, totalVisitors: 5, rangeViews: 2, rangeVisitors: 2, avgReadSeconds: 180, completedReads: 4, completionRate: 0.8 },
    { slug: 'b', title: '<script>alert(1)</script>', category: '<img onerror=x>', pubDate: '2026-10-02', status: 'archived', totalViews: 50, totalVisitors: 25, rangeViews: 20, rangeVisitors: 10, avgReadSeconds: 30, completedReads: 5, completionRate: 0.2 },
  ];
  assert.deepEqual(filterAndSortAnalyticsPosts(posts, { sort: 'totalViews' }).map(p => p.slug), ['b', 'a']);
  assert.deepEqual(filterAndSortAnalyticsPosts(posts, { sort: 'completionRate' }).map(p => p.slug), ['a', 'b']);
  assert.deepEqual(filterAndSortAnalyticsPosts(posts, { sort: 'avgReadSeconds' }).map(p => p.slug), ['a', 'b']);
  assert.deepEqual(filterAndSortAnalyticsPosts(posts, { search: 'rust' }).map(p => p.slug), ['a']);

  const rowsHtml = analyticsPostRows(posts);
  assert.doesNotMatch(rowsHtml, /<script>|<img onerror/);
  assert.match(rowsHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rowsHtml, /已进回收站/);

  assert.match(analyticsView(null, {}), /请先登录管理员账号/);
  assert.match(analyticsView(null, { loading: true }), /正在汇总访问与阅读数据/);

  const html = analyticsView({
    rangeDays: 30,
    todayDay: '2026-10-15',
    startDay: '2026-09-16',
    summary: { todayViews: 3, todayVisitors: 2, rangeViews: 60, rangeVisitors: 30, totalViews: 60, totalVisitors: 30, totalCompletedReads: 9, avgReadSeconds: 95, completionRate: 0.3 },
    daily: [{ day: '2026-10-14', views: 20, visitors: 10, completedReads: 4, avgReadSeconds: 80 }, { day: '2026-10-15', views: 3, visitors: 2, completedReads: 1, avgReadSeconds: 95 }],
    posts,
    pages: [{ path: '/', label: '首页', totalViews: 10, totalVisitors: 8, rangeViews: 10, rangeVisitors: 8 }],
  }, { days: 30, selectedDay: '2026-10-14' });
  assert.match(html, /今日浏览 \(PV\)/);
  assert.match(html, /2026-10-14/);
  assert.match(html, /首页/);
});
