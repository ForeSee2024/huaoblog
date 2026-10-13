# HuaOvO 部署配置

当前站点：`https://aoblog.eu.cc`；仓库：`ForeSee2024/huaoblog`；生产分支：`main`。

Cloudflare account：`fc3766c02d25569ab3a3eb4d0cd6ae79`；当前域名 Zone：`7a77b554760b6f0a7178056c8224322e`。

## 检查与已修复

- GitHub 两次 CI 失败的原因是测试使用 macOS 专用 `/private/tmp`；已改为 Node 系统临时目录，60 项测试、类型检查和生产构建通过。
- 修复 PR #1 已合入 `main`，提交 `2c0409706941b3276fad3a164e9e2b6c84d072f1` 的 GitHub 正式 CI 已通过。`main` 已启用必需的 `Type Check & Production Build` 检查，禁止强推和删除。
- 新 Pages 项目 `huaoblog` 已创建，默认域名 `huaoblog.pages.dev`，构建命令及四项公开环境变量已配置。首次生产部署通过 Direct Upload 完成，部署 ID `a0a4b3bf-5d92-420c-89e3-7e256f9709f3`；221 个静态文件全部上传。首页与后台的线上响应和构建文件一致。
- `aoblog.eu.cc` 与 `www.aoblog.eu.cc` 已从旧 Pages 项目 `webblog` 转移到 `huaoblog`，两个 CNAME 均指向 `huaoblog.pages.dev`。旧项目及其默认域名 `webblog-3j4.pages.dev` 保留用于回退。
- GitHub 集成仍被 Cloudflare 的 `8000011` Git 安装内部异常阻断，需要重新连接 Cloudflare Workers and Pages GitHub App。首次上线不依赖此授权，但授权恢复前，仓库后续变更不会自动部署到 Pages。
- Worker `huaoblog-oauth` 已部署，域名 `https://huaoblog-oauth.huaoqaq.workers.dev` 与博客域名独立。后台密钥还需配置。

本人需要处理的授权与密钥步骤见 [上线操作清单](./上线操作清单.md)。

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

新项目实际默认域名为 `huaoblog.pages.dev`，已在 Worker 的精确来源白名单中。两个正式自定义域名的 Pages 绑定与 DNS 迁移均已执行。仅改 DNS 不等于完成 Pages 自定义域名绑定。

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

需要回退时，将两个域名重新绑定到保留的旧项目 `webblog`，并将 CNAME 改回 `webblog-3j4.pages.dev`。
