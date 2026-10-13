# HuaOvO

胡敖（Huao）的技术博客与内容管理后台。前台静态部署到 Cloudflare Pages，后台在浏览器管理文章、草稿、媒体和前台配置；生产内容通过 GitHub 分支与 PR 发布。

## 技术栈

- Astro 7、TypeScript、Tailwind CSS 4：静态前台与管理入口。
- Milkdown Crepe 7.22：富文本、Markdown、数学公式、表格和代码编辑，仅进入编辑区后加载。
- remark / rehype、KaTeX：前后台共享安全渲染与文章排版。
- GitHub REST API、Cloudflare OAuth Worker：生产登录、内容版本和发布门禁。
- Node 本地内容服务：仅开发使用，读取和保存当前项目文件。
- Pagefind：构建文章全文索引；Three.js：按前台配置及访客动效偏好加载。

## 本地运行

使用 Node 24（`.nvmrc`）：

```sh
npm ci
npm run dev
```

博客：http://127.0.0.1:4321/ 。管理后台：http://127.0.0.1:4321/admin/ 。开发命令同时启动 Astro 和 `127.0.0.1:8081` 内容服务，无需登录；Ctrl+C 关闭两个服务。本地服务校验来源、路径、文件类型和版本，仅用于当前项目开发。

只运行前台：`npm run dev:site`；单独运行内容服务：`npm run content:local`。

## 后台功能

| 入口 | 操作 |
| --- | --- |
| 内容总览 | 真实文章、草稿、媒体和友链数量，最近文章、常用操作 |
| 文章管理 | 搜索、状态筛选、新建、修订、保存草稿、提交发布、移除内容 |
| 分类与标签 | 已发表文章的分类、标签与系列统计，跳转筛选管理 |
| 媒体资源 | 上传、选择封面与头像、插入正文、复制地址，保护正在引用的图片 |
| 站点设置 | 品牌、作者、头像、简介、网页标题、搜索描述、社交链接 |
| 首页与导航 | 标题、介绍、按钮、公告、首页文章数量、导航顺序和显隐 |
| 外观主题 | 默认明暗模式、四种强调色、前台动态背景 |
| 关于与友链 | 关于页 Markdown 正文、友链名称/网址/简介/头像 |
| 页脚设置 | 页脚文案、备案号和查询链接 |
| 发布与连接 | GitHub 连接、待发布变更、检查并合并、Cloudflare 部署信息 |

文章编辑支持富文本、Markdown 和前台样式预览。`/` 打开插入菜单，工具栏可插入图片、链接和公式，`⌘/Ctrl+S` 保存草稿。数学公式使用 `$...$` 和独立 `$$`。保存保留描述性图片 alt、公式转义和代码围栏。Milkdown 会将 `latex` 语言代码块视作公式并规范化为 `$$`；需要把 LaTeX 当普通代码展示时使用 `text` 语言围栏。

本地保存草稿到 `src/content/drafts/`，不会替换已发表文章。点击发布才写入 `src/content/posts/`。未保存文章提供浏览器恢复，离开有提醒；冲突会要求刷新，避免覆盖其他窗口修改。日期仅用于显示和排序，不提供定时发布。

前台配置唯一数据源是 `src/data/site.json`。本地保存后前台自动更新；生产保存创建待发布变更。访客自行选择的主题优先于站点默认主题。五个分类保持固定，以免修改分类名字使历史文章失效。

## 生产发布流程

1. 用 GitHub 登录后台，账号需要仓库内容写入和 PR 合并权限。
2. 保存文章建立草稿分支；提交发布把变更加入审核队列。配置和媒体使用各自的变更分支。
3. 在“发布与连接”点击“检查并发布”：校验当前版本及所有检查，通过后合并到 `main`；主分支保护继续生效。
4. Cloudflare 从合并提交构建。**已合并表示仓库已更新，实际部署成功与日志在 Cloudflare 控制台确认。**

上传的待发布图片会进入引用它的内容变更；发布前检查图片存在。生产鉴权凭据只保留在浏览器会话中，退出登录清除；OAuth Client Secret 只存 Worker Secret。

手工导入文章时使用 Markdown YAML 元数据；`src/content/posts/` 中的 `draft: true` 会被生产构建拒绝。使用后台会将草稿保存在独立目录，生产构建不会收录它们。

## Cloudflare Pages 与 GitHub

当前站点已上线到 [aoblog.eu.cc](https://aoblog.eu.cc/)，后台地址为 [aoblog.eu.cc/admin/](https://aoblog.eu.cc/admin/)。本人还需完成 GitHub 自动部署授权及 OAuth 密钥填写，步骤见 [上线操作清单](docs/上线操作清单.md)，完整配置与域名迁移说明见 [部署配置](docs/DEPLOYMENT.md)。

推送到 GitHub 并连接 Pages 项目：

| 设置 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 构建命令 | `npm run check && npm test && npm run build` |
| 输出目录 | `dist` |
| Node 环境变量 | `NODE_VERSION=24` |

生产环境公开配置（参见 `.env.example`）：

```text
SITE_URL=https://实际正式域名
CMS_REPO=GitHub用户名/仓库名
CMS_AUTH_URL=https://实际OAuthWorker地址
```

缺少配置时前台仍可构建，后台明确显示待配置状态。公开地址由 `src/config/admin.ts` 注入后台，不含任何 Secret。创建 OAuth App、精确站点白名单与部署 Worker 的说明见 `worker/README.md`。

对 `main` 开启分支保护，至少要求 `Type Check & Production Build` 检查成功；后台还会检查现有检查是否完成。CI 校验内容和类型并构建搜索索引。生产不要设置 `SHOW_DRAFTS=true`；需要保密的分支预览同时使用私有仓库与 Cloudflare Access。

## 验证与维护

```sh
npm test
npm run check
npm run build
npm run preview
```

构建产物预览：http://127.0.0.1:4323/ 。测试涵盖实际文件草稿/发布、配置冲突、图片引用保护、上传限制、GitHub 分支与 PR、检查门禁、OAuth、Markdown 安全和编辑器内容往返。真实 GitHub / Cloudflare 账号尚需上线联调。

后台样式：`src/styles/console.css`；共享主题：`src/styles/tokens.css`；正文排版：`src/styles/prose.css`；文章：`src/content/posts/`；草稿：`src/content/drafts/`；图片：`public/images/posts/`。管理入口无索引，生产前台不依赖 Node 服务、数据库或 SSR。

现有示例文章用于展示排版，可替换为自己的内容。后台重设计和验收记录见 `docs/ADMIN_CONSOLE.md`。
