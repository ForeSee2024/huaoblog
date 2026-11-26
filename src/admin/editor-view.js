import {
  escape as e,
  icon,
  button,
  field,
  toggle,
  status,
  originBadge,
  safeImage,
} from "./ui.js";
import { extractMarkdownHeadings } from "../utils/reading-time.js";
import { getPostOrigin, ORIGIN_DISPLAY } from "../utils/post-origin.js";

export function renderOutlineItems(markdown = "") {
  const headings = extractMarkdownHeadings(markdown);
  if (!headings.length) {
    return '<p class="field-hint">在正文中使用 ## 二级标题或 ### 三级标题，这里会实时生成文章结构大纲。</p>';
  }
  return `<ul class="editor-outline-list">${headings
    .map(
      (item) =>
        `<li class="depth-${item.depth}"><span class="outline-level">H${item.depth}</span><span class="outline-text" title="${e(item.text)}">${e(item.text)}</span></li>`,
    )
    .join("")}</ul>`;
}

export function editorView(
  post,
  categories,
  local,
  image = (value) => value,
  { direct = false, knownTags = [], zen = false, mode = "rich" } = {},
) {
  const data = post.data,
    meta = data.extraMeta || {};
  const formats = [
    ["bold", "粗体 (⌘/Ctrl+B)", "bold"],
    ["italic", "斜体 (⌘/Ctrl+I)", "italic"],
    ["heading", "二级标题", "heading"],
    ["inline-code", "行内代码", "inlineCode"],
    ["quote", "引用块", "quote"],
    ["list", "无序列表", "list"],
    ["ordered", "有序列表", "ordered"],
    ["code", "代码块", "code"],
  ];
  const currentTagSet = new Set(data.tags || []);
  const quickTags = knownTags.slice(0, 14);
  const canViewOnline = post.hasPublishedVersion || post.status === "published";

  return `<div class="page-heading editor-heading">
    <div class="editor-heading-left">
      <a class="button quiet" href="#/posts">${icon("back")}文章管理</a>
      ${canViewOnline && post.slug ? `<a class="button quiet" href="/posts/${encodeURIComponent(post.slug)}" target="_blank" rel="noopener noreferrer">${icon("external")}查看线上</a>` : ""}
    </div>
    <div class="heading-actions">
      <span id="editor-save-state" class="editor-save-pill">${post.revision ? "已读取保存版本" : "新草稿"}</span>
      <button type="button" class="button quiet" id="btn-zen-toggle" data-action="toggle-zen" title="切换无干扰专注写作模式 (Alt + Z)">${icon(zen ? "minimize" : "maximize")}<span>${zen ? "退出专注" : "专注模式"}</span></button>
      ${direct && post.revision ? button("历史版本", "post-history", "clock", "quiet", `data-slug="${e(post.slug)}"`) : ""}
      ${button("保存草稿", "save-post", "save", "secondary")}
      ${button(local || direct ? "发布文章" : "提交发布", "publish-post", "cloud", "primary")}
    </div>
  </div>
  <div id="recovery-banner" class="recovery-banner" hidden><span>发现浏览器中尚未保存的编辑内容。</span><div>${button("恢复内容", "restore-recovery", "", "secondary")}${button("忽略", "discard-recovery", "", "quiet")}</div></div>
  <form id="article-form"><div class="editor-grid"><section class="editor-document">
    <div class="editor-document-head">
      <label class="sr-only" for="article-title">文章标题</label>
      <textarea id="article-title" class="article-title-input" name="title" rows="1" maxlength="100" placeholder="给这篇技术文章或笔记起一个好标题…">${e(data.title)}</textarea>
      <label class="sr-only" for="article-description">文章摘要</label>
      <textarea id="article-description" class="article-description-input" name="description" rows="2" maxlength="260" placeholder="用一两句话概括核心观点与收获，显示在文章卡片与搜索摘要中…">${e(data.description)}</textarea>
      <div class="editor-meta-counters">
        <span id="title-length-hint">标题 ${(data.title || "").length}/100</span>
        <span id="desc-length-hint">摘要 ${(data.description || "").length}/260</span>
      </div>
    </div>
    <div class="editor-toolbar">
      <div class="editor-formats">
        ${formats.map(([command, label, glyph]) => `<button type="button" class="icon-button" data-action="format" data-command="${command}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`).join("")}
        <span class="toolbar-divider"></span>
        <button type="button" class="icon-button" data-action="insert-link" aria-label="插入链接" title="插入链接 (⌘/Ctrl+K)">${icon("link")}</button>
        <button type="button" class="icon-button" data-action="insert-image" aria-label="插入图片" title="插入图片（支持直接粘贴截图或拖入图片）">${icon("image")}</button>
        <button type="button" class="icon-button" data-action="insert-table" aria-label="插入表格" title="插入 Markdown 表格">${icon("table")}</button>
        <button type="button" class="icon-button" data-action="insert-divider" aria-label="插入分隔线" title="插入水平分隔线">${icon("divider")}</button>
        <button type="button" class="icon-button" data-action="insert-math" aria-label="插入公式" title="插入 LaTeX 数学公式（含实时预览）">${icon("math")}</button>
      </div>
      <div class="editor-modes" role="tablist" aria-label="编辑模式">${[
        ["rich", "富文本"],
        ["split", "分栏对照"],
        ["markdown", "Markdown"],
        ["preview", "预览"],
      ]
        .map(
          ([itemMode, label]) =>
            `<button type="button" role="tab" aria-selected="${itemMode === mode}" data-action="editor-mode" data-mode="${itemMode}">${label}</button>`,
        )
        .join("")}</div>
    </div>
    <div id="editor-canvas" class="editor-canvas" aria-live="off"><div class="loading-state" style="padding:60px 20px"><span class="loading-spinner"></span><p>正在准备编辑器…</p></div></div>
    <div class="editor-bottom">
      <span id="article-character-count">0 字 · 约 1 分钟阅读</span>
      <span class="editor-shortcuts-hint">粘贴/拖入图片自动上传 · <code>Alt+Z</code> 专注 · <code>⌘/Ctrl+S</code> 保存</span>
    </div>
  </section>
  <aside class="editor-inspector">
    <section class="inspector-section">
      <h2>发布设置</h2>
      <div id="article-status" class="article-status-row">${status(post)}${originBadge(post)}</div>
      ${post.hasPublishedVersion ? '<p class="field-hint">已有前台版本，保存草稿不会替换线上内容。</p>' : ""}
      ${field("创作方式", "origin", getPostOrigin(post), {
        choices: [
          ["human", ORIGIN_DISPLAY.human.choiceLabel],
          ["ai", ORIGIN_DISPLAY.ai.choiceLabel],
        ],
        hint: "区分本人手写与 AI 辅助整理；前台仅温和标识为「手写」与「整理」。",
      })}
      ${field("文章路径", "slug", post.slug, { disabled: Boolean(post.revision), max: 120, hint: post.revision ? "保持路径稳定，已有链接不会改变。" : "小写英文、数字和连字符。" })}
      ${!post.revision ? `<button type="button" class="button quiet slug-suggest-btn" data-action="suggest-slug">${icon("sparkles")}根据标题生成路径</button>` : ""}
      ${field("所属分类", "category", data.category, { choices: categories })}
      ${field("文章日期", "pubDate", data.pubDate, { type: "date", hint: "用于前台展示与排序。" })}
      ${field("技术标签", "tags", (data.tags || []).join(", "), { placeholder: "Rust, Linux, LLM", hint: "逗号分隔，或点选下方已有标签。" })}
      ${quickTags.length ? `<div class="quick-tag-picks" id="editor-quick-tags" aria-label="常用标签点选">${quickTags.map((tag) => `<button type="button" class="quick-tag-chip ${currentTagSet.has(tag) ? "active" : ""}" data-action="toggle-editor-tag" data-tag="${e(tag)}">#${e(tag)}</button>`).join("")}</div>` : ""}
      ${field("所属系列", "series", data.series || "", { placeholder: "可选连载专题名", max: 100 })}
      ${toggle("精选置顶", "featured", data.featured, "优先固定显示在首页与博文列表顶部。")}
      <details><summary>扩展信息（赛事 / 难度 / 仓库）</summary>${field("赛事 / 实战主题", "extraMeta.targetEvent", meta.targetEvent || "", { max: 100 })}${field("难度", "extraMeta.difficulty", meta.difficulty || "", { choices: [["", "未设置"], "入门", "进阶", "硬核"] })}${field("论文 DOI", "extraMeta.paperDoi", meta.paperDoi || "", { max: 200 })}${field("配套仓库", "extraMeta.repoUrl", meta.repoUrl || "", { type: "url", placeholder: "https://github.com/…" })}</details>
    </section>
    <section class="inspector-section">
      <h2>文章封面</h2>
      <button type="button" id="cover-picker" class="cover-picker" data-action="pick-cover">${data.coverImage ? `<img data-preview-path="${e(data.coverImage)}" src="${e(safeImage(image(data.coverImage)))}" alt="文章封面" />` : `${icon("image")}<span>从媒体库选择或上传</span>`}</button>
      <input type="hidden" name="coverImage" value="${e(data.coverImage || "")}" />
      <button type="button" class="button quiet cover-clear" data-action="clear-cover" ${data.coverImage ? "" : "hidden"}>移除封面</button>
    </section>
    <section class="inspector-section">
      <h2>文档结构大纲</h2>
      <div id="editor-outline-panel">${renderOutlineItems(post.body)}</div>
    </section>
    <div class="editor-guide">
      <strong>高效写作技巧</strong>
      <p>富文本下输入 <code>/</code> 呼出插入菜单；分栏与 Markdown 模式支持 <code>Tab</code> 缩进及直接粘贴剪贴板截图自动上传。</p>
      <p style="margin-top:8px">${direct ? "草稿仅在后台可见，点击发布后前台即时生效。" : local ? "草稿保存在本地工作区，发布后前台自动更新。" : "提交发布后，在“发布与连接”中检查并合并。"}</p>
    </div>
  </aside></div></form>`;
}
