# 内容迁移与备份恢复

文章、站点设置和媒体元数据由内容服务持久保存。Cloudflare 使用 D1 与私有 R2；Node 使用 SQLite 与文件对象目录。日常后台保存、发布和删除直接更新内容服务，不再创建 GitHub PR，也不需要重新构建网站。

以下命令均在仓库根目录执行，使用 Node.js 24 和 `npm ci` 安装的依赖。离线 CLI 直接读取 `migrations/*.sql`，不依赖 Astro/Vite 的 `?raw` 加载器。CLI 参数采用 `--参数 值`，本文只列出已经实现的参数。

## 迁移包与真实边界

标准包是未压缩的 `.tar`，包含：

- `content/snapshot.json`：版本为 `huaovo-content` / `formatVersion: 1` 的完整内容快照。
- `content/settings-published.json` 与可选的 `settings-draft.json`。
- `posts/published/*.md`、`posts/draft/*.md`：可独立阅读的 Markdown。
- `media/*`：包括回收站图片在内的实际图片字节。
- `manifest.json`：每个文件的大小、SHA-256 和图片对象映射。

快照保存公开版本、草稿、软删除状态和内容历史。登录会话、GitHub Token、OAuth Secret 不进入备份。Git 首次迁移包的内容历史为空；旧 Git 历史仍保留在仓库中，不作为待恢复内容自动导入。

| 项目 | 当前实现的限制 |
| --- | --- |
| 快照 JSON / 单个 TAR 条目 | 最多 16 MiB；CLI 与网页共用此 v1 格式限制 |
| 网页备份预检 | 最多 32 MiB，指 `/api/v1/backups/validate` 上传预检 |
| 完整恢复读取器 | HTTP 默认最多 1 GiB；Node CLI 对普通文件按实际文件大小设置读取预算，流输入可用 `--max-total-bytes` 调整 |
| TAR 文档与图片数量 | 导出时合计最多 20,000 项 |
| D1 单次原子写入 | 本应用适配器最多 40 条 SQL；预检会报告 `capacity` 与 `importable` |
| 恢复目标 | 必须是空内容库，不能覆盖或合并已有文章、设置、媒体与历史 |

1 GiB 是读取器边界，不是远端 HTTP 上传容量承诺；远端请求还受 Cloudflare 或反向代理的请求体限制。Node 没有 D1 的 40 条语句上限。普通本地 TAR 文件超过 1 GiB 时，CLI 自动采用已知文件大小作为读取预算，仍逐项校验并流式读取，不把归档整体载入内存。管道或 `/dev/stdin` 输入默认 1 GiB，可显式传 `--max-total-bytes 10737418240`（10 GiB）；该参数必须为正的安全整数，也可用于收紧普通文件预算。改用 CLI 不会绕过 16 MiB 快照限制。

D1 导入按大小受控的 JSON 分块插入，并在一个原子批次中提交；文章数量不直接等于 SQL 数量。测试覆盖了 120 篇普通文章的恢复。实际容量也取决于正文、历史和媒体引用；超过容量会在写内容前返回 `import_limit`，不会分批提交半份内容。超出当前 v1 格式或 D1 单批容量时，需要先在支持范围内恢复到 Node，或开发并验收分阶段离线导入工具；仓库当前未提供无限容量的 D1 恢复工具。

## 从 Git 导出当前内容

先更新本地远端引用，再核对本次要迁入的已发表状态和仍未发布的工作。导出器只读取本地 Git 对象，不访问 GitHub API、不修改分支，也不会自动刷新引用。

```sh
git fetch origin
git rev-parse origin/main origin/huaovo/site-settings origin/huaovo/media-3118bcba

migration_dir=".local/migration/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$migration_dir"

npm run content:export-git -- \
  --published-ref origin/main \
  --settings-ref origin/huaovo/site-settings \
  --media-ref origin/huaovo/media-3118bcba \
  --out "$migration_dir/source.tar" \
  --provenance "$migration_dir/provenance.json"
```

`--published-ref` 默认是 `origin/main`；未发布的设置和媒体来源必须显式传入。导出时会把传入的引用固定为完整提交 SHA，并将其写入 provenance。也可以把完整 SHA 直接传给这三个参数，复现某次已核对的来源。

导入规则如下：

- 文章只取已发表引用的当前 `src/content/posts/` 和 `src/content/drafts/`，不扫描历史提交或未发布分支中的旧文章。已经删除的演示文章不会复活。
- `--settings-ref` 只提供 `src/data/site.json`。规范化后与公开设置不同时，保存为独立的待发布设置；前台仍读取公开设置，直到管理员点击保存发布。
- `--media-ref` 只提供从共同祖先到该引用之间新增或修改的图片。不会把旧分支中未变更的文件当作新内容迁入。
- main 中存在的图片保持公开；仅来自未发布媒体变更的图片保持私有。同名、同 SHA-256 的图片只保留一条记录；同名但字节不同则拒绝导出，不覆盖公开图片。

TAR 和 provenance 使用独占创建，不覆盖已有同名输出。归档写入失败时会删除本次创建的不完整 TAR。provenance 是单独写入的文件：若它的目标已存在，命令会失败，但此前生成的完整 TAR 可能已经保留。因此每次使用新目录，并同时检查命令退出码和两个输出文件。

## 首次实际迁移的来源记录

2026-10-16 的本地核验使用以下固定提交，记录位于 `.local/migration/2026-10-16/provenance.json`：

| 来源 | SHA |
| --- | --- |
| `origin/main` | `30919b45c3b7e0f2e7d8dc22a22367075c5ef249` |
| `origin/huaovo/site-settings`，PR #5 | `477a05fe4c515991c99f01580c9831b11cb98b92` |
| `origin/huaovo/media-3118bcba`，PR #15 | `2962cd1d3d52b52c9c33506033b975272aff2df9` |

结果为 1 篇已发表文章、0 篇草稿、1 张图片和独立的待发布设置。已发表文章是 `blog开局-杂谈建站`，路径保持 `/posts/2026-10-14-note-ae0873c0/`；图片是 `Scorify-a2cb09b9.jpg`。该图已在 main 中，因此保持公开，PR #15 没有重复生成私有副本。之前删除的 7 篇演示文章保持删除。

这些 SHA 是核验记录，不代表未来最新 main。正式切换前须重新核对最新来源，并生成新的迁移目录；不能只凭旧包切换流量。

## 校验、恢复到 Node、再备份

只校验格式、清单和图片哈希，不创建数据库：

```sh
npm run content:import -- --archive "$migration_dir/source.tar" --mode validate
```

成功输出含 `valid: true` 和 `summary`。这一步没有连接 D1，因此不表示已通过 D1 容量预检。

恢复到新目录，然后重新导出并校验：

```sh
npm run content:import -- \
  --archive "$migration_dir/source.tar" \
  --data-dir "$migration_dir/node-restored"

npm run content:backup -- \
  --data-dir "$migration_dir/node-restored" \
  --out "$migration_dir/node-roundtrip.tar"

npm run content:import -- \
  --archive "$migration_dir/node-roundtrip.tar" \
  --mode validate
```

`content:import` 会按版本初始化 SQLite 表、校验包和媒体、使用新的隔离对象键写入图片，最后原子导入内容。它不会覆盖非空内容库；失败会清理本次暂存图片。恢复后的对象键可以改变，公开图片 URL 和内容不变。`content:backup` 要求目标目录中已经存在 `content.sqlite`，并且不会覆盖已有输出 TAR。

导入 CLI 本身不自动执行“再导出”步骤。上面的三步是完整的恢复演练。需要比较文章正文、两份设置、删除状态与媒体哈希时，可执行：

```sh
node --input-type=module - "$migration_dir/source.tar" "$migration_dir/node-roundtrip.tar" <<'NODE'
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { readBackup } from './src/server/backup.js';
const load = async path => (await readBackup(Readable.toWeb(createReadStream(path)), { retainMedia: false })).snapshot;
function logicalContent(value) {
  const snapshot = structuredClone(value);
  delete snapshot.exportedAt;
  for (const media of snapshot.media) media.objectKey = `media:${media.name}`;
  for (const item of snapshot.history) if (item.kind === 'media') item.snapshot.objectKey = `media:${item.snapshot.name}`;
  return snapshot;
}
assert.deepEqual(logicalContent(await load(process.argv[2])), logicalContent(await load(process.argv[3])));
console.log('文章、公开/待发布设置、历史、删除状态及媒体哈希一致。');
NODE
```

2026-10-16 的 `source.tar` → `node-restored` → `node-roundtrip.tar` 已完成此类本地核验。产物在忽略目录中，不随源码发布，也不作为静态网站资产上传。

## 恢复到 Cloudflare 预览应用

当前配置使用 D1 `huaoblog-content`（绑定 `DB`）和私有 R2 `huaoblog-media`（绑定 `MEDIA`）。R2 不应开放为公开桶；图片通过内容服务按公开状态和管理员会话返回。

由部署负责人先应用 `migrations/`、部署预览 Worker，确认目标内容库为空。然后在本机使用已登录的 GitHub CLI 执行：

```sh
gh auth status --hostname github.com
node scripts/import-remote.mjs \
  --origin https://huaoblog-app.huaoqaq.workers.dev \
  --archive "$migration_dir/source.tar"
```

`--origin` 必须是 HTTPS Origin，不含路径或查询参数。脚本仅把当前 `gh` 登录凭据用于一次管理员身份交换，随后使用本站会话流式上传 TAR，并在结束时退出会话；它不会打印或保存 Token、Cookie。只有配置的管理员 GitHub 用户可导入，目标服务仍会执行空库、归档和 D1 容量检查。

正式流量切换前，分别核验预览上的已发表正文、公开配置、未发布设置、媒体私有状态、回收站、备份导出，以及真实登录后的写入流程。保留旧 Pages、Git 历史和离线包作为回退依据。导入或预览验收失败时，不切换域名；不要通过清空正式库来绕过恢复限制。

## 从 Cloudflare 迁往自有服务器

先从当前内容服务导出新的完整 TAR；首次 Git 迁移包不包含以后在 D1 中发生的编辑。将该包恢复到新的 Node 数据目录并完成上述回读核验，再按 [SELF_HOSTING.md](SELF_HOSTING.md) 启动与切换域名。

博客的内容存储和网页运行时可迁到 Node。登录网关目前可以继续使用 Cloudflare Worker；要完全离开 Cloudflare，还需独立部署仓库提供的 Node OAuth 网关，并更新 GitHub Callback、`ALLOWED_ORIGINS` 和博客的 `CMS_AUTH_URL`。仅迁移 SQLite 和图片不会自动迁移登录网关。
