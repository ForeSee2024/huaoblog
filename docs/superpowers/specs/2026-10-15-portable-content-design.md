# 可迁移的博客内容服务

## 已确认的目标

Huao 使用网页后台写文章、上传图片和修改前台配置，保存、发布、删除直接更新数据，不经过 GitHub PR 或整站构建。Cloudflare 是当前部署环境，以后可以迁往自己的服务器。保持现有前后台设计、编辑器、图标目录和文章地址。以免费套餐优先，不代为升级套餐；R2 尚未开通，正式图片迁移需等用户完成开通。

## 选择

采用 Astro 服务端渲染 + 独立内容服务 + 存储适配器。Cloudflare 使用 Workers / D1 / R2，自有服务器使用 Node.js / SQLite / 文件目录。相比另建一个前端与后端应用，该方案复用现有页面、样式及编辑器，减少两套构建与接口代理；相比原有 Git 静态方案，日常内容修改不进入程序发布流程。

当前官方 Astro Cloudflare 适配器已不支持 Pages，因此新的动态应用部署为独立 Worker；旧 Pages 保留回退。先验证新应用，再切换 huaoblog.cn，保留 www 与旧域名跳转。

## 模块边界

- `src/server/storage/`：SQLite 兼容 SQL 内容仓库、迁移文件、D1 和 Node SQLite 适配、R2 和本地文件适配。只处理持久化与乐观锁；不依赖 Astro、HTTP 请求或登录界面。
- `src/server/`：HTTP API、会话与管理员权限、媒体上传与引用保护、备份恢复、平台运行时工厂。服务依赖显式注入；不使用可变的全局请求状态。
- `src/middleware.ts`、页面和布局：每个请求读取已发布配置和内容；后台请求通过同源 API 读写。静态资源继续缓存，动态 HTML 与工作区响应避免旧缓存。
- `src/admin/http-repository.js`：把现有编辑器和管理交互连接到内容 API；Git 仓库适配仅供旧模式与迁移使用。编辑文章按需读取正文，列表只取元数据。
- `scripts/`、`deploy/`：导出旧 Git 内容、完整备份与导入、Cloudflare 和 Node 部署及恢复操作。平台信息和密钥均从配置注入。

## 存储协议

数据库端口为异步 `all(sql, params = []) -> rows`、`batch([{sql, params}]) -> [{changes, results?}]`、`exec(sql)`。D1 与 Node SQLite 使用相同 SQL 和契约测试。

`createContentStore(database, {now?, uuid?})` 提供：

- `getPublishedSettings()`、`getWorkspace()`、`getPublishedPosts()`、`getPost(slug, status)`；工作区文章只有元数据及 `bodyLoaded:false`，`getPost` 返回完整正文。
- `savePost(post, {publish, actor?})`、`deletePosts(items, {actor?})`、`saveSettings(settings, {actor?})`。
- `addMedia(record)`、`getMedia(name, {includeDeleted?})`、`deleteMedia(items, {actor?})`。
- `getTrash()`、`restorePost(item, {actor?})`、`restoreMedia(item, {actor?})`、`getHistory(kind, id)`、`restoreRevision(kind, id, revision, expectedRevision, {actor?})`。
- `exportSnapshot()`、`importSnapshot(snapshot, {onlyIfEmpty:true})`。导出有 `format:'huaovo-content'`、`formatVersion:1`，包含当前配置、未发布配置、文章公开与草稿版本、回收站、媒体元数据和历史版本；不包含登录凭据与会话。

写入返回确认后的实体；HTTP 层补充新的 `state`，兼容原后台。批量删除返回 `deleted`、`failed`，冲突项保留，不误报整批成功。引用保护在删除前检查文章公开版本、草稿、公开配置及迁入的未发布配置。

文章以 slug 为聚合：已发表和草稿分别保存，聚合共享不透明 `revision`。写草稿保留已发表版本，发布时更新公开版本并撤回该草稿。每次更新携带预期版本，数据库原子核对并记录旧版本，冲突返回 409。设置保存直接发布；迁入的旧未发布设置单独保留，在用户点击保存发布前不影响前台。

媒体使用与供应商无关的对象键和 `/images/posts/<name>` 地址。R2 桶保持私有，由服务按媒体状态响应。上传内容先作为管理者可访问的媒体，文章或设置发布时公开所引用的媒体；迁入的既有公开图片保持可访问。删除先进入回收站，不直接清除对象；仍被引用的图片不能删除。

## HTTP 与登录

API 版本前缀 `/api/v1/`，错误响应 `{error, code}`，成功响应 JSON；工作区端点验证管理员会话。写操作要求精确同源 Origin，查询参数和正文大小有上限。

后台复用现有 GitHub 登录网关。登录后将 GitHub 身份换成本站 HttpOnly、Secure、SameSite 会话，仅允许用户 ID `160737293`；GitHub 令牌不持久化到新数据库、不进入日志或备份。数据库只保存随机会话令牌的哈希。Node 部署可使用同一登录网关，也提供网关源码与后续迁移配置说明。

端点包括会话、工作区、文章正文、草稿保存/发布、批量删除、设置发布、媒体上传/访问、回收站恢复、历史版本恢复、导出与恢复预检。公开端点只暴露已发布内容及公开图片，搜索在数据库执行，不再依赖构建期 Pagefind。

## 迁移与运维

迁移开始前读取最新 main 和仍打开的后台 PR。当前 main 已包含用户自己的 `blog开局-杂谈建站`，必须保留其已发表状态；旧 7 篇初稿保持删除。未发布图片与设置保持未发布状态，不能因迁移自动公开。

迁移包使用 UTF-8 Markdown、JSON、普通图片文件和 SHA-256 清单，可导入 SQLite / 本地文件，也可导入 D1 / R2。导入默认仅允许空库，预检数量、路径、内容和图片哈希；失败不能切换正式流量。已有 Git 历史与 Pages 保留，确认后才停用旧写入入口。程序部署与数据写入分离，日常内容 API 不需要 GitHub 写入或合并。

采用递增数据库迁移与备份格式版本，升级前备份，未知更高版本拒绝导入。后台提供回收站、历史版本和备份导出；定时备份只处理内容与媒体，不保存会话。备份操作有完成/失败记录，恢复经过预检，不能把有内容的正式库静默覆盖。

## 验收

同一内容服务测试在 Node SQLite 和 D1 本地运行时通过：草稿不公开、发布/修改/删除立即反映到前台、版本冲突不会覆盖、图片引用保护、回收站和历史恢复、未授权/跨源请求拒绝、备份导出再导入内容与媒体哈希一致。

Node 正式构建能独立运行并持久保存文章、设置和图片；Cloudflare Worker 构建及真实绑定验收通过。以预览应用验证登录、写文、图片、配置、搜索、手机及明暗主题后切换域名。切换后再次验证，不把预览或本地通过等同正式上线。

实现只包含当前单人博客所需边界，不预建多租户、插件市场或微服务。现有页面与编辑器继续使用，服务与适配器有明确测试与维护文档。
