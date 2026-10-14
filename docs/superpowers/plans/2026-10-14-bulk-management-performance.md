# 批量管理与后台响应优化实施计划

> 执行方式：在独立工作区内按 executing-plans 顺序实施，逐项验证。

**Goal:** 支持文章、草稿和媒体批量删除，减少后台同步及修改的重复请求。

**Architecture:** GitHub 仍为内容存储。按提交版本缓存不可变快照，修改直接返回新工作区状态，批量删除使用 Git tree 原子提交；本地服务实现相同接口。原生复选框和现有对话框保持主题一致。

**Tech Stack:** Astro、JavaScript、Node HTTP、GitHub REST、node:test、原有 CSS。

## 1. 请求与安全回归

- [x] 在 `tests/repository.test.mjs` 先加入同步缓存、并发同步、写入请求预算和返回完整状态的失败测试。
- [x] 加入多文章一次提交、过期版本整批拒绝、草稿撤回、图片引用保护、部分失败和发布范围测试。
- [x] 运行 `node --test tests/repository.test.mjs`，确认新功能及性能预算测试失败。

## 2. 仓库同步与修改

- [x] 修改 `src/admin/repository.js`：快照按 head SHA 缓存，PR 文件按 head/base 版本缓存；容量上限 32，读取失败移除缓存。
- [x] 拆分 `loadState()` 的读取与状态组装；同一轮并发同步共享任务，但修改之前仍检查最新版本。
- [x] `writeChanges()` 返回更新后的 workspace，复用新文本，省去名称探测和不必要的 PR 元数据 PATCH。
- [x] 保存、配置、上传、删除返回 `{ state, ...result }`，发布验证和检查读取并行；合并后读取实际合并提交。

## 3. 批量删除

- [x] 创建 `src/admin/bulk-model.js`：验证 1—100 个不重复的文章版本或媒体标识。
- [x] 提供 `deletePosts(posts)` 与 `deleteMediaBatch(media)`；单项接口复用同样的检查。
- [x] 批量已发表内容统一提交，草稿 PR 撤回并返回成功及失败项；媒体引用与版本在写入前全部验证。
- [x] 本地 `scripts/content-server.mjs` 增加 `/api/posts/delete` 和 `/api/media/delete`，返回完整操作状态和明确的部分失败结果。
- [x] 扩展本地服务测试，验证任一无效选择不会提前删除其他内容。
- [x] 独立复核后补充响应中断的实际状态确认，新增 5 项回归避免已成功操作误报失败。

## 4. 后台交互

- [x] 更新 `src/admin/views.js` 与 `src/admin/console.js`，复用现有筛选模型：独立版本选择、当前结果全选、筛选后清空、批量确认、处理结果和待删除状态。
- [x] 保存后使用返回的 state，减少额外刷新；刷新与登录操作加入重复操作保护。
- [x] 复用现有提示区域并更新 `src/styles/console.css`：可访问的阶段提示、选择样式及窄屏布局，复用原有颜色和对话框。

## 5. 验证与发布

- [x] 运行 `npm test`（83 项通过）、`npm run check`（58 个文件零诊断）、新域名环境下的 `npm run build`（13 页及 7 篇索引）和 `git diff --check`。
- [x] 在临时内容目录，通过浏览器验证多选、筛选、取消确认、批量删除与引用拒绝；检查明暗模式及窄屏布局。
- [x] 更新 `docs/上线操作清单.md` 的批量操作说明与实际测试数量。

线上交付按以下步骤执行，验收证据保存在对应 GitHub PR、Cloudflare 部署记录与任务最终交付中：

- 推送功能分支、创建 PR、通过必需检查后合并，等待 Cloudflare 正式部署成功。
- 检查实际生产界面，保存截图，同步主工作区并清理已完成的工作区。
