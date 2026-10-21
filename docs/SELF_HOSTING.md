# Node 与自有服务器部署

同一内容服务支持 Node.js 24、SQLite 和文件对象存储。网站通过 Astro 的 Node standalone 构建运行，后台仍使用本站 API。程序可以重新部署，内容保存在独立的持久目录中。

已有内容先按 [MIGRATION.md](MIGRATION.md) 恢复到空目录。构建和启动不会自动把 Git 中的文章导入数据库。

## 数据目录与环境

建议使用专门的服务账号运行，确保它可以读应用文件并写持久数据目录。以下示例假设应用位于 `/srv/huaoblog/app`，数据位于 `/var/lib/huaoblog`；按服务器实际路径修改。

| 变量 | 用途 |
| --- | --- |
| `SITE_URL` | 正式 HTTPS Origin，例如 `https://huaoblog.cn`；构建和运行时保持一致 |
| `APP_DATA_DIR` | 持久数据目录；生产环境使用绝对路径 |
| `HOST` / `PORT` | Node 监听地址与端口；反向代理部署可用 `127.0.0.1` / `4321` |
| `CMS_AUTH_URL` | GitHub OAuth 网关的 HTTPS Origin |
| `ADMIN_GITHUB_ID` | 允许管理内容的 GitHub 用户 ID，当前博客为 `160737293` |
| `APP_DEV_AUTH` | 仅供本机临时测试；正式环境必须不设置或不为 `1` |

`APP_DATA_DIR` 中包含 `content.sqlite`、SQLite WAL 辅助文件以及 `objects/`。对象文件有内部封装格式，应通过媒体接口或备份工具读取，不能把 `objects/` 配成静态图片目录。不要把数据放进 `dist/`、`public/` 或临时构建目录。

## 直接运行 Node

确认 `node --version` 为 v24，然后在应用根目录安装和构建：

```sh
npm ci
SITE_URL=https://huaoblog.cn npm run build:node
```

首次部署先恢复内容；下面的目标目录必须没有现有内容：

```sh
npm run content:import -- \
  --archive /srv/backups/huaoblog/source.tar \
  --data-dir /var/lib/huaoblog
```

启动 Node：

```sh
NODE_ENV=production \
SITE_URL=https://huaoblog.cn \
CMS_AUTH_URL=https://huaoblog-oauth.huaoqaq.workers.dev \
ADMIN_GITHUB_ID=160737293 \
APP_DATA_DIR=/var/lib/huaoblog \
HOST=127.0.0.1 PORT=4321 \
node dist/server/entry.mjs
```

`npm start` 执行同一个入口。直接运行构建产物时不会自动加载项目 `.env`；应由进程管理器注入环境，或用 Node 的 `--env-file` 显式读取配置文件。启动会按版本检查和应用数据库迁移，遇到比程序更新的数据库版本会拒绝启动。升级前先备份，并保留上一版可运行程序。

生产环境应交给 systemd 等进程管理器。下面是服务单元示例；先创建相应账号、配置文件与目录，并确认 `ExecStart` 指向实际安装的 Node 24：

```ini
[Unit]
Description=Huaoblog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=huaoblog
WorkingDirectory=/srv/huaoblog/app
EnvironmentFile=/etc/huaoblog/blog.env
ExecStart=/usr/bin/node /srv/huaoblog/app/dist/server/entry.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`blog.env` 填写前述生产变量，不能包含 `APP_DEV_AUTH=1`。OAuth Client Secret 属于独立网关的配置，不需要放进博客进程的环境。

## HTTPS 与反向代理

正式后台写入要求 HTTPS 和精确的同源 Origin。Node 保持监听回环地址，由反向代理提供 TLS。仓库提供 `deploy/Caddyfile`，默认代理 `huaoblog.cn` 到 `127.0.0.1:4321`，并将 `www` 重定向到主域名。

使用自己的域名时，同步修改 Caddy 的站点名、重定向目标和 `SITE_URL`，重新构建后启动。Caddy 需在服务器上单独安装和运行，并按其要求配置 DNS 与 80/443 端口。不要把后台 API 或 `/images/posts/*` 绕过应用直接映射到静态文件目录。

## Docker Compose

仓库的 `deploy/Dockerfile` 使用 Node 24 构建，运行时以 `node` 用户启动。`deploy/compose.yaml` 将数据挂载到命名卷 `/data`，并仅把应用端口绑定到宿主机 `127.0.0.1:4321`。

```sh
export SITE_URL=https://huaoblog.cn
export CMS_AUTH_URL=https://huaoblog-oauth.huaoqaq.workers.dev
export ADMIN_GITHUB_ID=160737293

docker compose -f deploy/compose.yaml build blog
```

首次恢复时通过标准输入传包，避免宿主机备份文件的账号权限与容器用户不同。目标命名卷必须为空。示例为流输入显式设置 10 GiB 读取预算；按实际备份大小调整，普通本地文件导入则自动使用文件大小：

```sh
docker compose -f deploy/compose.yaml run --rm -T blog \
  node scripts/import-content.mjs \
  --archive /dev/stdin --data-dir /data --max-total-bytes 10737418240 \
  < /srv/backups/huaoblog/source.tar

docker compose -f deploy/compose.yaml up -d blog
```

Compose 当前只启动博客应用；Caddy 和可选的独立 OAuth 网关需要另外运行。更新程序可重新构建并执行 `up -d`，继续使用原命名卷。不要用 `docker compose down -v` 做普通更新，否则会删除数据卷。

容器备份示例，输出文件名每次使用新值：

```sh
backup_name="huaoblog-$(date -u +%Y%m%dT%H%M%SZ).tar"
docker compose -f deploy/compose.yaml run --rm -T blog \
  node scripts/backup-content.mjs \
  --data-dir /data --out "/data/backups/$backup_name"

docker compose -f deploy/compose.yaml cp \
  "blog:/data/backups/$backup_name" "/srv/backups/huaoblog/$backup_name"
```

将复制出的 TAR 按迁移文档校验，并保存到服务器之外。命名卷里的一份备份不能替代异机备份。

## GitHub 登录网关：先迁内容，再独立迁登录

默认 `CMS_AUTH_URL` 仍指向现有 Cloudflare OAuth Worker。Node 内容服务可以在这种配置下独立运行，但登录仍依赖该 Worker；不能据此声称整个部署已经离开 Cloudflare。

仓库提供 `worker/node-server.mjs`，将同一 OAuth 协议部署为普通 Node HTTP 服务。要完全迁走：

1. 为登录网关准备独立的 HTTPS 域名，例如 `auth.example.com`。
2. 在 GitHub OAuth App 中把 Homepage URL 配成博客地址，把 Authorization callback URL 配成 `https://auth.example.com/callback`。切换前保留旧登录的回退方式；必要时为新网关单独创建 OAuth App。
3. 给 Node 网关提供下面的环境变量。Client Secret 存在服务器的受限配置文件或密钥管理器中，不写入 Git、镜像构建参数或备份包。
4. 通过反向代理把该域名代理到网关的回环端口，将博客的 `CMS_AUTH_URL` 改为 `https://auth.example.com` 并重启。

网关配置文件示例 `/etc/huaoblog/oauth.env`：

```dotenv
OAUTH_PUBLIC_URL=https://auth.example.com
OAUTH_HOST=127.0.0.1
OAUTH_PORT=8790
ALLOWED_ORIGINS=https://huaoblog.cn,https://www.huaoblog.cn
GITHUB_CLIENT_ID=replace-with-your-client-id
GITHUB_CLIENT_SECRET=replace-with-your-client-secret
```

`OAUTH_PUBLIC_URL` 必须是网关自身的 HTTPS Origin，不含路径、账号或查询参数；它决定发送给 GitHub 的 Callback 地址。`ALLOWED_ORIGINS` 是允许打开登录弹窗的博客 Origin，逗号分隔、精确匹配，不接受通配符或 `/admin/` 路径。

以能够读取配置文件的服务账号运行：

```sh
node --env-file=/etc/huaoblog/oauth.env worker/node-server.mjs
```

Caddy 中另加对应网关域名：

```caddyfile
auth.example.com {
  reverse_proxy 127.0.0.1:8790
}
```

Node 网关固定请求 GitHub `read:user` 权限，不需要仓库写权限。GitHub 身份验证成功后，博客仍会检查 `ADMIN_GITHUB_ID`，再签发本站 HttpOnly 会话。归档不包含会话，恢复到新部署后管理员需要重新登录。

完整验收应覆盖：从新博客打开登录弹窗、GitHub 正确返回新网关、弹窗只向被允许的博客回传结果、后台确认管理员身份、保存草稿不公开、发布后内容与图片可匿名读取。DNS 和 TLS 也可使用其他供应商；Node 博客与 Node 网关本身不需要 Cloudflare 绑定，但仍使用 GitHub 作为身份供应商。

## 持续备份与恢复演练

Node 部署没有自动继承 Cloudflare Worker 的 Cron。使用服务器自己的定时器定期运行备份并复制到异机存储：

```sh
npm run content:backup -- \
  --data-dir /var/lib/huaoblog \
  --out "/srv/backups/huaoblog/huaoblog-$(date -u +%Y%m%dT%H%M%SZ).tar"
```

定期把包恢复到新的临时数据目录，再导出和校验，具体命令见 [MIGRATION.md](MIGRATION.md)。恢复要求空内容库；不能把备份直接导入正在使用的正式库来覆盖它。

如果保留底层目录快照，应先停止相关进程，再完整复制 SQLite、WAL 相关文件和 `objects/`。运行中只复制 `content.sqlite` 可能漏掉已写入 WAL 的内容。标准 TAR 是跨部署的内容备份；服务器环境配置、OAuth Secret 和反向代理配置需通过各自的运维方式单独保存。
