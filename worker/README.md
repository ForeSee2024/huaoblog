# HuaOvO 管理后台的 GitHub 登录网关

此 Worker 只处理 管理后台的 GitHub OAuth。文章与图片保存在 GitHub 仓库，博客由 Cloudflare Pages 静态发布。

## 配置和部署

1. 创建 GitHub OAuth App，名称可用 `HuaOvO Blog CMS`。Homepage URL 填正式博客的 `/admin/` 地址；Callback URL 填最终 Worker 域名的 `/callback`，例如 `https://你的Worker.workers.dev/callback`。
2. 将 `wrangler.toml` 的 `ALLOWED_ORIGINS` 改为实际博客 Origin，例如 `https://blog.你的域名`。Origin 不带 `/admin/` 路径或结尾斜线；多个域名用逗号分隔，不支持通配符。需要在预览域名登录时，精确添加该域名。日常本地编辑使用文件代理，无需为它开放正式 OAuth。
3. 在本目录执行以下命令，按提示注入 OAuth App 的凭据，然后部署：

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```

4. 在 Pages 构建环境填写公开配置并重新部署博客：

   ```text
   SITE_URL=https://你的正式博客域名
   CMS_REPO=GitHub用户名/仓库名
   CMS_AUTH_URL=https://你的Worker.workers.dev
   ```

公开后台连接配置由 `src/config/admin.ts` 在构建时注入管理入口，无需手工编辑静态文件。Client Secret 只保存在 Worker Secret 中。

## 会话与错误处理

`/auth` 验证允许的 Origin，将随机 nonce 与该 Origin 一起保存在短时 HttpOnly、Secure、SameSite=Lax Cookie 中。`/callback` 对完整 state 做常量时间比对，并在换取 Token 时指定同一 Callback URL。

回传脚本只向原始 Origin 发送结果，同时验证 `event.source` 是打开弹窗的页面；取消授权、GitHub 错误和无效会话均返回明确错误。响应禁止缓存并使用 CSP，第三方错误字符串通过 JSON 安全序列化，不能成为执行脚本。

## 启用后的验收

运行根目录的 `npm test` 可以检查会话篡改、错误 Origin、错误消息来源和 GitHub 错误路径。真实联调还需确认：登录弹窗能够关闭；文章与图片保存到工作流分支；`main` 分支保护要求 `Type Check & Production Build` 通过；发布合并后 Pages 成功构建且搜索索引更新。

更换 Worker 域名时，同时更新 GitHub OAuth App 的 Callback URL 与 Pages 的 `CMS_AUTH_URL`。更换博客域名时，同时更新 `SITE_URL`、OAuth App 的 Homepage URL 与 `ALLOWED_ORIGINS`。
