# HuaOvO 部署配置

正式站点：`https://huaoblog.cn`；管理后台：`https://huaoblog.cn/admin/`。仓库：`ForeSee2024/huaoblog`；生产分支：`main`。

## 域名与 DNS

域名注册商为阿里云，解析服务使用 Cloudflare 免费区域。修改网站解析时，在 Cloudflare 中操作；阿里云继续管理域名注册、续费和实名信息。

| 项目 | 当前配置 |
| --- | --- |
| Cloudflare account | `fc3766c02d25569ab3a3eb4d0cd6ae79` |
| 新域名 Zone | `05ef7816672cffdaa46ed408e52c89a3` |
| 域名 | `huaoblog.cn`、`www.huaoblog.cn` |
| DNS 服务器 1 | `algin.ns.cloudflare.com` |
| DNS 服务器 2 | `emely.ns.cloudflare.com` |
| 根域名 CNAME | `huaoblog.cn` → `huaoblog.pages.dev`，代理开启 |
| www CNAME | `www.huaoblog.cn` → `huaoblog.pages.dev`，代理开启 |
| 旧域名 Zone | `7a77b554760b6f0a7178056c8224322e` |

根域名与 www 均需要在 Pages 的 Custom domains 中绑定。仅添加 DNS 记录不等于完成 Pages 绑定。[Cloudflare 官方说明](https://developers.cloudflare.com/pages/configuration/custom-domains/)

以 `huaoblog.cn` 为唯一正式域名。旧域名 `aoblog.eu.cc`、`www.aoblog.eu.cc` 和新域名的 www 入口使用 Cloudflare Redirect Rules 跳转到正式域名，保留路径及查询参数。规则排除 `/.well-known/` 证书验证路径，以便证书正常续期。旧域名及其 Pages 绑定保留用于兼容旧链接。

## Pages 项目配置

| 设置 | 值 |
| --- | --- |
| 项目名称 | `huaoblog` |
| 默认域名 | `huaoblog.pages.dev` |
| 生产分支 | `main` |
| 构建命令 | `npm run check && npm test && npm run build` |
| 输出目录 | `dist` |
| 根目录 | 仓库根目录 |
| `NODE_VERSION` | `24` |
| `SITE_URL` | `https://huaoblog.cn` |
| `CMS_REPO` | `ForeSee2024/huaoblog` |
| `CMS_AUTH_URL` | `https://huaoblog-oauth.huaoqaq.workers.dev` |

生产与预览环境使用上述公开环境变量。更改 `SITE_URL` 后需要重新构建，才能更新 canonical、分享链接、个人简介页的博客网址和后台站点入口。

GitHub 主分支要求 `Type Check & Production Build` 检查通过，禁止强推和删除。Pages 已连接该仓库，生产部署与分支预览自动执行。

## GitHub OAuth App

复用 [HuaOvO Blog Admin](https://github.com/settings/applications/3930539)：

- Homepage URL：`https://huaoblog.cn/admin/`
- Authorization callback URL：`https://huaoblog-oauth.huaoqaq.workers.dev/callback`
- Worker `ALLOWED_ORIGINS`：`https://huaoblog.cn,https://www.huaoblog.cn,https://huaoblog.pages.dev`

`GITHUB_CLIENT_ID` 与 `GITHUB_CLIENT_SECRET` 为 Worker 加密 Secret。修改来源白名单时继承已有 Secret，不重新创建密钥，不把密钥放入 Pages 或 Git。

迁移期间允许旧来源；新后台登录验证完成、旧域名跳转启用后，移除旧来源。OAuth App 继续使用此前已确认的 GitHub `repo` 权限，Cloudflare GitHub App 仅安装到 `ForeSee2024/huaoblog`。

## 下次更换域名

1. 为新域名准备 DNS、Pages 自定义域名和 HTTPS，核对现有解析记录。
2. Worker 白名单精确添加新 HTTPS Origin。
3. 更新 Pages 生产及预览 `SITE_URL`，重新部署；同步 `.env.example`。
4. 更新 OAuth App Homepage URL。Worker 地址与 Callback URL 可继续使用。
5. 验证前台、文章、搜索、后台登录，再设置旧域名 301 跳转并收紧旧来源。
6. 更新本文及使用清单。

域名迁移不需要更换文章、图片、仓库或登录密钥。Cloudflare Pages 的 `_redirects` 不支持域名级匹配；域名跳转在 Cloudflare Redirect Rules 配置，现有文章路径跳转继续保留在 `public/_redirects`。[重定向官方说明](https://developers.cloudflare.com/pages/configuration/redirects/)

## 回退

需要临时恢复旧入口时，先停用旧区域的域名跳转规则，再把 Pages `SITE_URL` 改回旧域名并重新部署，同时恢复旧 Origin 白名单。继续使用当前 `huaoblog` 项目，以保留最新内容。旧 `webblog` 项目作为历史备份保留。
