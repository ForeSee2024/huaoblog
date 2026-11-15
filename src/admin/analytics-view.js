import { escape as e, icon, button, empty, notice } from './ui.js';
import { pageHeading } from './views.js';

export function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (!value) return '—';
  if (value < 60) return `${value} 秒`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`;
}

export function formatPercent(rate) {
  const clamped = Math.max(0, Math.min(1, Number(rate) || 0));
  return `${Math.round(clamped * 100)}%`;
}

export function filterAndSortAnalyticsPosts(posts = [], { search = '', sort = 'totalViews' } = {}) {
  const query = String(search || '').trim().toLowerCase();
  const filtered = query
    ? posts.filter(item =>
        String(item.title || '').toLowerCase().includes(query)
        || String(item.slug || '').toLowerCase().includes(query)
        || String(item.category || '').toLowerCase().includes(query))
    : [...posts];

  const sorters = {
    totalViews: (a, b) => (b.totalViews - a.totalViews) || (b.totalVisitors - a.totalVisitors) || String(b.pubDate).localeCompare(String(a.pubDate)),
    rangeViews: (a, b) => (b.rangeViews - a.rangeViews) || (b.rangeVisitors - a.rangeVisitors) || (b.totalViews - a.totalViews),
    completionRate: (a, b) => (b.completionRate - a.completionRate) || (b.completedReads - a.completedReads) || (b.totalVisitors - a.totalVisitors),
    avgReadSeconds: (a, b) => (b.avgReadSeconds - a.avgReadSeconds) || (b.totalViews - a.totalViews),
  };
  return filtered.sort(sorters[sort] || sorters.totalViews);
}

export function analyticsDaySummary(item) {
  if (!item) return '';
  return `<strong>${e(item.day)}</strong><span>浏览 ${item.views} 次 · 访客 ${item.visitors} 人 · 完读 ${item.completedReads} 人 · 均时 ${e(formatDuration(item.avgReadSeconds))}</span>`;
}

function dailyChart(daily = [], rangeDays = 30, selectedDay = '') {
  if (!daily.length) return '';
  const peak = Math.max(1, ...daily.map(item => Number(item.views || 0)));
  const active = daily.find(item => item.day === selectedDay) || daily.at(-1);
  const firstDay = daily[0]?.day || '';
  const midDay = daily[Math.floor(daily.length / 2)]?.day || '';
  const lastDay = daily.at(-1)?.day || '';
  const dense = daily.length > 45;

  const bars = daily.map(item => {
    const pvHeight = item.views > 0 ? Math.max(6, Math.round((item.views / peak) * 100)) : 2;
    const uvHeight = item.visitors > 0 ? Math.max(4, Math.round((item.visitors / peak) * 100)) : 0;
    const isCurrent = item.day === active?.day;
    const label = `${item.day}：浏览 ${item.views} 次，访客 ${item.visitors} 人，读完 ${item.completedReads} 人，平均停留 ${formatDuration(item.avgReadSeconds)}`;
    return `<button type="button" class="analytics-bar-col ${isCurrent ? 'active' : ''}" data-action="analytics-day" data-day="${e(item.day)}" aria-label="${e(label)}" title="${e(label)}"><span class="analytics-bar-track"><span class="analytics-bar-pv" style="height:${pvHeight}%">${uvHeight ? `<span class="analytics-bar-uv" style="height:${Math.min(100, Math.round((uvHeight / pvHeight) * 100))}%"></span>` : ''}</span></span></button>`;
  }).join('');

  return `<div class="analytics-chart-wrap">
    <div class="analytics-chart-head">
      <div class="analytics-legend">
        <span><i class="legend-dot pv" aria-hidden="true"></i>浏览量 (PV)</span>
        <span><i class="legend-dot uv" aria-hidden="true"></i>独立访客 (UV)</span>
      </div>
      <div class="analytics-day-inspector" id="analytics-day-detail">
        ${analyticsDaySummary(active)}
      </div>
    </div>
    <div class="analytics-bars ${dense ? 'dense' : ''}" role="group" aria-label="近 ${rangeDays} 天每日访问趋势">${bars}</div>
    <div class="analytics-axis"><span>${e(firstDay)}</span>${rangeDays > 7 ? `<span>${e(midDay)}</span>` : ''}<span>${e(lastDay)}</span></div>
  </div>`;
}

export function analyticsPostRows(posts = [], options = {}) {
  const ordered = filterAndSortAnalyticsPosts(posts, options);
  if (!ordered.length) {
    return empty('没有匹配的文章记录', '调整搜索关键词，或等待前台产生阅读数据。', '', '', 'chart');
  }
  return `<div class="analytics-table-head"><span>#</span><span>文章</span><span>近期 (PV / UV)</span><span>累计 (PV / UV)</span><span>平均阅读</span><span>读完率</span></div>${ordered.map((post, index) => {
    const rank = String(index + 1).padStart(2, '0');
    const titleNode = post.status === 'published'
      ? `<button type="button" class="table-title" data-action="edit-post" data-slug="${e(post.slug)}" data-status="published">${e(post.title)}</button>`
      : `<span class="analytics-static-title">${e(post.title)}</span>`;
    const stateTag = post.status === 'published'
      ? ''
      : post.status === 'archived'
        ? '<span class="badge draft">已进回收站</span>'
        : '<span class="badge pending">已清除</span>';
    const pct = Math.round((Number(post.completionRate) || 0) * 100);
    return `<div class="analytics-table-row">
      <span class="analytics-rank">${rank}</span>
      <div class="analytics-post-cell">${titleNode}<div class="analytics-post-meta"><span>${e(post.category || '未分类')}</span>${post.pubDate ? `<span>${e(String(post.pubDate).slice(0, 10))}</span>` : ''}${stateTag}</div></div>
      <div class="analytics-num-cell"><strong>${post.rangeViews}</strong><small>${post.rangeVisitors} 人</small></div>
      <div class="analytics-num-cell"><strong>${post.totalViews}</strong><small>${post.totalVisitors} 人</small></div>
      <div class="analytics-num-cell"><strong>${e(formatDuration(post.avgReadSeconds))}</strong><small>${post.completedReads} 人读完</small></div>
      <div class="analytics-rate-cell"><div class="completion-track" aria-hidden="true"><span style="width:${pct}%"></span></div><span>${pct}%</span></div>
    </div>`;
  }).join('')}`;
}

export function analyticsView(report, state = {}) {
  const days = [7, 30, 90].includes(Number(state.days)) ? Number(state.days) : 30;
  const sort = state.sort || 'totalViews';
  const search = state.search || '';
  const selectedDay = state.selectedDay || '';

  const rangeButtons = [
    [7, '近 7 天'],
    [30, '近 30 天'],
    [90, '近 90 天'],
  ].map(([value, label]) =>
    `<button type="button" role="tab" aria-selected="${days === value}" data-action="analytics-range" data-days="${value}">${label}</button>`,
  ).join('');

  const headingActions = `<div class="tabs analytics-range-tabs" role="tablist" aria-label="统计时间范围">${rangeButtons}</div>${button('刷新数据', 'refresh-analytics', 'refresh')}`;
  const heading = pageHeading('访问统计', '统计全站浏览、独立访客与文章阅读完成情况，前台不展示任何计数。', headingActions, 'HUAOVO / ANALYTICS');

  if (state.loading && !report) {
    return `${heading}<div class="loading-state" role="status"><span class="loading-spinner"></span><p>正在汇总访问与阅读数据…</p></div>`;
  }
  if (state.error && !report) {
    return `${heading}${notice(state.error, 'error')}`;
  }
  if (!report) {
    return `${heading}${empty('请先登录管理员账号', '登录后即可查看站点访问统计与文章阅读深度。', 'login', '使用 GitHub 登录', 'chart')}`;
  }

  const summary = report.summary || {};
  const dailyAvg = Math.round((summary.rangeViews || 0) / days);
  const metrics = [
    ['今日浏览 (PV)', summary.todayViews || 0, `今日访客 ${summary.todayVisitors || 0} 人`, 'eye'],
    [`近 ${days} 天浏览`, summary.rangeViews || 0, `日均 ${dailyAvg} 次 · 访客 ${summary.rangeVisitors || 0} 人·天`, 'chart'],
    ['全站累计浏览', summary.totalViews || 0, `累计访客 ${summary.totalVisitors || 0} 人·天`, 'globe'],
    ['文章阅读深度', formatDuration(summary.avgReadSeconds), `累计读完 ${summary.totalCompletedReads || 0} 次 · 完读率 ${formatPercent(summary.completionRate)}`, 'book'],
  ];

  const sortChoices = [
    ['totalViews', '按累计阅读量'],
    ['rangeViews', `按近 ${days} 天阅读`],
    ['completionRate', '按读完率'],
    ['avgReadSeconds', '按平均停留'],
  ].map(([value, label]) => `<option value="${value}" ${sort === value ? 'selected' : ''}>${label}</option>`).join('');

  const pages = (report.pages || []).map(page =>
    `<div class="analytics-page-card"><div><strong>${e(page.label)}</strong><code>${e(page.path)}</code></div><div class="analytics-page-nums"><span>近 ${days} 天：<b>${page.rangeViews}</b> 次 / ${page.rangeVisitors} 人</span><span>累计：<b>${page.totalViews}</b> 次 / ${page.totalVisitors} 人</span></div></div>`,
  ).join('');

  return `${heading}
  ${state.error ? notice(state.error, 'error') : ''}
  <div class="metric-strip">${metrics.map(([label, value, hint, glyph]) => `<div class="metric"><label>${icon(glyph)}${label}</label><strong>${e(value)}</strong><small>${e(hint)}</small></div>`).join('')}</div>
  <section class="settings-section">
    <div class="section-heading"><h2>每日访问趋势</h2><p>按北京时间自然日统计。已自动排除站长登录访问与已知爬虫，同一访客 30 分钟内反复刷新不重复计入，单篇停留时长单日上限 30 分钟。</p></div>
    ${summary.rangeViews ? dailyChart(report.daily, days, selectedDay) : `${dailyChart(report.daily, days, selectedDay)}<p class="field-hint" style="margin-top:12px">近 ${days} 天暂无访客记录；真实访客访问前台页面后，数据会自动呈现在这里。</p>`}
  </section>
  <section class="settings-section">
    <div class="section-bar" style="margin-bottom:16px"><h2>文章阅读情况明细</h2><small>共 ${(report.posts || []).length} 篇文章</small></div>
    <div class="filter-toolbar" style="margin-bottom:16px">
      <label class="search-field">${icon('search')}<input id="analytics-post-search" type="search" placeholder="筛选文章标题、路径或分类…" aria-label="筛选文章阅读统计" value="${e(search)}" /></label>
      <label class="analytics-sort-label"><span class="sr-only">排序方式</span><select id="analytics-post-sort" aria-label="文章统计排序">${sortChoices}</select></label>
    </div>
    <div id="analytics-post-table" class="analytics-table">${analyticsPostRows(report.posts, { search, sort })}</div>
  </section>
  <section class="settings-section">
    <div class="section-heading"><h2>主要页面浏览分布</h2><p>包含首页、文章列表、归档、关于我与友链页（404 等错误页不计入）。</p></div>
    <div class="analytics-pages-grid">${pages}</div>
  </section>`;
}
