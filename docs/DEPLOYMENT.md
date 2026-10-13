# HuaOvO 部署配置

当前站点：`https://aoblog.eu.cc`；仓库：`ForeSee2024/huaoblog`；生产分支：`main`。

Cloudflare account：`fc3766c02d25569ab3a3eb4d0cd6ae79`；当前域名 Zone：`7a77b554760b6f0a7178056c8224322e`。

## 检查与已修复

- GitHub 两次 CI 失败的原因是测试使用 macOS 专用 `/private/tmp`；已改为 Node 系统临时目录，60 项测试、类型检查和生产构建通过。
- 当前域名仍属于旧 Pages 项目 `webblog`，源仓库是 `ForeSee2024/webBlog`，不是新仓库。旧站先保留，待新站构建成功后再转移域名。
- 新 Pages 项目 `huaoblog` 已创建，默认域名 `huaoblog.pages.dev`，构建命令及四项公开环境变量已配置。GitHub 集成仍被 Cloudflare 的 `8000011` Git 安装内部异常阻断，需要重新连接 Cloudflare Workers and Pages GitHub App。该项目尚无生产部署。
- Worker `huaoblog-oauth` 已部署，域名 `https://huaoblog-oauth.huaoqaq.workers.dev` 与博客域名独立。后台密钥还需配置。

## 新 Pages 项目

连接仓库 `ForeSee2024/huaoblog`，使用以下配置：

| 设置 | 值 |
| --- | --- |
| 项目名称 | `huaoblog` |
| 生产分支 | `main` |
| 构建命令 | `npm run check && npm test && npm run build` |
| 输出目录 | `dist` |
| 根目录 | 仓库根目录 |
| `NODE_VERSION` | `24` |
| `SITE_URL` | `https://aoblog.eu.cc` |
| `CMS_REPO` | `ForeSee2024/huaoblog` |
| `CMS_AUTH_URL` | `https://huaoblog-oauth.huaoqaq.workers.dev` |

新项目实际默认域名为 `huaoblog.pages.dev`，已在 Worker 的精确来源白名单中。构建成功且页面验证通过后，将 `aoblog.eu.cc` 和 `www.aoblog.eu.cc` 的自定义域名绑定迁移到新项目，并更新两个 CNAME 到 `huaoblog.pages.dev`。仅改 DNS 不等于完成 Pages 自定义域名绑定。

## GitHub OAuth App

[创建入口](https://github.com/settings/applications/new)：

- Application name：`HuaOvO Blog Admin`
- Homepage URL：`https://aoblog.eu.cc/admin/`
- Authorization callback URL：`https://huaoblog-oauth.huaoqaq.workers.dev/callback`

在 Cloudflare Worker `huaoblog-oauth` 的 Variables and Secrets 中添加：

- `GITHUB_CLIENT_ID`：OAuth App 的 Client ID，类型 Secret。
- `GITHUB_CLIENT_SECRET`：OAuth App 的 Client Secret，类型 Secret。

密钥直接填入 Cloudflare，不写入 Git、不填到 Pages、不发送到聊天。完成后在正式后台验证登录。

## 以后更换博客域名

业务代码、内容、媒体路径、Worker 地址和 OAuth callback 均保持不变。更换时只调整域名相关配置：

1. 在新域名所属 DNS 区域添加新 Pages 自定义域名，等待 HTTPS 生效。
2. Pages `SITE_URL` 改为新 HTTPS 域名，重新构建，使 canonical 和分享链接更新。
3. Worker `ALLOWED_ORIGINS` 添加新站 Origin；在旧域名重定向或停用后移除旧 Origin。不得使用通配符，也不要加入尚未确认属于本项目的 `pages.dev` 域名。
4. OAuth App Homepage URL 更新到新域名的 `/admin/`；Callback 继续使用同一个 Worker 地址，无需重新生成密钥。
5. 同步 `.env.example` 与 `worker/wrangler.toml` 中的公开地址。

旧的项目及域名绑定在迁移成功前保留，以免尚未构建的新站替换当前可用站点。
