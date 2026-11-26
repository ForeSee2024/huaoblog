import { escape as e, icon, button, empty, notice, originBadge } from './ui.js';
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

export function filterAndSortAnalyticsPosts(posts = [], { search = '', origin = '', sort = 'totalViews' } = {}) {
  const query = String(search || '').trim().toLowerCase();
  const filtered = posts.filter(item => {
    if (origin && item.origin !== origin) return false;
    if (!query) return true;
    return (
      String(item.title || '').toLowerCase().includes(query)
      || String(item.slug || '').toLowerCase().includes(query)
      || String(item.category || '').toLowerCase().includes(query)
    );
  });

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
    const originTag = post.origin ? originBadge(post) : '';
    const pct = Math.round((Number(post.completionRate) || 0) * 100);
    return `<div class="analytics-table-row">
      <span class="analytics-rank">${rank}</span>
      <div class="analytics-post-cell">${titleNode}<div class="analytics-post-meta"><span>${e(post.category || '未分类')}</span>${post.pubDate ? `<span>${e(String(post.pubDate).slice(0, 10))}</span>` : ''}${originTag}${stateTag}</div></div>
      <div class="analytics-num-cell"><strong>${post.rangeViews}</strong><small>${post.rangeVisitors} 人</small></div>
      <div class="analytics-num-cell"><strong>${post.totalViews}</strong><small>${post.totalVisitors} 人</small></div>
      <div class="analytics-num-cell"><strong>${e(formatDuration(post.avgReadSeconds))}</strong><small>${post.completedReads} 人读完</small></div>
      <div class="analytics-rate-cell"><div class="completion-track" aria-hidden="true"><span style="width:${pct}%"></span></div><span>${pct}%</span></div>
    </div>`;
  }).join('')}`;
}

function hourlyChart(hourly = []) {
  if (!hourly.length) return '';
  const peak = Math.max(1, ...hourly.map(item => Number(item.views || 0)));
  const totalViews = hourly.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const best = hourly.reduce((top, cur) => (Number(cur.views || 0) > Number(top.views || 0) ? cur : top), hourly[0]);
  const cols = hourly.map(item => {
    const height = item.views > 0 ? Math.max(8, Math.round((item.views / peak) * 100)) : 3;
    const isPeak = totalViews > 0 && item.hour === best.hour;
    const title = `${item.hour}:00 - ${item.hour}:59：浏览 ${item.views} 次 · 访客 ${item.visitors} 人`;
    return `<div class="analytics-hour-col ${isPeak ? 'is-peak' : ''}" title="${e(title)}"><span class="analytics-hour-track"><span class="analytics-hour-bar" style="height:${height}%"></span></span><small>${Number(item.hour) % 4 === 0 ? e(item.hour) : ''}</small></div>`;
  }).join('');
  return `<div class="analytics-hourly-card">
    <div class="analytics-subhead"><strong>24 小时活跃时段分布（北京时间）</strong><small>${totalViews > 0 ? `峰值时段 ${e(best.hour)}:00（${best.views} 次浏览）` : '等待积累时段数据'}</small></div>
    <div class="analytics-hourly-bars" role="img" aria-label="24 小时访问分布">${cols}</div>
  </div>`;
}

function dimensionCard(title, subtitle, items = [], emptyText = '暂无记录，积累访问后自动呈现。') {
  const body = items.length
    ? `<ul class="analytics-dim-list">${items.slice(0, 6).map(item => {
        const pct = Math.max(2, Math.round((Number(item.ratio) || 0) * 100));
        const primaryCount = item.visitors > 0 ? `${item.visitors} 访客` : `${item.views} 次`;
        return `<li class="analytics-dim-row">
          <div class="analytics-dim-top"><span class="analytics-dim-label">${e(item.label)}</span><span class="analytics-dim-val"><b>${e(primaryCount)}</b> · ${item.views} 次 (${Math.round((Number(item.ratio) || 0) * 100)}%)</span></div>
          <div class="analytics-dim-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
        </li>`;
      }).join('')}</ul>`
    : `<p class="field-hint">${e(emptyText)}</p>`;
  return `<div class="analytics-dim-card"><div class="analytics-subhead"><strong>${e(title)}</strong><small>${e(subtitle)}</small></div>${body}</div>`;
}

function originComparisonSection(originBreakdown = []) {
  if (!originBreakdown.length) return '';
  return `<section class="settings-section">
    <div class="section-heading"><h2>不同创作形式阅读表现</h2><p>对比「手写」与「整理」两类文章的累计阅读热度与完读表现。</p></div>
    <div class="analytics-origin-grid">${originBreakdown.map(item => {
      const pct = Math.round((Number(item.completionRate) || 0) * 100);
      return `<div class="analytics-origin-card">
        <div class="analytics-origin-head">${originBadge({ origin: item.key })}<strong>${e(item.label)}</strong><small>${item.postsCount} 篇已发表</small></div>
        <div class="analytics-origin-metrics">
          <div><span>累计浏览</span><b>${item.totalViews}</b></div>
          <div><span>独立访客</span><b>${item.totalVisitors}</b></div>
          <div><span>平均停留</span><b>${e(formatDuration(item.avgReadSeconds))}</b></div>
          <div><span>平均完读率</span><b>${pct}%</b></div>
        </div>
      </div>`;
    }).join('')}</div>
  </section>`;
}

export function analyticsView(report, state = {}) {
  const days = [7, 30, 90].includes(Number(state.days)) ? Number(state.days) : 30;
  const sort = state.sort || 'totalViews';
  const search = state.search || '';
  const origin = state.origin || '';
  const selectedDay = state.selectedDay || '';

  const rangeButtons = [
    [7, '近 7 天'],
    [30, '近 30 天'],
    [90, '近 90 天'],
  ].map(([value, label]) =>
    `<button type="button" role="tab" aria-selected="${days === value}" data-action="analytics-range" data-days="${value}">${label}</button>`,
  ).join('');

  const headingActions = `<div class="tabs analytics-range-tabs" role="tablist" aria-label="统计时间范围">${rangeButtons}</div>${button('刷新数据', 'refresh-analytics', 'refresh')}`;
  const heading = pageHeading('访问统计', '统计全站浏览、多维度受众分布与文章阅读完成情况，前台不展示任何计数。', headingActions, 'HUAOVO / ANALYTICS');

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
  const hasKnownSplit = (summary.newVisitors || 0) + (summary.returningVisitors || 0) > 0;
  const retentionHint = hasKnownSplit
    ? `近 ${days} 天新访客 ${summary.newVisitors} · 回访 ${summary.returningVisitors} (${formatPercent(summary.returnRate)})`
    : `累计访客 ${summary.totalVisitors || 0} 人·天`;
  const metrics = [
    ['今日浏览 (PV)', summary.todayViews || 0, `今日访客 ${summary.todayVisitors || 0} 人`, 'eye'],
    [`近 ${days} 天浏览`, summary.rangeViews || 0, `日均 ${dailyAvg} 次 · 访客 ${summary.rangeVisitors || 0} 人·天`, 'chart'],
    ['全站累计浏览', summary.totalViews || 0, retentionHint, 'globe'],
    ['文章阅读深度', formatDuration(summary.avgReadSeconds), `累计读完 ${summary.totalCompletedReads || 0} 次 · 完读率 ${formatPercent(summary.completionRate)}`, 'book'],
  ];

  const sortChoices = [
    ['totalViews', '按累计阅读量'],
    ['rangeViews', `按近 ${days} 天阅读`],
    ['completionRate', '按读完率'],
    ['avgReadSeconds', '按平均停留'],
  ].map(([value, label]) => `<option value="${value}" ${sort === value ? 'selected' : ''}>${label}</option>`).join('');

  const originChoices = [
    ['', '全部来源'],
    ['human', '仅手写文章'],
    ['ai', '仅整理文章'],
  ].map(([value, label]) => `<option value="${value}" ${origin === value ? 'selected' : ''}>${label}</option>`).join('');

  const dims = report.dimensions || {};
  const insightsHtml = `<section class="settings-section">
    <div class="section-heading"><h2>受众与来源多维洞察（近 ${days} 天）</h2><p>按独立访客与浏览量汇总来源渠道、访客地域、终端设备与浏览器环境。</p></div>
    <div class="analytics-insights-grid">
      ${dimensionCard('流量来源渠道', '脱敏仅保留来源域名', dims.referrers || [])}
      ${dimensionCard('访问地区分布', '基于边缘节点识别国家/地区', dims.countries || [])}
      ${dimensionCard('设备与系统环境', '桌面端 / 移动端 / 平板占比', [...(dims.devices || []), ...(dims.os || [])].slice(0, 6))}
      ${dimensionCard('主流浏览器分布', '按访问客户端统计', dims.browsers || [])}
    </div>
  </section>`;

  const pages = (report.pages || []).map(page =>
    `<div class="analytics-page-card"><div><strong>${e(page.label)}</strong><code>${e(page.path)}</code></div><div class="analytics-page-nums"><span>近 ${days} 天：<b>${page.rangeViews}</b> 次 / ${page.rangeVisitors} 人</span><span>累计：<b>${page.totalViews}</b> 次 / ${page.totalVisitors} 人</span></div></div>`,
  ).join('');

  return `${heading}
  ${state.error ? notice(state.error, 'error') : ''}
  <div class="metric-strip">${metrics.map(([label, value, hint, glyph]) => `<div class="metric"><label>${icon(glyph)}${label}</label><strong>${e(value)}</strong><small>${e(hint)}</small></div>`).join('')}</div>
  <section class="settings-section">
    <div class="section-heading"><h2>访问趋势与阅读时段</h2><p>结合同源匿名访客标识（切网不断线）与边缘环境脱敏汇总。已自动排除站长登录访问与已知爬虫，同目标 30 分钟冷却，单篇停留单日上限 30 分钟。</p></div>
    ${summary.rangeViews ? dailyChart(report.daily, days, selectedDay) : `${dailyChart(report.daily, days, selectedDay)}<p class="field-hint" style="margin-top:12px">近 ${days} 天暂无访客记录；真实访客访问前台页面后，数据会自动呈现在这里。</p>`}
    ${hourlyChart(dims.hourly || [])}
  </section>
  ${insightsHtml}
  ${originComparisonSection(report.originBreakdown || [])}
  <section class="settings-section">
    <div class="section-bar" style="margin-bottom:16px"><h2>文章阅读情况明细</h2><small>共 ${(report.posts || []).length} 篇文章</small></div>
    <div class="filter-toolbar" style="margin-bottom:16px">
      <label class="search-field">${icon('search')}<input id="analytics-post-search" type="search" placeholder="筛选文章标题、路径或分类…" aria-label="筛选文章阅读统计" value="${e(search)}" /></label>
      <div class="filter-toolbar-right">
        <label class="analytics-sort-label"><span class="sr-only">内容形式</span><select id="analytics-post-origin" aria-label="文章创作形式筛选">${originChoices}</select></label>
        <label class="analytics-sort-label"><span class="sr-only">排序方式</span><select id="analytics-post-sort" aria-label="文章统计排序">${sortChoices}</select></label>
      </div>
    </div>
    <div id="analytics-post-table" class="analytics-table">${analyticsPostRows(report.posts, { search, origin, sort })}</div>
  </section>
  <section class="settings-section">
    <div class="section-heading"><h2>主要页面浏览分布</h2><p>包含首页、文章列表、归档、关于我与友链页（404 等错误页不计入）。</p></div>
    <div class="analytics-pages-grid">${pages}</div>
  </section>`;
}
