import {
  escape as e,
  icon,
  button,
  empty,
  status,
  date,
  size,
  safeImage,
  notice,
} from "./ui.js";
import {
  filterPosts,
  collectTaxonomy,
  summarizeWorkspace,
} from "./view-model.js";
import { postKey } from './bulk-model.js';
export const pageHeading = (title, description, actions = "", eyebrow = "") =>
  `<div class="page-heading"><div>${eyebrow ? `<p class="eyebrow">${e(eyebrow)}</p>` : ""}<h1>${e(title)}</h1><p>${e(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
const editAttrs = (post) =>
  `data-slug="${e(post.slug)}" data-status="${e(post.status)}"`;

export function overview(data, local, { direct = false } = {}) {
  const counts = summarizeWorkspace(data);
  const latest = [...data.posts]
    .sort((a, b) =>
      String(b.data.pubDate || "").localeCompare(String(a.data.pubDate || "")),
    )
    .slice(0, 5);
  const metrics = [
    ["已发表文章", counts.published, "前台可阅读的内容", "posts"],
    ["待完成草稿", counts.drafts, "继续上次的创作", "edit"],
    ["媒体资源", counts.media, "图片与文章素材", "image"],
    ["友情链接", counts.friends, "与朋友保持连接", "globe"],
  ];
  return `${pageHeading("内容总览", "欢迎回来，胡敖。这里是你的内容与站点工作区。", button("新建文章", "new-post", "plus", "primary"), "HUAOVO / OVERVIEW")}
  <div class="metric-strip">${metrics.map(([label, value, hint, glyph]) => `<div class="metric"><label>${icon(glyph)}${label}</label><strong>${value}</strong><small>${hint}</small></div>`).join("")}</div>
  <div class="overview-grid"><section><div class="section-bar"><h2>最近的文章</h2><a href="#/posts" class="button quiet">管理全部${icon("chevron")}</a></div>${latest.length ? latest.map((post, index) => `<div class="recent-row"><span class="post-index">${String(index + 1).padStart(2, "0")}</span><div class="recent-copy"><button type="button" data-action="edit-post" ${editAttrs(post)}>${e(post.data.title || "未命名草稿")}</button><p>${e(post.data.description || "还没有填写摘要，继续完善这篇文章。")}</p><div class="row-meta"><span>${e(post.data.category || "未设置分类")}</span><span class="meta-dot">/</span><span>${e(date(post.data.pubDate))}</span>${post.data.featured ? `<span class="badge published">精选</span>` : ""}</div></div>${status(post)}</div>`).join("") : empty("开始你的第一篇文章", "把一次实践、一段思考，整理成可以再次阅读的记录。", "new-post", "新建文章")}
  </section><aside class="overview-aside"><section class="side-section"><h2>常用操作</h2><div class="quick-actions">${[
    ["new-post", "edit", "开始写作", "创建新文章或保存草稿"],
    ["go-home", "home", "调整首页", "文案、公告与导航"],
    ["upload-media", "upload", "上传图片", "管理封面和正文素材"],
  ]
    .map(
      ([action, glyph, title, copy]) =>
        `<button type="button" class="quick-action" data-action="${action}">${icon(glyph)}<span><strong>${title}</strong><small>${copy}</small></span>${icon("chevron")}</button>`,
    )
    .join("")}</div></section>
  <section class="side-section"><h2>我的站点</h2><div class="site-mini"><div class="site-mini-brand"><img src="${e(safeImage(data.settings.identity.avatar) || "/favicon.svg")}" alt="" />${e(data.settings.identity.brand)}</div><p>${e(data.settings.identity.description)}</p><div class="site-mini-foot"><span>${local ? "本地预览" : direct ? "内容已连接" : "静态博客"}</span><a class="text-link" href="/" target="_blank" rel="noopener noreferrer">查看站点${icon("external")}</a></div></div></section>
  <section><h2 style="margin-bottom:10px">发布工作流</h2><p class="section-copy">${direct ? "草稿仅在后台可见。发布文章或保存配置后，前台立即更新；删除内容可从回收站恢复。" : local ? "保存草稿后继续编辑，确认内容与预览后发布。站点配置保存后，本地前台会自动更新。" : "草稿与配置提交到 GitHub 分支，通过检查后合并；Cloudflare 随后构建站点。"}</p><a class="text-link" style="margin-top:12px" href="#/connection">查看${direct ? '内容服务' : '发布与连接'}${icon("chevron")}</a></section></aside></div>`;
}
export function bulkToolbar(kind, items, selected, key) {
  const available = items.filter(item => !item.pendingDeletion);
  const count = available.filter(item => selected.has(key(item))).length;
  return `<div class="bulk-toolbar"><label class="selection-label"><input type="checkbox" class="selection-checkbox" data-select-all="${kind}" aria-label="全选当前筛选结果" ${available.length && count === available.length ? 'checked' : ''} ${!available.length ? 'disabled data-locked="true"' : ''} /><span>全选当前结果${available.length > 100 ? '（最多100项）' : ''}</span></label><span class="selection-count" id="${kind}-selection-count" role="status">已选择 ${count} 项</span><div class="bulk-actions">${button('取消选择', `clear-${kind}-selection`, '', 'quiet', count ? '' : 'disabled')}${button('批量删除', `delete-${kind}-batch`, 'delete', 'danger', count ? '' : 'disabled')}</div></div>`;
}
export function postTable(posts, selected = new Set()) {
  if (!posts.length)
    return empty(
      "没有符合条件的文章",
      "试试其他关键词，或创建一篇新的草稿。",
      "new-post",
      "新建文章",
    );
  return `<div class="table-header"><span></span><span>文章</span><span class="table-category">分类</span><span>文章日期</span><span>状态</span><span>操作</span></div>${posts.map((post) => `<div class="table-row ${selected.has(postKey(post)) ? 'selected' : ''}"><input type="checkbox" class="selection-checkbox" data-select-post="${e(postKey(post))}" aria-label="选择${post.status === 'draft' ? '草稿' : '文章'} ${e(post.data.title || post.slug)}" ${selected.has(postKey(post)) ? 'checked' : ''} ${post.pendingDeletion ? 'disabled data-locked="true"' : ''} /><div class="table-content"><button type="button" class="table-title" data-action="edit-post" ${editAttrs(post)} ${post.pendingDeletion ? 'disabled' : ''}>${e(post.data.title || "未命名草稿")}</button><p class="table-description">${e(post.data.description || post.slug)}</p></div><div class="table-category">${e(post.data.category || "未设置")}</div><div class="table-date">${e(date(post.data.pubDate))}</div><div class="table-state">${post.pendingDeletion ? '<span class="badge pending">待删除</span>' : status(post)}</div><div class="table-actions"><button type="button" class="icon-button" data-action="edit-post" ${editAttrs(post)} ${post.pendingDeletion ? 'disabled' : ''} aria-label="编辑 ${e(post.data.title || "草稿")}">${icon("edit")}</button><button type="button" class="icon-button" data-action="delete-post" ${editAttrs(post)} ${post.pendingDeletion ? 'disabled' : ''} aria-label="${post.status === "draft" ? "删除草稿" : "移除文章"} ${e(post.data.title || "")}">${icon("delete")}</button></div></div>`).join("")}`;
}
export function postsView(data, filters, selected = new Set()) {
  const counts = summarizeWorkspace(data);
  return `${pageHeading("文章管理", "管理已发表内容、草稿和文章更新。", button("新建文章", "new-post", "plus", "primary"))}
  <div class="filter-toolbar"><div class="tabs" role="tablist" aria-label="文章状态">${[
    ["all", "全部", data.posts.length],
    ["published", "已发表", counts.published],
    ["draft", "草稿", counts.drafts],
  ]
    .map(
      ([state, label, total]) =>
        `<button type="button" role="tab" aria-selected="${filters.state === state}" data-action="filter-state" data-state="${state}">${label}<small>${total}</small></button>`,
    )
    .join(
      "",
    )}</div><label class="search-field">${icon("search")}<input id="post-search" type="search" placeholder="搜索标题、摘要或标签…" aria-label="搜索文章" value="${e(filters.search)}" /></label></div>
  ${filters.category || filters.tag ? notice(`正在筛选：${filters.category || filters.tag}`) + button("清除筛选", "reset-filter", "", "quiet") : ""}<div id="posts-bulk">${bulkToolbar('posts', filterPosts(data.posts, filters), selected, postKey)}</div><div class="post-table" id="post-table">${postTable(filterPosts(data.posts, filters), selected)}</div><div class="table-footer"><span id="post-result-count">共 ${filterPosts(data.posts, filters).length} 篇内容</span><span>${data.connection?.mode === 'database' ? '草稿仅在后台可见，删除内容可从回收站恢复' : '草稿与待删除变更分别管理'}</span></div>`;
}
export function taxonomyView(data, categories) {
  const counts = collectTaxonomy(data.posts);
  return `${pageHeading("分类与标签", "分类建立知识体系，标签联系交叉主题。")}${notice("统计来自已发表文章。分类和标签在文章的发布设置中维护。")}
  <div class="taxonomy-grid"><section><div class="section-bar"><h2>知识体系分类</h2><small>${categories.length} 个分类</small></div>${categories.map((category) => `<div class="taxonomy-row"><div><strong>${e(category)}</strong><small>${counts.categories[category] || 0} 篇</small></div>${button("管理文章", "filter-category", "chevron", "quiet", `data-category="${e(category)}"`)}</div>`).join("")}</section><section><div class="section-bar"><h2>技术与研究标签</h2><small>${Object.keys(counts.tags).length} 个标签</small></div><div class="tag-cloud">${
    Object.entries(counts.tags)
      .map(
        ([tag, total]) =>
          `<button type="button" data-action="filter-tag" data-tag="${e(tag)}">${e(tag)} <small>· ${total}</small></button>`,
      )
      .join("") ||
    '<p class="section-copy">发布文章后，这里会自动显示标签。</p>'
  }</div><div class="section-bar" style="margin-top:32px"><h2>连载系列</h2></div>${
    Object.entries(counts.series)
      .map(
        ([name, total]) =>
          `<div class="taxonomy-row"><strong>${e(name)}</strong><small>${total} 篇</small></div>`,
      )
      .join("") ||
    '<p class="section-copy" style="margin-top:16px">在文章中填写系列名称，可以把连续的探索集中展示。</p>'
  }</section></div>`;
}
export function mediaView(data, search = "", selected = new Set()) {
  const media = data.media.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  return `${pageHeading("媒体资源", "管理文章封面、正文图片和站点素材。", button("上传图片", "upload-media", "upload", "primary"))}<div class="filter-toolbar"><span class="section-copy">${data.media.length} 项资源</span><label class="search-field">${icon("search")}<input id="media-search" type="search" placeholder="搜索文件名称…" aria-label="搜索媒体" value="${e(search)}" /></label></div><div id="media-bulk">${bulkToolbar('media', media, selected, item => item.name)}</div><div id="media-grid" class="media-grid">${mediaCards(media, selected)}</div><p class="upload-note">支持 JPG、PNG、WebP、GIF、AVIF，单张不超过 10 MB。文章或站点仍在使用的图片不能删除。</p>`;
}
export function mediaCards(media, selected = new Set()) {
  return media.length
    ? media
        .map(
          (item) =>
            `<article class="media-item ${selected.has(item.name) ? 'selected' : ''}"><label class="media-selection"><input type="checkbox" class="selection-checkbox" data-select-media="${e(item.name)}" aria-label="选择图片 ${e(item.name)}" ${selected.has(item.name) ? 'checked' : ''} ${item.pendingDeletion ? 'disabled data-locked="true"' : ''} /></label><div class="media-image"><img data-preview-media="${e(item.name)}" src="${e(safeImage(item.url))}" loading="lazy" alt="${e(item.name)}" /></div><div class="media-details"><strong title="${e(item.name)}">${e(item.name)}</strong><small>${size(item.size)} ${item.pendingDeletion ? '· 待删除' : ''}</small></div><div class="media-actions"><button type="button" class="icon-button" data-action="copy-media" data-name="${e(item.name)}" aria-label="复制 ${e(item.name)} 的地址">${icon("copy")}</button><button type="button" class="icon-button" data-action="delete-media" data-name="${e(item.name)}" ${item.pendingDeletion ? 'disabled' : ''} aria-label="删除图片 ${e(item.name)}">${icon("delete")}</button></div></article>`,
        )
        .join("")
    : empty(
        "媒体库还是空的",
        "上传你的第一张图片，之后可以在文章或站点配置中选择它。",
        "upload-media",
        "上传图片",
        "image",
      );
}
export function connectionView(data, config, loadError = "") {
  if (config.backend === 'api') return directConnectionView(data, config, loadError);
  const repoUrl = config.repo ? `https://github.com/${config.repo}` : "";
  return `${pageHeading("发布与连接", "检查内容发布进度，以及 GitHub 与 Cloudflare 的连接配置。", button("刷新状态", "refresh", "refresh", "secondary"))}${loadError ? notice(loadError, "error") : ""}
  <div class="connection-grid"><section class="settings-section"><div class="connection-detail">${icon(config.local ? "folder" : "github")}<div><h2>${config.local ? "本地内容工作区" : "GitHub 内容仓库"}</h2><p>${config.local ? "内容保存在当前项目，本地预览自动更新" : config.repo || "尚未配置内容仓库"}</p></div></div><dl class="config-list"><div><dt>当前模式</dt><dd>${config.local ? "本地编辑" : "生产管理"}</dd></div><div><dt>内容状态</dt><dd>${loadError ? "连接未完成" : "已连接"}</dd></div><div><dt>生产分支</dt><dd><code>${e(config.branch)}</code></dd></div><div><dt>GitHub 仓库</dt><dd>${repoUrl ? `<a class="text-link" href="${e(repoUrl)}" target="_blank" rel="noopener noreferrer">${e(config.repo)}${icon("external")}</a>` : "未配置 CMS_REPO"}</dd></div><div><dt>授权服务</dt><dd>${config.ready && !config.local ? e(config.authUrl) : "上线时配置 CMS_AUTH_URL"}</dd></div></dl><div style="margin-top:20px">${!config.local && config.ready ? button(data.connection?.authenticated ? "退出登录" : "使用 GitHub 登录", data.connection?.authenticated ? "logout" : "login", data.connection?.authenticated ? "logout" : "github", "primary") : config.local ? '<p class="section-copy">本地工作区无需登录。生产环境通过 GitHub 授权，凭据不写入站点配置。</p>' : notice("配置 CMS_REPO、CMS_AUTH_URL、SITE_URL 并重新构建后，即可使用 GitHub 登录。")}</div></section>
  <section class="settings-section"><div class="connection-detail">${icon("cloud")}<div><h2>Cloudflare Pages</h2><p>${config.local ? "等待生产部署配置" : "由仓库提交触发构建"}</p></div></div><dl class="config-list"><div><dt>站点地址</dt><dd>${e(config.siteUrl || "未配置 SITE_URL")}</dd></div><div><dt>构建命令</dt><dd><code>npm run check && npm test && npm run build</code></dd></div><div><dt>输出目录</dt><dd><code>dist</code></dd></div><div><dt>Node 版本</dt><dd><code>24</code></dd></div><div><dt>实时部署状态</dt><dd>在 Cloudflare 控制台确认</dd></div></dl><a class="text-link" style="margin-top:20px" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">打开 Cloudflare 控制台${icon("external")}</a><p class="field-hint">域名与密钥在部署服务中配置；这里显示内容和连接状态。</p></section></div>
  <section><div class="section-bar"><h2>待发布变更</h2><small>${data.releases.length} 项</small></div>${data.releases.length ? data.releases.map((release) => `<div class="release-row"><div><h3>${e(release.title)}</h3><p>${e(release.branch)} · ${release.state === "merged" ? "已合并，等待部署确认" : release.state === "draft" ? "草稿分支" : "等待检查与合并"}</p></div><div class="release-actions"><a class="button secondary" href="${e(release.url)}" target="_blank" rel="noopener noreferrer">查看变更${icon("external")}</a>${release.state === "review" ? button("检查并发布", "publish-release", "cloud", "primary", `data-id="${e(release.id)}"`) : ""}</div></div>`).join("") : empty("当前没有待发布变更", config.local ? "本地点击发布会更新当前前台；部署后，待审核的 GitHub 变更会显示在这里。" : "保存文章或配置后，可以在这里检查并发布变更。", "", "", "check")}</section>`;
}

function directConnectionView(data, config, loadError) {
  const connection = data.connection || {}, authenticated = connection.authenticated === true;
  const login = config.ready ? button(authenticated ? '退出登录' : '使用 GitHub 登录', authenticated ? 'logout' : 'login', authenticated ? 'logout' : 'github', 'primary') : notice('请检查授权服务与站点地址配置。', 'error');
  return `${pageHeading('内容服务', '发布文章、删除内容和保存配置后，前台立即更新。', button('刷新状态', 'refresh', 'refresh'))}${loadError ? notice(loadError, 'error') : ''}<div class="connection-grid"><section class="settings-section"><div class="connection-detail">${icon('folder')}<div><h2>内容数据库</h2><p>${e(connection.label || (authenticated ? '管理会话已连接' : '等待管理员登录'))}</p></div></div><dl class="config-list"><div><dt>内容状态</dt><dd>${authenticated ? connection.writable ? '可编辑' : '只读' : '尚未登录'}</dd></div><div><dt>管理员</dt><dd>${e(connection.user?.login || (authenticated ? '本站管理员' : '等待 GitHub 授权'))}</dd></div><div><dt>站点地址</dt><dd>${e(config.siteUrl)}</dd></div></dl><div class="connection-actions">${login}</div><p class="field-hint">管理会话保存在本站安全 Cookie 中，退出登录后失效。</p></section><section class="settings-section"><div class="connection-detail">${icon('clock')}<div><h2>恢复与备份</h2><p>保留修改前的版本和已删除内容。</p></div></div><p class="section-copy">在文章和站点配置中查看历史版本；在回收站找回内容，或下载包含图片文件的完整备份。</p><div class="connection-actions"><a class="button secondary" href="#/recovery">打开恢复与备份${icon('chevron')}</a></div></section></div>`;
}
