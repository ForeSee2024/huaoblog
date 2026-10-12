# Decap CMS GitHub OAuth 认证网关 (Cloudflare Worker)

本目录为博客 Decap CMS 网页后台的轻量认证代理。

### 部署与配置三步走：

1. **创建 GitHub OAuth App**：
   - 访问 GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App。
   - **Application name**：`Kael Nexus Blog CMS`
   - **Homepage URL**：`https://your-blog.pages.dev/admin/`
   - **Authorization callback URL**：`https://<your-worker-subdomain>.workers.dev/callback`
   - 保存后获取 `Client ID`，并生成 `Client Secret`。

2. **部署 Worker 到 Cloudflare**：
   ```bash
   cd worker
   # 注入秘钥
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   # 部署上线
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
