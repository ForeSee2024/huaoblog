# Decap CMS GitHub OAuth 认证网关 (Cloudflare Worker 零信任安全版)

本目录为博客 Decap CMS 网页后台的轻量认证代理。

### 安全特性：
- 严格基于 HttpOnly Cookie 比对 CSRF state，防跨站伪造；
- 严格校验 `ALLOWED_ORIGINS` 白名单，非授权域名直接 403 阻断；
- 废除通配符 `*`，postMessage 仅向白名单后台定向返回 Token。

### 部署与配置三步走：

1. **创建 GitHub OAuth App**：
   - 访问 GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App。
   - **Application name**：`Kael Nexus Blog CMS`
   - **Homepage URL**：`https://your-blog.pages.dev/admin/`
   - **Authorization callback URL**：`https://<your-worker-subdomain>.workers.dev/callback`
   - 保存后获取 `Client ID`，并生成 `Client Secret`。

2. **配置白名单并部署 Worker**：
   - 在 `worker/wrangler.toml` 中将 `ALLOWED_ORIGINS` 修改为实际博客后台域名（例如 `https://your-blog.pages.dev,http://localhost:4321`）。
   - 注入秘钥并部署：
     ```bash
     cd worker
     npx wrangler secret put GITHUB_CLIENT_ID
     npx wrangler secret put GITHUB_CLIENT_SECRET
     npx wrangler deploy
     ```

3. **同步修改博客后台配置**：
   打开 `public/admin/config.yml`，将 `base_url` 修改为部署成功后的 Worker 地址：
   ```yaml
   backend:
     name: github
     repo: your-username/blogWeb
     branch: main
     base_url: https://decap-oauth-worker.yourname.workers.dev
     auth_endpoint: auth
   ```
