# Cloudflare 部署与维护

正式域名 `https://huaoblog.cn`，仓库 `ForeSee2024/huaoblog`。当前内容服务采用 Astro Workers、D1 与私有 R2；Node/SQLite/文件系统部署见 [SELF_HOSTING.md](SELF_HOSTING.md)。

## 当前资源

| 项目 | 值 |
| --- | --- |
| Cloudflare account | `fc3766c02d25569ab3a3eb4d0cd6ae79` |
| huaoblog.cn Zone | `05ef7816672cffdaa46ed408e52c89a3` |
| 内容 Worker | `huaoblog-app` |
| 预览地址 | `https://huaoblog-app.huaoqaq.workers.dev` |
| D1 数据库 | `huaoblog-content` |
| D1 ID | `946ed025-a3b9-4440-a775-2f2b2413cea5` |
| 私有 R2 | `huaoblog-media` |
| 绑定 | `DB`、`MEDIA`、`ASSETS` |
| 管理员 GitHub ID | `160737293` |
| 登录网关 | `huaoblog-oauth.huaoqaq.workers.dev` |

`wrangler.jsonc` 保存部署名称、资源绑定、公开环境变量和每日备份 Cron。R2 保持私有，不能开放为公共图片桶；媒体公开状态由应用检查。OAuth Secret 只保留在独立网关，不写 Git、博客变量或内容包。

域名注册与续费在阿里云，DNS 托管在 Cloudflare。NS 为 `algin.ns.cloudflare.com`、`emely.ns.cloudflare.com`。根域名与 www 原有 CNAME 指向 `huaoblog.pages.dev` 并开启代理，保留 Pages 作为回退来源。正式切换使用区域 Worker Route `huaoblog.cn/*` 指向 `huaoblog-app`；路由由区域 API 管理，维护代码时不要无意删除。www 和旧域名继续通过既有 Redirect Rules 跳转主域名并保留路径、查询参数。

## 程序升级

程序源码仍走 GitHub CI 与主分支保护。日常文章、媒体和配置直接写内容服务，与程序构建分离。

```sh
npm ci
npm run check
npm test
npm run test:node
npm run build:cloudflare
npx wrangler d1 migrations apply huaoblog-content --remote
npx wrangler deploy
```

首次数据库恢复必须先完成迁移，确认空库，再导入完整归档。常规代码升级只应用新增数据库迁移，不能重新导入首次迁移包。Wrangler 使用已授权的官方登录；缺少本次无关的默认权限警告不代表要扩大权限。

两种构建共用 `dist/`，不可并行构建。Cloudflare 构建不再产出 Pages 静态站点；合并本次迁移代码前必须关闭旧 Pages 的生产自动部署和分支预览，保留当前可用版本供回退。后续 Worker 程序升级使用上述命令；推送 Git 仅触发质量检查，不代表 Worker 已更新。

CI 必需检查仍为 `Type Check & Production Build`，保留禁止强推与删除。不要为内容发布解除分支保护。

## 登录

GitHub OAuth App：`HuaOvO Blog Admin`，Homepage `https://huaoblog.cn/admin/`，Callback `https://huaoblog-oauth.huaoqaq.workers.dev/callback`。网关精确允许生产、www、旧 Pages 与新预览 Origin。

新后台通过 `identity=1` 请求 `read:user`，服务端核验管理员 ID 后签发 7 天的本站 HttpOnly、Secure、SameSite=Lax Cookie；Token 不保存。旧版后台曾申请 `repo`，历史授权不会自动撤回；需要收紧时可在 GitHub 设置中撤销旧授权，再从新版重新登录。撤销授权属于可选账户操作，不是日常写作步骤。

## 内容备份与迁移

每日 UTC 03:00（北京时间 11:00）Cron 流式生成 TAR 到 R2 `backups/日期/UUID.tar`，使用分段上传。`backup_runs` 记录成功或失败；仅保留最近 7 份成功备份。备份含文章、待发布内容、配置、图片、历史和 SHA-256 清单，不含会话或 OAuth Secret。

可在后台下载完整归档，或从 R2 保存成功归档到异地。R2 同账户备份不能替代异机副本。恢复仅允许空内容库，并先进行路径、校验和、引用及目标容量预检；数据变大后应按 [MIGRATION.md](MIGRATION.md) 使用命令行和新的目标库。迁往 Node 后需自行设置服务器定时备份。

## 域名切换与回退

首次正式切换前完成：源提交与待发布分支重新核对、完整归档保留、预览真实登录、草稿隐私、发布/删除/恢复、图片和配置验证。然后添加生产 Worker Route，核验 HTTPS、首页、文章、搜索、后台和 www 跳转。验收失败保留 Pages 流量，不覆盖正式内容。

紧急回退可移除 `huaoblog.cn/*` Worker Route，恢复原 Pages 页面。旧 Pages 只含切换前内容，**不会包含新内容服务后续写入**；回退前先导出当前数据库。继续维护程序时优先修复并重新部署 Worker，不把旧静态内容当作新数据库恢复来源。

更换域名时准备 DNS/TLS/Worker Route，更新 `SITE_URL`、允许域名、网关白名单与 GitHub Homepage，重新构建并验证；数据库和 R2 无需迁移。完全离开 Cloudflare 还需要 Node 登录网关及 Callback 更新，见自有服务器文档。
