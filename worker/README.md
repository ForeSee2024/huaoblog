# HuaOvO GitHub 登录网关

此网关只处理 GitHub OAuth。内容存储和后台操作由博客自己的 API、D1/R2 或 SQLite/文件适配器负责。

现有 Cloudflare 部署为 `huaoblog-oauth`。GitHub App 的主页是 `https://huaoblog.cn/admin/`，Callback 为 `https://huaoblog-oauth.huaoqaq.workers.dev/callback`。`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 保留为加密 Secret；普通代码部署不会要求重新生成。

## Cloudflare 配置

`wrangler.toml` 的 `ALLOWED_ORIGINS` 只列出实际允许的 HTTPS Origin；不带路径，不使用通配符。博客通过 `CMS_AUTH_URL` 指向网关。新后台在 `/auth` 附带 `identity=1`，请求 `read:user`；旧静态后台兼容路径仍可请求旧版所需的 `repo` 权限，不用于新的日常内容写入。

已有凭据时，从仓库根目录部署：

```sh
npx wrangler deploy --config worker/wrangler.toml
```

首次部署到独立账户时，按 Cloudflare 官方 Secret 提示配置两个 GitHub 凭据，不能写进配置文件或 Git。博客进程不需要 Client Secret。

## 安全与会话

网关验证精确 Origin，使用短时 HttpOnly、Secure、SameSite=Lax Cookie 保存随机 state，并对回调 state 做常量时间比对。Token 交换不跟随重定向；回传脚本用 CSP、JSON 安全序列化和 Origin/source 检查，只发送给发起登录的页面。

新后台把临时 GitHub Token 换成本站会话，随后所有操作仅使用本站 Cookie；只允许配置的管理员 ID。Token 不进入浏览器存储、内容数据库或备份。

## Node 网关与验收

`node-server.mjs` 支持独立服务器，并固定使用 `read:user`。环境、HTTPS、Callback 切换和反向代理步骤见 [SELF_HOSTING.md](../docs/SELF_HOSTING.md)。

根目录 `npm test` 覆盖 Origin/state 篡改、弹窗消息来源、取消授权和 Node 网关 HTTP 冒烟测试。部署后还需实际从后台打开弹窗，完成 GitHub 回调与本站会话交换，并验证草稿保存和发布。
