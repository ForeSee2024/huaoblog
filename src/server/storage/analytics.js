import { ContentError, validateSlug } from '../../admin/content-model.js';
import { getPostOrigin } from '../../utils/post-origin.js';
import { sha256 } from '../auth.js';

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
export const VIEW_COOLDOWN_MS = 30 * 60 * 1000;
export const MAX_DAILY_VIEWS_PER_TARGET = 10;
export const MAX_ENGAGE_DELTA_SECONDS = 300;
export const MAX_DAILY_DURATION_PER_POST = 1800;
const VISITOR_RETENTION_DAYS = 2;
const KNOWN_VISITOR_RETENTION_DAYS = 180;
const VALID_VISITOR_ID = /^[a-zA-Z0-9_-]{12,64}$/;

export const ALLOWED_PAGES = new Map([
  ['/', '首页'],
  ['/posts', '文章列表'],
  ['/archive', '文章归档'],
  ['/about', '关于我'],
  ['/friends', '友情链接'],
]);

const BOT_UA_PATTERN = /bot|crawler|spider|slurp|mediapartners|facebookexternalhit|bingpreview|twitterbot|telegrambot|slackbot|discordbot|whatsapp|applebot|bytespider|petalbot|semrush|ahrefs|mj12bot|dotbot|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|curl\/|wget\/|python-requests|go-http-client|java\/|node-fetch|undici|axios\//i;

const REFERRER_RULES = [
  [/^(?:www\.)?google\./i, 'Google 搜索'],
  [/^(?:www\.|cn\.)?bing\.com$/i, 'Bing 搜索'],
  [/^(?:www\.|m\.)?baidu\.com$/i, '百度搜索'],
  [/^(?:www\.)?sogou\.com$/i, '搜狗搜索'],
  [/^(?:www\.)?so\.com$/i, '360 搜索'],
  [/^(?:www\.)?duckduckgo\.com$/i, 'DuckDuckGo'],
  [/^(?:www\.|gist\.)?github\.com$/i, 'GitHub'],
  [/^(?:t\.co|(?:www\.|mobile\.)?(?:x|twitter)\.com)$/i, 'X / Twitter'],
  [/^(?:www\.|zhuanlan\.)?zhihu\.com$/i, '知乎'],
  [/^(?:www\.)?juejin\.cn$/i, '稀土掘金'],
  [/^(?:www\.)?v2ex\.com$/i, 'V2EX'],
  [/^(?:www\.|m\.)?bilibili\.com$/i, 'Bilibili'],
  [/^(?:mp\.)?weixin\.qq\.com$/i, '微信 / 公众号'],
  [/^(?:www\.)?xiaohongshu\.com$/i, '小红书'],
  [/^(?:blog\.|www\.)?csdn\.net$/i, 'CSDN'],
];

const COUNTRY_OVERRIDES = new Map([
  ['CN', '中国大陆'],
  ['HK', '中国香港'],
  ['MO', '中国澳门'],
  ['TW', '中国台湾'],
  ['US', '美国'],
  ['JP', '日本'],
  ['SG', '新加坡'],
  ['KR', '韩国'],
  ['GB', '英国'],
  ['DE', '德国'],
  ['FR', '法国'],
  ['CA', '加拿大'],
  ['AU', '澳大利亚'],
  ['NL', '荷兰'],
]);

let regionNamesFormatter = null;
function getRegionFormatter() {
  if (regionNamesFormatter !== null) return regionNamesFormatter;
  try {
    regionNamesFormatter = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  } catch {
    regionNamesFormatter = undefined;
  }
  return regionNamesFormatter;
}

export function beijingDay(timestampMs = Date.now()) {
  return new Date(timestampMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function beijingHour(timestampMs = Date.now()) {
  return new Date(timestampMs + BEIJING_OFFSET_MS).toISOString().slice(11, 13);
}

export function shiftDay(day, deltaDays) {
  const base = Date.parse(`${day}T00:00:00Z`);
  return new Date(base + deltaDays * 86400 * 1000).toISOString().slice(0, 10);
}

export function normalizeVisitorId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return VALID_VISITOR_ID.test(trimmed) ? trimmed : '';
}

export function classifyReferrer(rawReferrer, siteOrigin = '') {
  const raw = String(rawReferrer || '').trim();
  if (!raw) return '直接访问';
  if (raw === 'internal') return '站内跳转';
  let host = raw;
  try {
    if (raw.includes('://')) {
      const parsed = new URL(raw);
      if (siteOrigin && parsed.origin === siteOrigin) return '站内跳转';
      host = parsed.hostname;
    }
  } catch {
    return '直接访问';
  }
  host = host.replace(/^www\./i, '').toLowerCase();
  if (!host || !/^[a-z0-9.-]{1,120}$/.test(host)) return '直接访问';
  if (siteOrigin) {
    try {
      if (host === new URL(siteOrigin).hostname.replace(/^www\./i, '').toLowerCase()) return '站内跳转';
    } catch {}
  }
  for (const [pattern, label] of REFERRER_RULES) {
    if (pattern.test(host)) return label;
  }
  return host.slice(0, 64);
}

export function parseUserAgent(userAgent) {
  const ua = String(userAgent || '');
  const device = /iPad|Tablet|PlayBook|Silk|(?:Android(?!.*Mobile))/i.test(ua)
    ? '平板'
    : /Mobile|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)
      ? '移动端'
      : '桌面端';
  const os = /iPhone|iPad|iPod|CPU OS/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux|Ubuntu|Fedora|Debian/i.test(ua)
            ? 'Linux'
            : '其他系统';
  const browser = /MicroMessenger/i.test(ua)
    ? '微信内置'
    : /Edg\//i.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/i.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS\//i.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//i.test(ua)
            ? 'Chrome'
            : /Safari\//i.test(ua)
              ? 'Safari'
              : '其他浏览器';
  return { device, os, browser };
}

export function parseCountry(request) {
  const headerCode = request.headers.get('cf-ipcountry') || request.cf?.country || '';
  const code = String(headerCode).trim().toUpperCase();
  if (!code || code === 'XX' || code === 'T1') {
    return extractClientIp(request) === 'local' ? '本地访问' : '未知地区';
  }
  if (COUNTRY_OVERRIDES.has(code)) return COUNTRY_OVERRIDES.get(code);
  if (/^[A-Z]{2}$/.test(code)) {
    const formatter = getRegionFormatter();
    if (formatter) {
      try {
        const name = formatter.of(code);
        if (name && name !== code) return name;
      } catch {}
    }
    return `地区 (${code})`;
  }
  return '未知地区';
}

export function isBotUserAgent(userAgent) {
  const ua = String(userAgent || '').trim();
  return !ua || ua.length > 1024 || BOT_UA_PATTERN.test(ua);
}

export function extractClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'local';
}

export function normalizeAnalyticsTarget(targetType, rawKey) {
  if (targetType === 'post') {
    try {
      return { targetType: 'post', targetKey: validateSlug(String(rawKey || '').trim()) };
    } catch {
      throw new ContentError('文章标识无效。', 400, 'invalid_target');
    }
  }
  if (targetType === 'page') {
    const cleaned = String(rawKey || '').trim().replace(/\/+$/, '') || '/';
    if (!ALLOWED_PAGES.has(cleaned)) throw new ContentError('页面路径无效。', 400, 'invalid_target');
    return { targetType: 'page', targetKey: cleaned };
  }
  throw new ContentError('统计目标类型无效。', 400, 'invalid_target');
}

export function createAnalyticsMethods({ database }) {
  let cachedSalt;
  let lastPruneDay;
  let dimensionsSupported;

  async function hasDimensionTables() {
    if (dimensionsSupported !== undefined) return dimensionsSupported;
    try {
      const rows = await database.all(
        "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name IN ('analytics_dimensions', 'analytics_dimension_visitors', 'analytics_known_visitors')",
      );
      dimensionsSupported = Number(rows[0]?.total || 0) === 3;
    } catch {
      dimensionsSupported = false;
    }
    return dimensionsSupported;
  }

  async function getSalt() {
    if (cachedSalt) return cachedSalt;
    const rows = await database.all("SELECT value FROM analytics_meta WHERE key = 'visitor_salt'");
    if (rows[0]?.value) {
      cachedSalt = rows[0].value;
      return cachedSalt;
    }
    const generated = [...crypto.getRandomValues(new Uint8Array(24))]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    await database.batch([
      { sql: "INSERT OR IGNORE INTO analytics_meta (key, value) VALUES ('visitor_salt', ?)", params: [generated] },
    ]);
    const confirmed = await database.all("SELECT value FROM analytics_meta WHERE key = 'visitor_salt'");
    cachedSalt = confirmed[0]?.value || generated;
    return cachedSalt;
  }

  async function pruneVisitorsIfNeeded(today) {
    if (lastPruneDay === today) return;
    const meta = await database.all("SELECT value FROM analytics_meta WHERE key = 'last_prune_day'");
    if (meta[0]?.value === today) {
      lastPruneDay = today;
      return;
    }
    const cutoff = shiftDay(today, -VISITOR_RETENTION_DAYS);
    const knownCutoff = shiftDay(today, -KNOWN_VISITOR_RETENTION_DAYS);
    const statements = [
      { sql: 'DELETE FROM analytics_visitors WHERE day < ?', params: [cutoff] },
      { sql: "INSERT INTO analytics_meta (key, value) VALUES ('last_prune_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: [today] },
    ];
    if (await hasDimensionTables()) {
      statements.push(
        { sql: 'DELETE FROM analytics_dimension_visitors WHERE day < ?', params: [cutoff] },
        { sql: 'DELETE FROM analytics_known_visitors WHERE last_day < ?', params: [knownCutoff] },
      );
    }
    await database.batch(statements);
    lastPruneDay = today;
  }

  async function isPublishedPost(slug) {
    const rows = await database.all(
      "SELECT 1 AS ok FROM content_documents WHERE kind = 'post' AND id = ? AND json_extract(payload_json, '$.published') IS NOT NULL AND json_extract(payload_json, '$.publishedDeletedAt') IS NULL",
      [slug],
    );
    return rows.length > 0;
  }

  async function resolveVisitorIdentity(request, day, { visitorId } = {}) {
    const salt = await getSalt();
    const vid = normalizeVisitorId(visitorId);
    const identityToken = vid ? `vid:${vid}` : `${extractClientIp(request)}|${String(request.headers.get('user-agent') || '').slice(0, 512)}`;
    const [dailyDigest, clientDigest] = await Promise.all([
      sha256(`${salt}|${day}|${identityToken}`),
      sha256(`${salt}|client:${identityToken}`),
    ]);
    return {
      visitorHash: dailyDigest.slice(0, 32),
      clientHash: clientDigest.slice(0, 32),
      identityMode: vid ? 'visitor_id' : 'ip_ua',
    };
  }

  return {
    resolveVisitorIdentity,

    async resolveVisitorHash(request, day, options = {}) {
      const { visitorHash } = await resolveVisitorIdentity(request, day, options);
      return visitorHash;
    },

    async recordAnalyticsView({ targetType, targetKey, visitorHash, clientHash = '', dimensions = null, now = Date.now() }) {
      const target = normalizeAnalyticsTarget(targetType, targetKey);
      if (!visitorHash || typeof visitorHash !== 'string') throw new ContentError('访客标识无效。', 400, 'invalid_visitor');
      if (target.targetType === 'post' && !(await isPublishedPost(target.targetKey))) {
        return { accepted: false, reason: 'not_published' };
      }
      const day = beijingDay(now);
      const existing = await database.all(
        'SELECT views, last_view_at FROM analytics_visitors WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?',
        [day, target.targetType, target.targetKey, visitorHash],
      );
      if (existing.length) {
        const record = existing[0];
        if (now - Number(record.last_view_at) < VIEW_COOLDOWN_MS || Number(record.views) >= MAX_DAILY_VIEWS_PER_TARGET) {
          return { accepted: false, reason: 'throttled' };
        }
      }

      const targetParams = [day, target.targetType, target.targetKey, visitorHash];
      const statements = [
        {
          sql: `INSERT INTO analytics_daily (day, target_type, target_key, views, unique_visitors)
                VALUES (?, ?, ?, 1, CASE WHEN EXISTS (SELECT 1 FROM analytics_visitors WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?) THEN 0 ELSE 1 END)
                ON CONFLICT(day, target_type, target_key) DO UPDATE SET
                  views = views + 1,
                  unique_visitors = unique_visitors + CASE WHEN EXISTS (SELECT 1 FROM analytics_visitors WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?) THEN 0 ELSE 1 END`,
          params: [day, target.targetType, target.targetKey, ...targetParams, ...targetParams],
        },
        {
          sql: `INSERT INTO analytics_visitors (day, target_type, target_key, visitor_hash, views, last_view_at)
                VALUES (?, ?, ?, ?, 1, ?)
                ON CONFLICT(day, target_type, target_key, visitor_hash) DO UPDATE SET
                  views = views + 1,
                  last_view_at = excluded.last_view_at`,
          params: [...targetParams, now],
        },
        {
          sql: `INSERT INTO analytics_daily (day, target_type, target_key, views, unique_visitors)
                VALUES (?, 'site', '*', 1, CASE WHEN EXISTS (SELECT 1 FROM analytics_visitors WHERE day = ? AND target_type = 'site' AND target_key = '*' AND visitor_hash = ?) THEN 0 ELSE 1 END)
                ON CONFLICT(day, target_type, target_key) DO UPDATE SET
                  views = views + 1,
                  unique_visitors = unique_visitors + CASE WHEN EXISTS (SELECT 1 FROM analytics_visitors WHERE day = ? AND target_type = 'site' AND target_key = '*' AND visitor_hash = ?) THEN 0 ELSE 1 END`,
          params: [day, day, visitorHash, day, visitorHash],
        },
        {
          sql: `INSERT INTO analytics_visitors (day, target_type, target_key, visitor_hash, views, last_view_at)
                VALUES (?, 'site', '*', ?, 1, ?)
                ON CONFLICT(day, target_type, target_key, visitor_hash) DO UPDATE SET
                  views = views + 1,
                  last_view_at = excluded.last_view_at`,
          params: [day, visitorHash, now],
        },
      ];

      if (await hasDimensionTables()) {
        const entries = [];
        if (dimensions && typeof dimensions === 'object') {
          for (const [dimension, rawLabel] of Object.entries(dimensions)) {
            if (!['referrer', 'device', 'os', 'browser', 'country', 'hour'].includes(dimension)) continue;
            const label = String(rawLabel || '').trim().slice(0, 80);
            if (label) entries.push([dimension, label]);
          }
        }
        if (clientHash) {
          const [knownRow, siteTodayRow] = await Promise.all([
            database.all('SELECT first_day, last_day FROM analytics_known_visitors WHERE client_hash = ?', [clientHash]),
            database.all("SELECT 1 AS seen FROM analytics_visitors WHERE day = ? AND target_type = 'site' AND target_key = '*' AND visitor_hash = ?", [day, visitorHash]),
          ]);
          const seenBefore = knownRow.length > 0 && knownRow[0].first_day < day;
          entries.push(['visitor_type', seenBefore ? 'returning' : 'new']);
          if (!knownRow.length) {
            statements.push({
              sql: 'INSERT OR IGNORE INTO analytics_known_visitors (client_hash, first_day, last_day) VALUES (?, ?, ?)',
              params: [clientHash, day, day],
            });
          } else if (knownRow[0].last_day !== day && !siteTodayRow.length) {
            statements.push({
              sql: 'UPDATE analytics_known_visitors SET last_day = ? WHERE client_hash = ?',
              params: [day, clientHash],
            });
          }
        }
        for (const [dimension, label] of entries) {
          const dimParams = [day, dimension, label, visitorHash];
          statements.push(
            {
              sql: `INSERT INTO analytics_dimensions (day, dimension, label, views, visitors)
                    VALUES (?, ?, ?, 1, CASE WHEN EXISTS (SELECT 1 FROM analytics_dimension_visitors WHERE day = ? AND dimension = ? AND label = ? AND visitor_hash = ?) THEN 0 ELSE 1 END)
                    ON CONFLICT(day, dimension, label) DO UPDATE SET
                      views = views + 1,
                      visitors = visitors + CASE WHEN EXISTS (SELECT 1 FROM analytics_dimension_visitors WHERE day = ? AND dimension = ? AND label = ? AND visitor_hash = ?) THEN 0 ELSE 1 END`,
              params: [day, dimension, label, ...dimParams, ...dimParams],
            },
            {
              sql: 'INSERT OR IGNORE INTO analytics_dimension_visitors (day, dimension, label, visitor_hash) VALUES (?, ?, ?, ?)',
              params: dimParams,
            },
          );
        }
      }

      await database.batch(statements);

      await pruneVisitorsIfNeeded(day).catch(() => {});
      return { accepted: true, day, ...target };
    },

    async recordAnalyticsEngagement({ targetType, targetKey, visitorHash, durationDelta = 0, completed = false, now = Date.now() }) {
      const target = normalizeAnalyticsTarget(targetType, targetKey);
      if (target.targetType !== 'post') return { accepted: false, reason: 'not_post' };
      if (!visitorHash || typeof visitorHash !== 'string') throw new ContentError('访客标识无效。', 400, 'invalid_visitor');
      if (!(await isPublishedPost(target.targetKey))) {
        return { accepted: false, reason: 'not_published' };
      }

      const delta = Math.max(0, Math.min(MAX_ENGAGE_DELTA_SECONDS, Math.trunc(Number(durationDelta) || 0)));
      const done = completed === true ? 1 : 0;
      if (delta === 0 && done === 0) return { accepted: false, reason: 'empty' };

      const today = beijingDay(now);
      const yesterday = shiftDay(today, -1);
      const rows = await database.all(
        `SELECT day, duration_seconds, duration_recorded, completed
         FROM analytics_visitors
         WHERE target_type = 'post' AND target_key = ? AND visitor_hash = ? AND day IN (?, ?)
         ORDER BY day DESC LIMIT 1`,
        [target.targetKey, visitorHash, today, yesterday],
      );
      if (!rows.length) return { accepted: false, reason: 'no_session' };

      const record = rows[0];
      const remaining = Math.max(0, MAX_DAILY_DURATION_PER_POST - Number(record.duration_seconds));
      const appliedDuration = Math.min(delta, remaining);
      const markCompleted = done === 1 && Number(record.completed) === 0 ? 1 : 0;
      if (appliedDuration <= 0 && markCompleted === 0) {
        return { accepted: false, reason: 'unchanged' };
      }

      const targetDay = record.day;
      const keyParams = [targetDay, 'post', target.targetKey, visitorHash];
      await database.batch([
        {
          sql: `UPDATE analytics_daily SET
                  duration_seconds = duration_seconds + MIN(?, MAX(0, ? - COALESCE((SELECT duration_seconds FROM analytics_visitors WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?), 0))),
                  duration_samples = duration_samples + CASE WHEN ? > 0 AND COALESCE((SELECT duration_recorded FROM analytics_visitors WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?), 1) = 0 THEN 1 ELSE 0 END,
                  completed_reads = completed_reads + CASE WHEN ? = 1 AND COALESCE((SELECT completed FROM analytics_visitors WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?), 1) = 0 THEN 1 ELSE 0 END
                WHERE day = ? AND target_type = 'post' AND target_key = ?`,
          params: [
            appliedDuration, MAX_DAILY_DURATION_PER_POST, ...keyParams,
            appliedDuration, ...keyParams,
            markCompleted, ...keyParams,
            targetDay, target.targetKey,
          ],
        },
        {
          sql: `UPDATE analytics_visitors SET
                  duration_seconds = MIN(?, duration_seconds + ?),
                  duration_recorded = CASE WHEN ? > 0 THEN 1 ELSE duration_recorded END,
                  completed = CASE WHEN ? = 1 THEN 1 ELSE completed END
                WHERE day = ? AND target_type = ? AND target_key = ? AND visitor_hash = ?`,
          params: [
            MAX_DAILY_DURATION_PER_POST, appliedDuration,
            appliedDuration,
            markCompleted,
            ...keyParams,
          ],
        },
      ]);

      return { accepted: true, day: targetDay, appliedDuration, markedCompleted: markCompleted === 1 };
    },

    async getAnalyticsReport({ days = 30, now = Date.now() } = {}) {
      const rangeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
      const todayDay = beijingDay(now);
      const startDay = shiftDay(todayDay, -(rangeDays - 1));

      await pruneVisitorsIfNeeded(todayDay).catch(() => {});

      const [
        siteDailyRows,
        postDailyEngagementRows,
        siteTotalsRows,
        postTotalsRows,
        postAggregateRows,
        pageAggregateRows,
        documentRows,
        dimensionRows,
      ] = await Promise.all([
        database.all(
          `SELECT day, views, unique_visitors
           FROM analytics_daily
           WHERE target_type = 'site' AND target_key = '*' AND day >= ? AND day <= ?
           ORDER BY day ASC`,
          [startDay, todayDay],
        ),
        database.all(
          `SELECT day, SUM(duration_seconds) AS duration_seconds, SUM(duration_samples) AS duration_samples, SUM(completed_reads) AS completed_reads
           FROM analytics_daily
           WHERE target_type = 'post' AND day >= ? AND day <= ?
           GROUP BY day`,
          [startDay, todayDay],
        ),
        database.all(
          `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(unique_visitors), 0) AS visitors
           FROM analytics_daily
           WHERE target_type = 'site' AND target_key = '*'`,
        ),
        database.all(
          `SELECT COALESCE(SUM(views), 0) AS views,
                  COALESCE(SUM(unique_visitors), 0) AS visitors,
                  COALESCE(SUM(duration_seconds), 0) AS duration_seconds,
                  COALESCE(SUM(duration_samples), 0) AS duration_samples,
                  COALESCE(SUM(completed_reads), 0) AS completed_reads
           FROM analytics_daily
           WHERE target_type = 'post'`,
        ),
        database.all(
          `SELECT target_key,
                  SUM(views) AS total_views,
                  SUM(unique_visitors) AS total_visitors,
                  SUM(duration_seconds) AS total_duration,
                  SUM(duration_samples) AS total_samples,
                  SUM(completed_reads) AS total_completed,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN views ELSE 0 END) AS range_views,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN unique_visitors ELSE 0 END) AS range_visitors,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN duration_seconds ELSE 0 END) AS range_duration,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN duration_samples ELSE 0 END) AS range_samples,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN completed_reads ELSE 0 END) AS range_completed
           FROM analytics_daily
           WHERE target_type = 'post'
           GROUP BY target_key`,
          [startDay, todayDay, startDay, todayDay, startDay, todayDay, startDay, todayDay, startDay, todayDay],
        ),
        database.all(
          `SELECT target_key,
                  SUM(views) AS total_views,
                  SUM(unique_visitors) AS total_visitors,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN views ELSE 0 END) AS range_views,
                  SUM(CASE WHEN day >= ? AND day <= ? THEN unique_visitors ELSE 0 END) AS range_visitors
           FROM analytics_daily
           WHERE target_type = 'page'
           GROUP BY target_key`,
          [startDay, todayDay, startDay, todayDay],
        ),
        database.all(
          "SELECT id, json_remove(payload_json, '$.published.body', '$.draft.body') AS payload_json FROM content_documents WHERE kind = 'post' ORDER BY id",
        ),
        (await hasDimensionTables())
          ? database.all(
              `SELECT dimension, label, SUM(views) AS views, SUM(visitors) AS visitors
               FROM analytics_dimensions
               WHERE day >= ? AND day <= ?
               GROUP BY dimension, label`,
              [startDay, todayDay],
            )
          : Promise.resolve([]),
      ]);

      const siteByDay = new Map(siteDailyRows.map(row => [row.day, row]));
      const postEngageByDay = new Map(postDailyEngagementRows.map(row => [row.day, row]));
      const daily = [];
      let rangeViews = 0;
      let rangeVisitors = 0;
      for (let offset = 0; offset < rangeDays; offset++) {
        const day = shiftDay(startDay, offset);
        const siteRow = siteByDay.get(day);
        const engageRow = postEngageByDay.get(day);
        const views = Number(siteRow?.views || 0);
        const visitors = Number(siteRow?.unique_visitors || 0);
        const durationSeconds = Number(engageRow?.duration_seconds || 0);
        const durationSamples = Number(engageRow?.duration_samples || 0);
        const completedReads = Number(engageRow?.completed_reads || 0);
        rangeViews += views;
        rangeVisitors += visitors;
        daily.push({
          day,
          views,
          visitors,
          completedReads,
          avgReadSeconds: durationSamples > 0 ? Math.round(durationSeconds / durationSamples) : 0,
        });
      }

      const todayRow = daily.at(-1) || { views: 0, visitors: 0 };
      const siteTotal = siteTotalsRows[0] || {};
      const postTotal = postTotalsRows[0] || {};
      const postTotalVisitors = Number(postTotal.visitors || 0);
      const postTotalDuration = Number(postTotal.duration_seconds || 0);
      const postTotalSamples = Number(postTotal.duration_samples || 0);
      const postTotalCompleted = Number(postTotal.completed_reads || 0);

      const postDocs = new Map();
      for (const row of documentRows) {
        const value = JSON.parse(row.payload_json);
        const pub = value.published;
        const draft = value.draft;
        if (!pub && !draft) continue;
        const active = pub && !value.publishedDeletedAt;
        const meta = pub || draft;
        if (!pub && !value.publishedDeletedAt) continue; // 纯草稿不计入阅读统计明细
        postDocs.set(row.id, {
          title: meta?.data?.title || row.id,
          category: meta?.data?.category || '未分类',
          pubDate: meta?.data?.pubDate || '',
          origin: getPostOrigin(meta),
          status: active ? 'published' : 'archived',
        });
      }

      const postAgg = new Map(postAggregateRows.map(row => [row.target_key, row]));
      const allPostSlugs = new Set([...postDocs.keys(), ...postAgg.keys()]);
      const posts = [...allPostSlugs].map(slug => {
        const doc = postDocs.get(slug);
        const stats = postAgg.get(slug) || {};
        const totalViews = Number(stats.total_views || 0);
        const totalVisitors = Number(stats.total_visitors || 0);
        const totalDuration = Number(stats.total_duration || 0);
        const totalSamples = Number(stats.total_samples || 0);
        const completedReads = Number(stats.total_completed || 0);
        const rangePostViews = Number(stats.range_views || 0);
        const rangePostVisitors = Number(stats.range_visitors || 0);
        const rangePostDuration = Number(stats.range_duration || 0);
        const rangePostSamples = Number(stats.range_samples || 0);
        const rangeCompletedReads = Number(stats.range_completed || 0);
        return {
          slug,
          title: doc?.title || slug,
          category: doc?.category || '已移除文章',
          pubDate: doc?.pubDate || '',
          origin: doc?.origin || '',
          status: doc?.status || 'removed',
          totalViews,
          totalVisitors,
          rangeViews: rangePostViews,
          rangeVisitors: rangePostVisitors,
          avgReadSeconds: totalSamples > 0 ? Math.round(totalDuration / totalSamples) : 0,
          rangeAvgReadSeconds: rangePostSamples > 0 ? Math.round(rangePostDuration / rangePostSamples) : 0,
          completedReads,
          rangeCompletedReads,
          completionRate: totalVisitors > 0 ? Math.min(1, completedReads / totalVisitors) : 0,
          rangeCompletionRate: rangePostVisitors > 0 ? Math.min(1, rangeCompletedReads / rangePostVisitors) : 0,
        };
      }).sort((a, b) => (b.totalViews - a.totalViews) || (b.rangeViews - a.rangeViews) || String(b.pubDate).localeCompare(String(a.pubDate)));

      const pageAgg = new Map(pageAggregateRows.map(row => [row.target_key, row]));
      const pages = [...ALLOWED_PAGES.entries()].map(([path, label]) => {
        const stats = pageAgg.get(path) || {};
        return {
          path,
          label,
          totalViews: Number(stats.total_views || 0),
          totalVisitors: Number(stats.total_visitors || 0),
          rangeViews: Number(stats.range_views || 0),
          rangeVisitors: Number(stats.range_visitors || 0),
        };
      });

      const dimGrouped = new Map();
      for (const row of dimensionRows || []) {
        const key = String(row.dimension || '');
        if (!dimGrouped.has(key)) dimGrouped.set(key, []);
        dimGrouped.get(key).push({
          label: String(row.label || ''),
          views: Number(row.views || 0),
          visitors: Number(row.visitors || 0),
        });
      }
      const rankDimension = (key, limit = 10) => {
        const list = [...(dimGrouped.get(key) || [])].sort(
          (a, b) => (b.visitors - a.visitors) || (b.views - a.views) || a.label.localeCompare(b.label, 'zh-CN'),
        );
        const total = list.reduce((sum, item) => sum + item.visitors, 0) || list.reduce((sum, item) => sum + item.views, 0);
        return list.slice(0, limit).map(item => ({
          ...item,
          ratio: total > 0 ? (item.visitors || item.views) / total : 0,
        }));
      };
      const hourMap = new Map((dimGrouped.get('hour') || []).map(item => [item.label, item]));
      const hourly = Array.from({ length: 24 }, (_, idx) => {
        const hour = String(idx).padStart(2, '0');
        const hit = hourMap.get(hour);
        return { hour, views: hit?.views || 0, visitors: hit?.visitors || 0 };
      });
      const visitorTypeMap = new Map((dimGrouped.get('visitor_type') || []).map(item => [item.label, item.visitors || item.views]));
      const newVisitors = visitorTypeMap.get('new') || 0;
      const returningVisitors = visitorTypeMap.get('returning') || 0;
      const knownTotal = newVisitors + returningVisitors;

      const originStats = {
        human: { key: 'human', label: '手写文章', postsCount: 0, totalViews: 0, totalVisitors: 0, totalDuration: 0, totalSamples: 0, completedReads: 0 },
        ai: { key: 'ai', label: '整理文章', postsCount: 0, totalViews: 0, totalVisitors: 0, totalDuration: 0, totalSamples: 0, completedReads: 0 },
      };
      for (const slug of allPostSlugs) {
        const doc = postDocs.get(slug);
        if (!doc || doc.status !== 'published') continue;
        const bucket = originStats[doc.origin === 'human' ? 'human' : 'ai'];
        const stats = postAgg.get(slug) || {};
        bucket.postsCount += 1;
        bucket.totalViews += Number(stats.total_views || 0);
        bucket.totalVisitors += Number(stats.total_visitors || 0);
        bucket.totalDuration += Number(stats.total_duration || 0);
        bucket.totalSamples += Number(stats.total_samples || 0);
        bucket.completedReads += Number(stats.total_completed || 0);
      }
      const originBreakdown = Object.values(originStats).map(item => ({
        key: item.key,
        label: item.label,
        postsCount: item.postsCount,
        totalViews: item.totalViews,
        totalVisitors: item.totalVisitors,
        avgReadSeconds: item.totalSamples > 0 ? Math.round(item.totalDuration / item.totalSamples) : 0,
        completionRate: item.totalVisitors > 0 ? Math.min(1, item.completedReads / item.totalVisitors) : 0,
      }));

      return {
        rangeDays,
        todayDay,
        startDay,
        summary: {
          todayViews: todayRow.views,
          todayVisitors: todayRow.visitors,
          rangeViews,
          rangeVisitors,
          totalViews: Number(siteTotal.views || 0),
          totalVisitors: Number(siteTotal.visitors || 0),
          postViews: Number(postTotal.views || 0),
          postVisitors: postTotalVisitors,
          totalCompletedReads: postTotalCompleted,
          avgReadSeconds: postTotalSamples > 0 ? Math.round(postTotalDuration / postTotalSamples) : 0,
          completionRate: postTotalVisitors > 0 ? Math.min(1, postTotalCompleted / postTotalVisitors) : 0,
          newVisitors,
          returningVisitors,
          returnRate: knownTotal > 0 ? returningVisitors / knownTotal : 0,
        },
        daily,
        posts,
        pages,
        originBreakdown,
        dimensions: {
          referrers: rankDimension('referrer', 10),
          countries: rankDimension('country', 10),
          devices: rankDimension('device', 5),
          os: rankDimension('os', 8),
          browsers: rankDimension('browser', 8),
          hourly,
        },
      };
    },
  };
}
