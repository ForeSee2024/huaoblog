import { createRepository } from "./repository.js";
import { validatePost } from "./content-model.js";
import { validateSettings } from "./settings-model.js";
import { escape as e, icon, button, field, notice, safeImage } from "./ui.js";
import {
  overview,
  postsView,
  postTable,
  taxonomyView,
  mediaView,
  mediaCards,
  connectionView,
} from "./views.js";
import { settingsView, settingsPreview } from "./settings-view.js";
import { editorView } from "./editor-view.js";
import { filterPosts, parseTags } from "./view-model.js";

const config = JSON.parse(document.body.dataset.connection);
const initialSettings = JSON.parse(document.body.dataset.settings);
const categories = JSON.parse(document.body.dataset.categories);
const repository = createRepository(config);
const main = document.getElementById("console-main");
const dialog = document.getElementById("console-dialog");
let data = {
  posts: [],
  media: [],
  settings: initialSettings,
  releases: [],
  connection: {},
};
let currentRoute = "",
  loadError = "",
  dirty = false,
  activePost = null,
  editingSettings = null,
  editor = null,
  editorMode = "rich",
  editorGeneration = 0,
  recovery = null,
  toastTimer,
  recoveryTimer;
let filters = { search: "", state: "all", category: "", tag: "" },
  mediaSearch = "",
  saving = false;
const copy = (value) => structuredClone(value);
const publicPath = (media) =>
  media.publicUrl || (media.path || "").replace(/^public/, "") || media.url;
const resolveImage = (value) =>
  data.media.find((media) => publicPath(media) === value)?.url || value;
const titles = {
  overview: "内容总览",
  posts: "文章管理",
  taxonomy: "分类与标签",
  media: "媒体资源",
  settings: "站点配置",
  connection: "发布与连接",
};
const previewTasks = new Map();
const previewQueue = [];
let previewRequests = 0;
let mediaObserver;

function requestPreview(media) {
  const key = media.revision || media.path;
  if (previewTasks.has(key)) return previewTasks.get(key);
  const task = new Promise((resolve, reject) =>
    previewQueue.push({ media, resolve, reject }),
  );
  previewTasks.set(key, task);
  function pump() {
    while (previewRequests < 3 && previewQueue.length) {
      const job = previewQueue.shift();
      previewRequests++;
      repository
        .getMediaPreview(job.media)
        .then((result) => {
          const updated = result.media;
          const index = data.media.findIndex(
            (item) => item.path === updated.path,
          );
          if (index >= 0) data.media[index] = updated;
          job.resolve(updated);
        })
        .catch(job.reject)
        .finally(() => {
          previewRequests--;
          previewTasks.delete(job.media.revision || job.media.path);
          pump();
        });
    }
  }
  pump();
  return task;
}

function observeMedia(scope = main) {
  if (!repository.getMediaPreview) return;
  if (scope === main) mediaObserver?.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target;
        observer.unobserve(image);
        const path = image.dataset.articleImageSrc || image.dataset.previewPath;
        const media = data.media.find((item) =>
          image.dataset.previewMedia
            ? item.name === image.dataset.previewMedia
            : publicPath(item) === path,
        );
        if (!media?.previewPending) continue;
        requestPreview(media)
          .then((updated) => {
            if (image.isConnected) image.src = safeImage(updated.url);
          })
          .catch((error) => {
            image.title = error.message;
            toast("部分图片预览未完成，仍可保存与发布内容。", true);
          });
      }
    },
    { rootMargin: "160px" },
  );
  scope
    .querySelectorAll(
      "img[data-preview-media],img[data-preview-path],img[data-article-image-src]",
    )
    .forEach((image) => observer.observe(image));
  if (scope === main) mediaObserver = observer;
  else
    dialog.addEventListener("close", () => observer.disconnect(), {
      once: true,
    });
}

document.querySelectorAll("[data-icon]").forEach((element) => {
  element.innerHTML = icon(
    element.dataset.icon === "theme"
      ? document.documentElement.dataset.theme === "dark"
        ? "sun"
        : "moon"
      : element.dataset.icon,
  );
});
function themeChanged() {
  document.querySelector("#console-theme").innerHTML = icon(
    document.documentElement.dataset.theme === "dark" ? "sun" : "moon",
  );
}
document.getElementById("console-theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("blog-theme", theme);
  } catch {}
  window.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme } }));
});
window.addEventListener("theme-changed", themeChanged);
const mobileNavQuery = window.matchMedia("(max-width: 760px)");
function openNav(open) {
  const mobile = mobileNavQuery.matches;
  document.body.classList.toggle("nav-visible", mobile && open);
  document.getElementById("nav-scrim").hidden = !(mobile && open);
  document
    .getElementById("nav-open")
    .setAttribute("aria-expanded", String(mobile && open));
  document.getElementById("console-nav").inert = mobile && !open;
  document.querySelector(".console-body").inert = mobile && open;
  if (mobile && open)
    document.querySelector(".console-nav a[aria-current]")?.focus();
}
mobileNavQuery.addEventListener("change", () => openNav(false));
openNav(false);
document.getElementById("console-nav").addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || !mobileNavQuery.matches) return;
  const controls = [
    ...document
      .getElementById("console-nav")
      .querySelectorAll("a[href],button:not(:disabled)"),
  ].filter((element) => element.getClientRects().length);
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
document
  .getElementById("nav-open")
  .addEventListener("click", () => openNav(true));
document.getElementById("nav-close").addEventListener("click", () => {
  openNav(false);
  document.getElementById("nav-open").focus();
});
document
  .getElementById("nav-scrim")
  .addEventListener("click", () => openNav(false));
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.body.classList.contains("nav-visible")
  ) {
    openNav(false);
    document.getElementById("nav-open").focus();
  }
});
function toast(message, error = false) {
  const element = document.getElementById("console-toast");
  clearTimeout(toastTimer);
  element.innerHTML =
    icon(error ? "alert" : "check") + `<span>${e(message)}</span>`;
  element.classList.toggle("error", error);
  element.hidden = false;
  toastTimer = setTimeout(
    () => {
      element.hidden = true;
    },
    error ? 9000 : 4500,
  );
}
function showError(error) {
  const message = error?.message || "操作未完成，请重试。";
  toast(message, true);
  document.getElementById("operation-error")?.remove();
  const element = document.createElement("div");
  element.id = "operation-error";
  element.innerHTML = notice(message, "error");
  main.prepend(element);
}
function markDirty() {
  dirty = true;
  document
    .getElementById("editor-save-state")
    ?.replaceChildren(document.createTextNode("有未保存的修改"));
  document
    .getElementById("settings-save-state")
    ?.replaceChildren(document.createTextNode("有未保存的配置"));
  if (activePost) {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(storeRecovery, 300);
  }
}
function recoveryKey() {
  return `huaovo-recovery:${config.repo || "local"}:${currentRoute === "editor/new" ? "new" : activePost?.slug || "new"}`;
}
function storeRecovery() {
  if (!activePost || !dirty) return;
  try {
    localStorage.setItem(
      recoveryKey(),
      JSON.stringify({ post: gatherPost(), savedAt: Date.now() }),
    );
  } catch {}
}
function clearRecovery() {
  clearTimeout(recoveryTimer);
  try {
    localStorage.removeItem(recoveryKey());
  } catch {}
  recovery = null;
}
function setSaving(value) {
  saving = value;
  main.setAttribute("aria-busy", String(value));
  main.querySelectorAll("#article-form,#settings-form").forEach((form) => {
    form.inert = value;
  });
  if (value) {
    document
      .getElementById("editor-save-state")
      ?.replaceChildren(document.createTextNode("正在保存…"));
    document
      .getElementById("settings-save-state")
      ?.replaceChildren(document.createTextNode("正在保存…"));
  }
}

function ask(title, content, confirmLabel = "确认", danger = false) {
  return new Promise((resolve) => {
    dialog.classList.remove("wide");
    dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2><button type="button" class="icon-button" data-dialog="cancel" aria-label="关闭对话框">${icon("close")}</button></div>${content}<div class="dialog-actions"><button type="button" class="button secondary" data-dialog="cancel">取消</button><button type="button" class="button ${danger ? "danger" : "primary"}" data-dialog="confirm">${e(confirmLabel)}</button></div>`;
    dialog.setAttribute("aria-labelledby", "dialog-title");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.removeEventListener("cancel", cancel);
      dialog.onclick = null;
      resolve(value);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    dialog.addEventListener("cancel", cancel);
    dialog.onclick = (event) => {
      const target = event.target.closest("[data-dialog]");
      if (target?.dataset.dialog === "cancel") finish(null);
      if (target?.dataset.dialog === "confirm") {
        const form = dialog.querySelector("form");
        if (form && !form.reportValidity()) return;
        finish(form ? new FormData(form) : true);
      }
    };
    dialog.showModal();
    observeMedia(dialog);
  });
}
async function go(route) {
  location.hash = `#/${route}`;
}
async function readWorkspace() {
  try {
    const loaded = await repository.load();
    data = {
      ...data,
      ...loaded,
      settings: loaded.settings || initialSettings,
      posts: loaded.posts || [],
      media: loaded.media || [],
      releases: loaded.releases || [],
    };
    loadError =
      !config.local && !data.connection.authenticated
        ? config.ready
          ? "使用 GitHub 登录后，读取你的文章与待发布变更。"
          : "请在部署环境配置内容仓库、授权服务和站点地址。"
        : "";
    document.getElementById("connection-chip").innerHTML =
      `<span class="status-dot"></span>${config.local ? "本地已连接" : e(data.connection.user?.login || (data.connection.authenticated ? "GitHub 已连接" : "等待登录"))}`;
    document.getElementById("console-footer-state").textContent = config.local
      ? "本地内容已同步"
      : data.connection.authenticated
        ? "GitHub 内容已同步"
        : "等待 GitHub 授权";
  } catch (error) {
    loadError = error.message || "工作区连接失败。";
    document.getElementById("connection-chip").innerHTML =
      icon("alert") + "等待连接";
  }
  document.getElementById("nav-post-count").textContent = String(
    data.posts.length,
  );
}
async function render(route) {
  const navWasOpen = document.body.classList.contains("nav-visible");
  editorGeneration++;
  if (editor) {
    await editor.destroy();
    editor = null;
  }
  const previous = currentRoute;
  currentRoute = route;
  const segments = route.split("/");
  const page = segments[0];
  document.getElementById("operation-error")?.remove();
  document.getElementById("workspace-title").textContent =
    titles[page] || "文章编辑";
  document.querySelectorAll("[data-route]").forEach((link) => {
    const id = link.dataset.route;
    const selected =
      id === route ||
      (id === "posts" && page === "editor") ||
      (id === "settings/general" &&
        page === "settings" &&
        segments[1] === "footer") ||
      (id === "settings/about" &&
        page === "settings" &&
        segments[1] === "friends");
    selected
      ? link.setAttribute("aria-current", "page")
      : link.removeAttribute("aria-current");
  });
  openNav(false);
  if (page !== "editor") activePost = null;
  if (page !== "settings") editingSettings = null;
  if (page === "overview")
    main.innerHTML =
      (loadError ? notice(loadError, "error") : "") +
      overview(data, config.local);
  else if (page === "posts") main.innerHTML = postsView(data, filters);
  else if (page === "taxonomy") main.innerHTML = taxonomyView(data, categories);
  else if (page === "media") main.innerHTML = mediaView(data, mediaSearch);
  else if (page === "connection")
    main.innerHTML = connectionView(data, config, loadError);
  else if (page === "settings") {
    if (!editingSettings || !previous.startsWith("settings/"))
      editingSettings = copy(validateSettings(data.settings));
    main.innerHTML = settingsView(
      editingSettings,
      segments[1] || "general",
      config.local,
      resolveImage,
    );
  } else if (page === "editor") {
    const slug = segments[1],
      version = segments[2] || "draft";
    if (slug === "new") {
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      activePost = {
        slug: `${localDate}-note-${crypto.randomUUID().slice(0, 8)}`,
        status: "draft",
        data: {
          title: "",
          description: "",
          pubDate: localDate,
          category: categories[0],
          tags: [],
          featured: false,
        },
        body: "",
      };
    } else
      activePost = copy(
        data.posts.find(
          (post) => post.slug === slug && post.status === version,
        ) || data.posts.find((post) => post.slug === slug),
      );
    if (!activePost) {
      main.innerHTML =
        notice("没有找到这篇文章，请刷新内容列表。", "error") +
        button("返回文章", "go-posts");
      return;
    }
    main.innerHTML = editorView(
      activePost,
      categories,
      config.local,
      resolveImage,
    );
    editorMode = "rich";
    await mountEditor();
    try {
      const cached = JSON.parse(localStorage.getItem(recoveryKey()) || "null");
      if (
        cached?.post &&
        JSON.stringify(cached.post) !== JSON.stringify(activePost)
      ) {
        recovery = cached.post;
        document.getElementById("recovery-banner").hidden = false;
      }
    } catch {}
    updateCharacterCount();
    resizeTitle();
  } else {
    await go("overview");
    return;
  }
  main
    .querySelectorAll("form")
    .forEach((form) =>
      form.addEventListener("submit", (event) => event.preventDefault()),
    );
  if (dirty) {
    document
      .getElementById("editor-save-state")
      ?.replaceChildren(document.createTextNode("有未保存的修改"));
    document
      .getElementById("settings-save-state")
      ?.replaceChildren(document.createTextNode("有未保存的配置"));
  }
  document.title = `${titles[page] || "文章编辑"} · ${data.settings.identity.brand}`;
  observeMedia();
  if (navWasOpen) main.focus();
}
function gatherPost() {
  if (!activePost) return null;
  const form = main.querySelector("#article-form");
  if (!form) return activePost;
  const values = new FormData(form);
  const value = (name) => String(values.get(name) ?? "");
  activePost.data = {
    ...activePost.data,
    title: value("title"),
    description: value("description"),
    pubDate: value("pubDate"),
    category: value("category"),
    tags: parseTags(value("tags")),
    series: value("series"),
    featured: values.has("featured"),
    coverImage: value("coverImage"),
    extraMeta: {
      ...(activePost.data.extraMeta || {}),
      targetEvent: value("extraMeta.targetEvent"),
      difficulty: value("extraMeta.difficulty"),
      paperDoi: value("extraMeta.paperDoi"),
      repoUrl: value("extraMeta.repoUrl"),
    },
  };
  if (!activePost.revision) activePost.slug = value("slug");
  activePost.body =
    editorMode === "markdown"
      ? document.getElementById("markdown-source").value
      : editor
        ? editor.getMarkdown()
        : activePost.body;
  return activePost;
}
function setPath(object, path, value) {
  const keys = path.split(".");
  let current = object;
  for (const key of keys.slice(0, -1)) current = current[key];
  current[keys.at(-1)] = value;
}
function gatherSettings() {
  const form = main.querySelector("#settings-form");
  if (!form) return editingSettings;
  for (const control of form.querySelectorAll("[name]"))
    setPath(
      editingSettings,
      control.name,
      control.type === "checkbox"
        ? control.checked
        : control.type === "number"
          ? Number(control.value)
          : control.value,
    );
  return editingSettings;
}
function updateCharacterCount() {
  const count = (activePost?.body || "").replace(/\s/g, "").length;
  document
    .getElementById("article-character-count")
    ?.replaceChildren(
      document.createTextNode(`${count.toLocaleString()} 字符`),
    );
}
function resizeTitle() {
  const title = document.getElementById("article-title");
  if (title) {
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  }
}
async function mountEditor() {
  const host = document.getElementById("editor-canvas"),
    generation = ++editorGeneration;
  if (!host) return;
  if (editorMode === "markdown") {
    host.innerHTML = `<label class="sr-only" for="markdown-source">Markdown 正文</label><textarea id="markdown-source" class="markdown-source" spellcheck="false">${e(activePost.body)}</textarea>`;
    return;
  }
  if (editorMode === "preview") {
    const { renderMarkdownPreview } = await import('../lib/markdown-preview.js');
    if (generation !== editorGeneration || !host.isConnected) return;
    host.innerHTML = `<article class="article-preview"><header class="post-intro"><div class="post-intro-content"><div class="post-meta"><span class="post-category">${e(activePost.data.category)}</span><span>${e(activePost.data.pubDate)}</span></div><h1 class="post-heading">${e(activePost.data.title || "未命名文章")}</h1><p class="post-summary">${e(activePost.data.description)}</p></div></header>${activePost.data.coverImage ? `<img class="post-cover" data-preview-path="${e(activePost.data.coverImage)}" src="${e(safeImage(resolveImage(activePost.data.coverImage)))}" alt="文章封面" />` : ""}<div class="post-body article-prose">${renderMarkdownPreview(activePost.body, resolveImage, true)}</div></article>`;
    return;
  }
  host.innerHTML = "";
  const { createArticleEditor } = await import("./article-editor.js");
  if (generation !== editorGeneration || !host.isConnected) return;
  const instance = await createArticleEditor(host, {
    value: activePost.body,
    resolveImage,
    onChange: (markdown) => {
      if (generation !== editorGeneration) return;
      activePost.body = markdown;
      markDirty();
      updateCharacterCount();
    },
    onUpload: async (file) => {
      const result = await repository.uploadMedia(file);
      if (result.media) data.media.push(result.media);
      toast("图片已上传");
      return publicPath(result.media);
    },
  });
  if (generation !== editorGeneration) {
    await instance.destroy();
    return;
  }
  editor = instance;
  observeMedia();
}
async function changeMode(mode) {
  gatherPost();
  editorGeneration++;
  if (editor) {
    await editor.destroy();
    editor = null;
  }
  editorMode = mode;
  main
    .querySelectorAll("[data-mode]")
    .forEach((tab) =>
      tab.setAttribute("aria-selected", String(tab.dataset.mode === mode)),
    );
  await mountEditor();
  observeMedia();
}
async function insertMarkdown(markdown) {
  if (editorMode === "preview") await changeMode("markdown");
  if (editorMode === "markdown") {
    const source = document.getElementById("markdown-source");
    source.setRangeText(
      markdown,
      source.selectionStart,
      source.selectionEnd,
      "end",
    );
    activePost.body = source.value;
    source.focus();
  } else await editor?.insertMarkdown(markdown);
  markDirty();
  updateCharacterCount();
  observeMedia();
}
async function format(command) {
  if (editorMode === "preview") return;
  if (editorMode === "rich") {
    editor?.command(command);
    return;
  }
  const source = document.getElementById("markdown-source");
  const selected = source.value.slice(
    source.selectionStart,
    source.selectionEnd,
  );
  const formats = {
    bold: `**${selected || "粗体文字"}**`,
    italic: `*${selected || "强调文字"}*`,
    heading: `\n## ${selected || "小标题"}\n`,
    quote: `\n> ${selected || "引用文字"}\n`,
    list: `\n- ${selected || "列表条目"}\n`,
    ordered: `\n1. ${selected || "列表条目"}\n`,
    code: "\n```javascript\n" + (selected || "// 在这里填写代码") + "\n```\n",
  };
  await insertMarkdown(formats[command] || "");
}

async function chooseUpload() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
    input.hidden = true;
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        resolve(file);
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}
async function upload() {
  const file = await chooseUpload();
  if (!file) return null;
  toast("正在上传图片…");
  const result = await repository.uploadMedia(file);
  if (result.media) {
    const index = data.media.findIndex(
      (media) => media.name === result.media.name,
    );
    if (index < 0) data.media.unshift(result.media);
    else data.media[index] = result.media;
  }
  if (
    result.release &&
    !data.releases.some((release) => release.id === result.release.id)
  )
    data.releases.push(result.release);
  toast("图片已保存到媒体库");
  return result.media;
}
function chooseMedia(title) {
  return new Promise((resolve) => {
    dialog.classList.add("wide");
    dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2><button type="button" class="icon-button" data-picker="close" aria-label="关闭媒体选择">${icon("close")}</button></div><p class="dialog-copy">选择已有素材，或上传一张新图片。</p><button type="button" class="button primary" data-picker="upload">${icon("upload")}上传新图片</button><div class="dialog-media-grid">${data.media.map((media) => `<button type="button" class="dialog-media-item" data-picker="select" data-name="${e(media.name)}"><img data-preview-media="${e(media.name)}" src="${e(safeImage(media.url))}" alt="" /><span>${e(media.name)}</span></button>`).join("")}</div>`;
    dialog.setAttribute("aria-labelledby", "dialog-title");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.onclick = null;
      dialog.removeEventListener("cancel", cancel);
      resolve(value);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    dialog.addEventListener("cancel", cancel);
    dialog.onclick = async (event) => {
      const target = event.target.closest("[data-picker]");
      if (!target) return;
      if (target.dataset.picker === "close") finish(null);
      if (target.dataset.picker === "select")
        finish(data.media.find((media) => media.name === target.dataset.name));
      if (target.dataset.picker === "upload") {
        try {
          target.disabled = true;
          const media = await upload();
          if (media) finish(media);
        } catch (error) {
          toast(error.message, true);
        } finally {
          target.disabled = false;
        }
      }
    };
    dialog.showModal();
    observeMedia(dialog);
  });
}
async function saveArticle(publish = false) {
  const post = gatherPost();
  validatePost(post, { publish });
  if (
    publish &&
    !(await ask(
      config.local ? "发布这篇文章？" : "提交这篇文章发布？",
      `<p class="dialog-copy">${config.local ? "文章将显示在本地前台，发布后仍可继续编辑。" : "将创建待发布变更。检查通过并合并后，Cloudflare 构建站点。"}</p><strong>${e(post.data.title)}</strong>`,
      config.local ? "确认发布" : "提交发布",
    ))
  )
    return;
  const result = await repository.savePost(post, { publish });
  clearRecovery();
  dirty = false;
  await readWorkspace();
  activePost = result.post || post;
  const saved = copy(activePost);
  history.replaceState(null, "", `#/editor/${saved.slug}/${saved.status}`);
  await render(`editor/${saved.slug}/${saved.status}`);
  toast(
    publish
      ? config.local
        ? "文章已发布到本地前台"
        : "文章已提交，前往“发布与连接”检查并发布"
      : "草稿已保存",
  );
}
async function saveConfiguration() {
  const form = document.getElementById("settings-form");
  if (!form.reportValidity()) return;
  const settings = validateSettings(gatherSettings());
  const result = await repository.saveSettings(settings);
  dirty = false;
  await readWorkspace();
  editingSettings = copy(result.settings || data.settings);
  await render(currentRoute);
  toast(config.local ? "配置已保存，前台已更新" : "配置已提交到待发布变更");
}

main.addEventListener("input", (event) => {
  if (event.target.closest("#article-form")) {
    gatherPost();
    markDirty();
    updateCharacterCount();
  }
  if (event.target.closest("#settings-form")) {
    gatherSettings();
    markDirty();
    document.getElementById("settings-preview").innerHTML = settingsPreview(
      editingSettings,
      resolveImage,
      currentRoute.split("/")[1],
    );
    observeMedia();
  }
  if (event.target.id === "post-search") {
    filters.search = event.target.value;
    document.getElementById("post-table").innerHTML = postTable(
      filterPosts(data.posts, filters),
    );
    document.getElementById("post-result-count").textContent =
      `共 ${filterPosts(data.posts, filters).length} 篇内容`;
  }
  if (event.target.id === "media-search") {
    mediaSearch = event.target.value;
    document.getElementById("media-grid").innerHTML = mediaCards(
      data.media.filter((media) =>
        media.name.toLowerCase().includes(mediaSearch.toLowerCase()),
      ),
    );
    observeMedia();
  }
});
main.addEventListener("change", (event) => {
  if (event.target.closest("#settings-form")) {
    gatherSettings();
    markDirty();
    document.getElementById("settings-preview").innerHTML = settingsPreview(
      editingSettings,
      resolveImage,
      currentRoute.split("/")[1],
    );
    observeMedia();
  }
  if (event.target.closest("#article-form")) {
    gatherPost();
    markDirty();
  }
});
main.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || saving) return;
  const action = target.dataset.action;
  const mutation = [
    "save-post",
    "publish-post",
    "save-settings",
    "delete-post",
    "delete-media",
    "publish-release",
    "upload-media",
  ].includes(action);
  if (mutation) {
    setSaving(true);
    target.disabled = true;
  }
  try {
    if (action === "new-post") await go("editor/new");
    else if (action === "go-home") await go("settings/home");
    else if (action === "go-posts") await go("posts");
    else if (action === "edit-post")
      await go(`editor/${target.dataset.slug}/${target.dataset.status}`);
    else if (action === "filter-state") {
      filters.state = target.dataset.state;
      await render("posts");
    } else if (action === "reset-filter") {
      filters = { search: "", state: "all", category: "", tag: "" };
      await render("posts");
    } else if (action === "filter-category") {
      filters = {
        search: "",
        state: "all",
        category: target.dataset.category,
        tag: "",
      };
      await go("posts");
    } else if (action === "filter-tag") {
      filters = {
        search: "",
        state: "all",
        category: "",
        tag: target.dataset.tag,
      };
      await go("posts");
    } else if (action === "editor-mode") await changeMode(target.dataset.mode);
    else if (action === "format") await format(target.dataset.command);
    else if (action === "save-post") await saveArticle();
    else if (action === "publish-post") await saveArticle(true);
    else if (action === "save-settings") await saveConfiguration();
    else if (action === "upload-media") {
      if (await upload()) await render(currentRoute);
    } else if (action === "copy-media") {
      const media = data.media.find(
        (media) => media.name === target.dataset.name,
      );
      await navigator.clipboard.writeText(publicPath(media));
      toast("图片地址已复制");
    } else if (action === "delete-media") {
      const media = data.media.find(
        (media) => media.name === target.dataset.name,
      );
      if (
        await ask(
          "删除这张图片？",
          `<p class="dialog-copy">${e(media.name)}。正在使用的图片会受到保护。</p>`,
          "删除图片",
          true,
        )
      ) {
        await repository.deleteMedia(media);
        await readWorkspace();
        await render(currentRoute);
        toast(config.local ? "图片已删除" : "删除图片的变更已提交");
      }
    } else if (action === "delete-post") {
      const post = data.posts.find(
        (post) =>
          post.slug === target.dataset.slug &&
          post.status === target.dataset.status,
      );
      if (
        await ask(
          post.status === "draft" ? "删除这个草稿？" : "移除这篇已发表文章？",
          `<p class="dialog-copy">${e(post.data.title || "未命名草稿")}。${post.status === "draft" ? "如有已发表版本，会保留前台文章。" : "操作将移除前台内容，请确认没有仍在使用的文章链接。"}</p>`,
          "确认移除",
          true,
        )
      ) {
        await repository.deletePost(post);
        await readWorkspace();
        await render(currentRoute);
        toast(config.local ? "内容已移除" : "移除内容的变更已提交");
      }
    } else if (["pick-cover", "insert-image", "pick-avatar", "pick-about-cover"].includes(action)) {
      const media = await chooseMedia(
        action === "pick-cover"
          ? "选择文章封面"
          : action === "pick-about-cover"
            ? "选择个人简介封面"
          : action === "pick-avatar"
            ? "选择头像"
            : "插入正文图片",
      );
      if (media) {
        const path = publicPath(media);
        if (action === "insert-image") {
          const alt = await ask(
            "图片说明",
            `<form>${field("图片替代文字", "alt", media.name, { hint: "帮助屏幕阅读器和图片加载失败时理解内容。" })}</form>`,
            "插入图片",
          );
          if (alt)
            await insertMarkdown(
              `\n![${String(alt.get("alt")).replace(/[\[\]\n]/g, "")}](${path})\n`,
            );
        } else if (action === "pick-cover") {
          activePost.data.coverImage = path;
          document.querySelector('[name="coverImage"]').value = path;
          document.getElementById("cover-picker").innerHTML =
            `<img src="${e(safeImage(media.url))}" alt="文章封面" />`;
          document.querySelector('[data-action="clear-cover"]').hidden = false;
          markDirty();
        } else {
          const settingPath = action === "pick-about-cover" ? "about.coverImage" : "identity.avatar";
          setPath(editingSettings, settingPath, path);
          document.querySelector(`[name="${settingPath}"]`).value = path;
          document.getElementById("settings-preview").innerHTML =
            settingsPreview(editingSettings, resolveImage, currentRoute.split("/")[1]);
          observeMedia();
          markDirty();
        }
      }
    } else if (action === "clear-cover") {
      activePost.data.coverImage = "";
      document.querySelector('[name="coverImage"]').value = "";
      document.getElementById("cover-picker").innerHTML =
        icon("image") + "<span>从媒体库选择或上传</span>";
      target.hidden = true;
      markDirty();
    } else if (action === "insert-math") {
      const result = await ask(
        "插入数学公式",
        `<form>${field("LaTeX 公式", "formula", "E = mc^2", { type: "textarea", required: true, rows: 4 })}${field(
          "显示方式",
          "mode",
          "block",
          {
            choices: [
              ["block", "独立公式"],
              ["inline", "行内公式"],
            ],
          },
        )}</form>`,
        "插入公式",
      );
      if (result)
        await insertMarkdown(
          result.get("mode") === "inline"
            ? `$${result.get("formula")}$`
            : `\n$$\n${result.get("formula")}\n$$\n`,
        );
    } else if (action === "insert-link") {
      const result = await ask(
        "插入链接",
        `<form>${field("显示文字", "label", "", { required: true })}${field("链接网址", "url", "https://", { required: true, type: "url" })}</form>`,
        "插入链接",
      );
      if (result) {
        const url = String(result.get("url"));
        if (!/^https?:\/\//i.test(url))
          throw new Error("链接需要使用 HTTP 或 HTTPS。");
        await insertMarkdown(
          `[${String(result.get("label")).replace(/[\[\]\n]/g, "")}](${url.replace(/[()\s]/g, (character) => encodeURIComponent(character))})`,
        );
      }
    } else if (action === "restore-recovery") {
      activePost = { ...recovery, revision: activePost.revision };
      const restored = copy(activePost);
      editorGeneration++;
      if (editor) {
        await editor.destroy();
        editor = null;
      }
      main.innerHTML = editorView(
        restored,
        categories,
        config.local,
        resolveImage,
      );
      editorMode = "rich";
      await mountEditor();
      markDirty();
      toast("已恢复编辑内容，请保存草稿");
    } else if (action === "discard-recovery") {
      clearRecovery();
      document.getElementById("recovery-banner").hidden = true;
    } else if (action === "refresh") {
      await readWorkspace();
      await render(currentRoute);
      toast(loadError || "工作区状态已刷新", Boolean(loadError));
    } else if (action === "login") {
      await repository.login();
      await readWorkspace();
      await render(currentRoute);
      if (loadError) throw new Error(loadError);
      toast("GitHub 已连接");
    } else if (action === "logout") {
      repository.logout();
      data = {
        posts: [],
        media: [],
        settings: initialSettings,
        releases: [],
        connection: {},
      };
      await readWorkspace();
      await render(currentRoute);
      toast("已退出登录");
    } else if (action === "publish-release") {
      const release = data.releases.find(
        (release) => String(release.id) === target.dataset.id,
      );
      if (
        await ask(
          "检查并发布这项变更？",
          '<p class="dialog-copy">检查通过后合并到生产分支，Cloudflare 随后构建站点。</p>',
          "检查并发布",
        )
      ) {
        await repository.publishRelease(release);
        await readWorkspace();
        await render(currentRoute);
        toast("变更已合并，请在 Cloudflare 确认部署");
      }
    } else if (action === "select-accent") {
      editingSettings.appearance.accent = target.dataset.accent;
      markDirty();
      await render(currentRoute);
    } else if (
      [
        "add-social",
        "remove-social",
        "add-friend",
        "remove-friend",
        "add-about-tool",
        "remove-about-tool",
        "add-about-system",
        "remove-about-system",
        "move-nav",
      ].includes(action)
    ) {
      gatherSettings();
      const index = Number(target.dataset.index);
      if (action === "add-social")
        editingSettings.identity.socialLinks.push({
          label: "",
          url: "",
          icon: "link",
        });
      if (action === "remove-social")
        editingSettings.identity.socialLinks.splice(index, 1);
      if (action === "add-friend")
        editingSettings.friends.push({
          name: "",
          url: "",
          description: "",
          avatar: "",
        });
      if (action === "remove-friend") editingSettings.friends.splice(index, 1);
      if (action === "add-about-tool" && editingSettings.about.tools.length < 12)
        editingSettings.about.tools.push({ name: "", description: "", icon: "code" });
      if (action === "remove-about-tool") editingSettings.about.tools.splice(index, 1);
      if (action === "add-about-system" && editingSettings.about.operatingSystems.length < 3) {
        const key = ["macos", "windows", "linux"].find(key => !editingSettings.about.operatingSystems.includes(key));
        if (key) editingSettings.about.operatingSystems.push(key);
      }
      if (action === "remove-about-system") editingSettings.about.operatingSystems.splice(index, 1);
      if (action === "move-nav") {
        const next = index + Number(target.dataset.direction);
        if (next >= 0 && next < editingSettings.navigation.length)
          [
            editingSettings.navigation[index],
            editingSettings.navigation[next],
          ] = [
            editingSettings.navigation[next],
            editingSettings.navigation[index],
          ];
      }
      markDirty();
      await render(currentRoute);
    }
  } catch (error) {
    showError(error);
  } finally {
    if (mutation) {
      setSaving(false);
      target.disabled = false;
      if (dirty) {
        document
          .getElementById("editor-save-state")
          ?.replaceChildren(document.createTextNode("有未保存的修改"));
        document
          .getElementById("settings-save-state")
          ?.replaceChildren(document.createTextNode("有未保存的配置"));
      }
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    storeRecovery();
    event.preventDefault();
  }
});
let routeRevision = 0;
window.addEventListener("hashchange", async () => {
  const route = location.hash.replace(/^#\/?/, "") || "overview";
  if (route === currentRoute) return;
  const revision = ++routeRevision;
  if (saving) {
    history.replaceState(null, "", `#/${currentRoute}`);
    return;
  }
  if (
    dirty &&
    !(currentRoute.startsWith("settings/") && route.startsWith("settings/"))
  ) {
    const confirmed = await ask(
      "离开当前工作区？",
      '<p class="dialog-copy">尚有未保存的修改。离开后可从浏览器恢复文章，但站点配置需要重新编辑。</p>',
      "放弃修改",
    );
    if (!confirmed) {
      history.replaceState(null, "", `#/${currentRoute}`);
      return;
    }
    storeRecovery();
    dirty = false;
  }
  if (revision !== routeRevision) return;
  try {
    await render(route);
  } catch (error) {
    showError(error);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "s" &&
    (activePost || editingSettings)
  ) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    (activePost ? saveArticle() : saveConfiguration())
      .catch(showError)
      .finally(() => {
        setSaving(false);
      });
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (currentRoute === "posts")
      document.getElementById("post-search").focus();
    else
      go("posts").then(() =>
        setTimeout(() => document.getElementById("post-search")?.focus(), 0),
      );
  }
});
async function initialize() {
  await readWorkspace();
  try {
    await render(location.hash.replace(/^#\/?/, "") || "overview");
  } catch (error) {
    showError(error);
  }
}
initialize();
