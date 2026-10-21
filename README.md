# HuaOvO

胡敖（Huao）的个人博客与内容管理后台。文章、图片和前台配置直接保存到内容服务，发布与删除无需 GitHub PR 或重新构建。

## 运行与存储

| 部署方式 | 网页与接口 | 内容数据库 | 图片与备份 |
| --- | --- | --- | --- |
| 当前 Cloudflare 部署 | Astro + Workers | D1 | 私有 R2，通过应用检查访问权限 |
| 自有服务器 | Astro Node standalone | SQLite | 独立持久目录 |

业务代码共用存储接口；部署相关逻辑位于各自的适配器。完整 TAR 备份包含 Markdown、公开及待发布配置、媒体原文件、历史、删除状态和 SHA-256 清单，可在两种部署之间恢复。GitHub 保存程序源码并提供管理员身份验证，日常写作不写仓库。

前端使用 Astro 7、TypeScript、Tailwind CSS 4；写作使用按需加载的 Milkdown Crepe，支持富文本、Markdown、表格、代码与 KaTeX 公式。正文在服务器通过统一的安全渲染流程生成，搜索只返回已发表内容。

## 本地开发

使用 Node.js 24（`.nvmrc`）：

```sh
npm ci
npm run dev
```

博客：<http://127.0.0.1:4321/>；后台：<http://127.0.0.1:4321/admin/>。开发命令只监听本机，使用 SQLite 和文件对象目录；本机开发免登录不会在 Cloudflare 或正式域名生效。空数据库需要先导入内容备份；构建不会自动发布 Git 中的旧文章。

```sh
npm run content:import -- --archive /absolute/path/backup.tar --data-dir .local/runtime
```

正式 Node 启动与数据目录设置见 [自有服务器部署](docs/SELF_HOSTING.md)。

## 后台能力

- 内容总览、文章列表、富文本与 Markdown 编辑、草稿、发布、批量删除。
- 媒体上传、封面与头像选择、正文插图、引用保护。
- 品牌、作者、首页、导航、主题、关于页、友链与页脚配置。
- 关于页内置 16 种系统、116 种常用技能与应用，搜索并直接点选图标。
- 内容版本检查、历史恢复、回收站、完整备份导出与校验。

草稿仅管理员可见。点击发布或保存前台配置后，新请求直接读取已提交内容；已打开页面需要刷新。删除为软删除，可从回收站恢复。文章日期仅用于显示和排序，不是定时发布。

后台登录使用 GitHub 身份交换与本站 HttpOnly Cookie。只允许配置的管理员 GitHub 用户 ID；GitHub Token 不写入数据库、浏览器存储或内容备份。新后台登录只请求 `read:user`，不再需要仓库写权限。

## 验证

```sh
npm test
npm run check
npm run test:node
npm run build:cloudflare
HUAOVO_TEST_BINDINGS=1 node --test tests/content-store.test.mjs tests/blob-store.test.mjs tests/storage-review.test.mjs
```

普通测试覆盖内容服务、权限、版本冲突、前台渲染、编辑器和归档恢复；Node 集成测试构建并启动真实服务，验证发布、隐私、删除、重启持久化及媒体静态绕过；绑定测试通过本地 workerd 验证 D1/R2 适配器。两种构建共用 `dist/`，不要并行运行构建命令。

## 使用与维护

- [使用操作文件](docs/上线操作清单.md)：日常写作、配置、图标选择、删除恢复和备份。
- [内容修改指南](docs/CONTENT_GUIDE.md)：具体配置入口和内容规则。
- [Cloudflare 部署](docs/DEPLOYMENT.md)：资源、迁移、域名切换和回退。
- [迁移与备份](docs/MIGRATION.md)：从 Git 导出、恢复到空库、往返校验。
- [自有服务器](docs/SELF_HOSTING.md)：Node、Docker、持久数据、独立 OAuth 网关。

早期静态 Pages/Git PR 方案作为历史资料保留；当前架构以以上文档及 `docs/superpowers/specs/2026-10-15-portable-content-design.md` 为准。
