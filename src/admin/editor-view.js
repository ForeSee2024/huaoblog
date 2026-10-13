import {
  escape as e,
  icon,
  button,
  field,
  toggle,
  status,
  safeImage,
} from "./ui.js";
export function editorView(post, categories, local, image = (value) => value) {
  const data = post.data,
    meta = data.extraMeta || {};
  const formats = [
    ["bold", "粗体"],
    ["italic", "斜体"],
    ["heading", "二级标题"],
    ["quote", "引用"],
    ["list", "无序列表"],
    ["ordered", "有序列表"],
    ["code", "代码块"],
  ];
  return `<div class="page-heading editor-heading"><div><a class="button quiet" href="#/posts">${icon("back")}文章管理</a></div><div class="heading-actions"><span id="editor-save-state" class="section-copy">${post.revision ? "已读取保存版本" : "新草稿"}</span>${button("保存草稿", "save-post", "save", "secondary")}${button(local ? "发布文章" : "提交发布", "publish-post", "cloud", "primary")}</div></div>
  <div id="recovery-banner" class="recovery-banner" hidden><span>发现浏览器中尚未保存的编辑内容。</span><div>${button("恢复内容", "restore-recovery", "", "secondary")}${button("忽略", "discard-recovery", "", "quiet")}</div></div>
  <form id="article-form"><div class="editor-grid"><section class="editor-document"><div class="editor-document-head"><label class="sr-only" for="article-title">文章标题</label><textarea id="article-title" class="article-title-input" name="title" rows="1" maxlength="100" placeholder="给这篇笔记一个标题…">${e(data.title)}</textarea><label class="sr-only" for="article-description">文章摘要</label><textarea id="article-description" class="article-description-input" name="description" rows="2" maxlength="260" placeholder="用一两句话概括文章，帮助读者了解内容…">${e(data.description)}</textarea></div>
  <div class="editor-toolbar"><div class="editor-formats">${formats.map(([command, label]) => `<button type="button" class="icon-button" data-action="format" data-command="${command}" aria-label="${label}" title="${label}">${icon(command)}</button>`).join("")}<span class="toolbar-divider"></span><button type="button" class="icon-button" data-action="insert-link" aria-label="插入链接" title="插入链接">${icon("link")}</button><button type="button" class="icon-button" data-action="insert-image" aria-label="插入图片" title="插入图片">${icon("image")}</button><button type="button" class="icon-button" data-action="insert-math" aria-label="插入公式" title="插入公式">${icon("math")}</button></div><div class="editor-modes" role="tablist" aria-label="编辑模式">${[
    ["rich", "富文本"],
    ["markdown", "Markdown"],
    ["preview", "预览"],
  ]
    .map(
      ([mode, label]) =>
        `<button type="button" role="tab" aria-selected="${mode === "rich"}" data-action="editor-mode" data-mode="${mode}">${label}</button>`,
    )
    .join("")}</div></div>
  <div id="editor-canvas" class="editor-canvas" aria-live="off"><div class="loading-state" style="padding:60px 20px"><span class="loading-spinner"></span><p>正在准备编辑器…</p></div></div><div class="editor-bottom"><span id="article-character-count">0 字符</span><span>⌘ / Ctrl + S 保存草稿</span></div></section>
  <aside class="editor-inspector"><section class="inspector-section"><h2>发布设置</h2><div id="article-status">${status(post)}</div>${post.hasPublishedVersion ? '<p class="field-hint">已有前台版本，保存草稿不会替换它。</p>' : ""}${field("文章路径", "slug", post.slug, { disabled: Boolean(post.revision), max: 120, hint: post.revision ? "保持路径稳定，已有链接不会改变。" : "小写英文、数字和连字符。" })}${field("所属分类", "category", data.category, { choices: categories })}${field("文章日期", "pubDate", data.pubDate, { type: "date", hint: "用于前台展示与排序。" })}${field("技术标签", "tags", (data.tags || []).join(", "), { placeholder: "Rust, Linux, LLM", hint: "使用逗号分隔，最多 20 个。" })}${field("所属系列", "series", data.series || "", { placeholder: "可选", max: 100 })}${toggle("精选置顶", "featured", data.featured, "优先显示在首页文章流。")}<details><summary>扩展信息</summary>${field("赛事 / 实战主题", "extraMeta.targetEvent", meta.targetEvent || "", { max: 100 })}${field("难度", "extraMeta.difficulty", meta.difficulty || "", { choices: [["", "未设置"], "入门", "进阶", "硬核"] })}${field("论文 DOI", "extraMeta.paperDoi", meta.paperDoi || "", { max: 200 })}${field("配套仓库", "extraMeta.repoUrl", meta.repoUrl || "", { type: "url", placeholder: "https://github.com/…" })}</details></section>
  <section class="inspector-section"><h2>文章封面</h2><button type="button" id="cover-picker" class="cover-picker" data-action="pick-cover">${data.coverImage ? `<img data-preview-path="${e(data.coverImage)}" src="${e(safeImage(image(data.coverImage)))}" alt="文章封面" />` : `${icon("image")}<span>从媒体库选择或上传</span>`}</button><input type="hidden" name="coverImage" value="${e(data.coverImage || "")}" /><button type="button" class="button quiet cover-clear" data-action="clear-cover" ${data.coverImage ? "" : "hidden"}>移除封面</button></section><div class="editor-guide"><strong>写作提示</strong><p>输入 / 打开插入菜单。支持图片、代码块、表格和数学公式；Markdown 视图可以精确调整源文。</p><p style="margin-top:10px">${local ? "草稿保存在本地工作区，发布后前台自动更新。" : "提交发布后，在“发布与连接”中检查并合并。"}</p></div></aside></div></form>`;
}
