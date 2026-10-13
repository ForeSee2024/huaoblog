import {
  LayoutDashboard,
  FileText,
  Tags,
  Image,
  Settings2,
  House,
  Palette,
  Globe,
  CloudUpload,
  Sun,
  Moon,
  Plus,
  ArrowUpRight,
  Search,
  Menu,
  X,
  Check,
  ArrowLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Copy,
  Upload,
  FolderOpen,
  BookOpen,
  Clock,
  Save,
  Eye,
  Code2,
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Sigma,
  Link,
  RefreshCw,
  Info,
  GitBranch,
  LogOut,
  CircleAlert,
  ExternalLink,
} from "lucide";
const icons = {
  overview: LayoutDashboard,
  posts: FileText,
  tags: Tags,
  image: Image,
  settings: Settings2,
  home: House,
  palette: Palette,
  globe: Globe,
  cloud: CloudUpload,
  sun: Sun,
  moon: Moon,
  plus: Plus,
  external: ArrowUpRight,
  search: Search,
  menu: Menu,
  close: X,
  check: Check,
  back: ArrowLeft,
  chevron: ChevronRight,
  edit: Pencil,
  delete: Trash2,
  copy: Copy,
  upload: Upload,
  folder: FolderOpen,
  book: BookOpen,
  clock: Clock,
  save: Save,
  eye: Eye,
  code: Code2,
  bold: Bold,
  italic: Italic,
  heading: Heading2,
  list: List,
  ordered: ListOrdered,
  quote: Quote,
  math: Sigma,
  link: Link,
  refresh: RefreshCw,
  info: Info,
  github: GitBranch,
  logout: LogOut,
  alert: CircleAlert,
  open: ExternalLink,
};
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export function icon(name, className = "") {
  const nodes = icons[name] || icons.posts;
  return `<svg class="icon ${escape(className)}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${nodes
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([key, value]) => `${key}="${escape(value)}"`)
          .join(" ")}></${tag}>`,
    )
    .join("")}</svg>`;
}
export const button = (
  label,
  action,
  glyph = "",
  kind = "secondary",
  extra = "",
) =>
  `<button type="button" class="button ${kind}" data-action="${escape(action)}" ${extra}>${glyph ? icon(glyph) : ""}${escape(label)}</button>`;
export const empty = (title, copy, action = "", label = "", glyph = "posts") =>
  `<div class="empty-state">${icon(glyph)}<h2>${escape(title)}</h2><p>${escape(copy)}</p>${action ? button(label, action, "plus", "primary") : ""}</div>`;
export const status = (post) =>
  `<span class="badge ${post.status === "published" ? "published" : "draft"}"><span></span>${post.status === "published" ? "已发表" : "草稿"}</span>`;
export const date = (value) => String(value || "").slice(0, 10) || "未设置日期";
export const size = (value) =>
  value > 1048576
    ? `${(value / 1048576).toFixed(1)} MB`
    : `${Math.ceil((value || 0) / 1024)} KB`;
export function field(label, name, value = "", options = {}) {
  const id = `field-${name.replaceAll(".", "-")}`;
  const common = `id="${id}" name="${escape(name)}" ${options.required ? "required" : ""} ${options.disabled ? "disabled" : ""} ${options.max ? `maxlength="${options.max}"` : ""} ${options.min ? `min="${options.min}"` : ""} ${options.maxValue ? `max="${options.maxValue}"` : ""} ${options.placeholder ? `placeholder="${escape(options.placeholder)}"` : ""}`;
  let control;
  if (options.type === "textarea")
    control = `<textarea ${common} rows="${options.rows || 3}">${escape(value)}</textarea>`;
  else if (options.choices)
    control = `<select ${common}>${options.choices
      .map((choice) => {
        const [key, title] = Array.isArray(choice) ? choice : [choice, choice];
        return `<option value="${escape(key)}" ${key === value ? "selected" : ""}>${escape(title)}</option>`;
      })
      .join("")}</select>`;
  else
    control = `<input ${common} type="${options.type || "text"}" value="${escape(value)}" ${options.pattern ? `pattern="${escape(options.pattern)}"` : ""} />`;
  return `<div class="field ${options.wide ? "field-wide" : ""}"><label for="${id}">${escape(label)}${options.required ? '<span class="required-dot">*</span>' : ""}</label>${control}${options.hint ? `<p class="field-hint">${escape(options.hint)}</p>` : ""}</div>`;
}
export const toggle = (label, name, value, hint = "") =>
  `<label class="toggle-row"><span><strong>${escape(label)}</strong>${hint ? `<small>${escape(hint)}</small>` : ""}</span><input type="checkbox" name="${escape(name)}" ${value ? "checked" : ""} /><span class="toggle-track" aria-hidden="true"></span></label>`;
export function section(title, description, content, id = "") {
  return `<section class="settings-section" ${id ? `id="${id}"` : ""}><div class="section-heading"><h2>${escape(title)}</h2>${description ? `<p>${escape(description)}</p>` : ""}</div>${content}</section>`;
}
export function notice(text, kind = "info") {
  return `<div class="notice ${kind}">${icon(kind === "error" ? "alert" : "info")}<p>${escape(text)}</p></div>`;
}
export function safeImage(value) {
  const string = String(value || "");
  return /^(\/[^/]|https?:\/\/|blob:|data:image\/(png|jpeg|gif|webp|avif);base64,)/i.test(
    string,
  )
    ? string
    : "";
}
