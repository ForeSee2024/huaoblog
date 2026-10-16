# 可迁移内容服务实施计划

> 使用 subagent-driven-development 实现独立模块并逐项复核；部署与切换由主代理顺序执行。

**Goal:** 网页后台直接读写 Cloudflare 内容存储，并可用同一业务代码在 Node.js / SQLite / 文件存储运行。

**Architecture:** 保留 Astro 页面和现有编辑器，抽出内容仓库、HTTP 接口及平台存储适配。页面按请求读取数据库，程序发布继续受 GitHub 检查保护。正式切换前验证数据迁移、备份回读及 Node 运行。

**Tech Stack:** Astro 7、官方 Cloudflare 14 / Node 11 适配器、JavaScript 服务、SQLite 兼容 SQL、D1、R2、Node 内置 SQLite、node:test。

## 1. 基线及契约

- [x] 独立工作区基于最新 origin/main `30919b45c3b7e0f2e7d8dc22a22367075c5ef249`，运行 `npm ci`、`npm test` 核对基线。
- [x] 提交设计与计划，模块按设计中端口和实体协议实现；确认 main 的真实已发表文章、图片以及 PR 5 / 15 的未发布内容均纳入迁移。

## 2. 内容与存储

**Files:** `src/server/storage/{content-store,sqlite,d1,filesystem,r2}.js`、`migrations/001_content.sql`、`tests/content-store.test.mjs`、`tests/blob-store.test.mjs`。

- [x] 用 Node SQLite 编写失败用例：旧版本写入返回 409，保存草稿保留公开版本，软删除可恢复，引用图片删除被拒绝，未发布配置不公开，导出导入哈希一致。
- [x] 执行 `node --test tests/content-store.test.mjs tests/blob-store.test.mjs` 确认实现缺失失败，再实现共享 SQL 仓库及 D1 / Node、R2 / 文件适配。
- [x] 将同一仓库契约在两个 SQL 适配上执行；历史写入和乐观锁在事务内完成，文件路径拒绝遍历及符号链接逃逸。
- [x] 独立规范和质量复核通过后提交该模块。

## 3. HTTP 与会话

**Files:** `src/server/{api,auth,body,backup,runtime-node,runtime-cloudflare}.js`、`src/pages/api/v1/[...path].ts`、`migrations/002_sessions.sql`、`tests/content-api.test.mjs`。

- [x] 编写未授权、跨源、超限正文、冒充管理员、失效会话及公开草稿访问的失败测试；实现注入式 Request/Response 服务。
- [x] GitHub 登录只换取本站会话，后续读写不依赖 GitHub；写入先验证请求，再验证实体与预期 revision，返回确认后的工作区。
- [x] 上传使用受限流读取，校验类型和文件头；对象地址稳定，草稿媒体受会话保护。实现回收站、历史、备份预检与安全导出。
- [x] 执行 `node --test tests/content-api.test.mjs`，确认公开和管理接口安全边界及错误语义。

## 4. Astro 动态前台和部署目标

**Files:** `astro.config.mjs`、`src/middleware.ts`、`src/env.d.ts`、`src/utils/posts.ts`、现有页面与布局组件、`src/components/common/SearchModal.astro`。

- [x] 配置 `DEPLOY_TARGET=node|cloudflare`，用官方适配器构建，同一请求内容上下文通过平台运行时注入。
- [x] 将首页、列表、归档、关于、友链、文章详情、标题/主题/导航等读取改为数据库公开版本；文章详情不使用静态 getStaticPaths，保留日期策略及原地址。
- [x] 搜索通过公开查询 API；动态页面缓存策略保证发布后可见，静态资源仍可缓存。Markdown 使用现有安全渲染链，支持公式、代码和目录。
- [x] 分别执行 `npm run check`、`npm run build:node`、`npm run build:cloudflare`；Node 独立服务重启后数据仍存在。

## 5. 后台直接操作

**Files:** `src/admin/http-repository.js`、`src/admin/console.js`、`src/admin/views.js`、`src/config/admin.ts`、后台新增回收站/历史/备份视图与相关测试。

- [x] 创建 HTTP 仓库契约测试；接入 session、工作区、按需正文、草稿保存/发布、配置发布、媒体和批量删除。
- [x] 数据库模式移除日常 PR/等待构建的文案和步骤；显示真实的保存/发布/删除结果，并保留重试、冲突和批量失败选择。
- [x] 提供回收站恢复、文章历史查看/恢复、备份导出入口。保留现有图标选择器与预览，整个后台风格一致。
- [x] 临时 SQLite / 文件目录中实测保存、刷新、重启、发布、批量删除及恢复；前台即时读取新结果。

## 6. 迁移与平台配置

**Files:** `scripts/{export-github-content,import-content,backup-content}.mjs`、`wrangler.jsonc`、`deploy/{Dockerfile,compose.yaml}`、`docs/{CONTENT_STORAGE,SELF_HOSTING,MIGRATION}.md`。

- [x] 从固定 Git 提交与 PR 头导出迁移包；媒体去重以哈希验证，保留公开/草稿/未发布配置状态。生成数量与 SHA-256 核对结果。
- [x] 创建空的 D1 和专用 R2 桶；R2 开通由用户完成。应用迁移、导入、导出回读比对后启动预览，不在非空正式库强制覆盖。
- [x] 提供 Node / Docker 数据卷、环境变量、数据库迁移、备份导出及恢复的完整操作说明，实测标准包能迁到本地服务器。

## 7. 复核、部署与交付

- [x] 完整 `npm test`、类型检查、两个正式构建、实际浏览器流程和独立规范/质量复核。
- [ ] 推送 PR、附加本任务，必需检查通过后合并；预览应用真实验证 GitHub 登录、文章、图片、设置、搜索及回收站/备份。
- [ ] 核对最新数据没有变化再迁入，切换主域名到新 Worker，保留旧 Pages 与 Git 历史回退。
- [ ] 核对线上内容、写入、图片地址、HTTPS、跳转、明暗主题与手机布局；保存截图、更新用户操作文件并清理临时服务。
