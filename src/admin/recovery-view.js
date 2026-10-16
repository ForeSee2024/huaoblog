import { escape as e, button, empty, notice, size } from './ui.js';
import { pageHeading } from './views.js';

const timestamp = value => {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleString('zh-CN', { hour12: false }) : String(value || '时间未记录');
};

export function directDeletionResult(result) {
  const completed = result.deleted?.length || 0, failed = result.failed || [];
  const reasons = failed.map(item => `${item.title || item.data?.title || item.name || item.slug || '内容'}：${item.error || '操作未完成'}`);
  return { error: failed.length > 0, message: failed.length ? `已移入回收站 ${completed} 项，${failed.length} 项未完成。${reasons.join('；')}。失败内容已保留选择，请核对后重试。` : `已将 ${completed} 项内容移入回收站，前台已更新。` };
}

export function recoveryView(trash = {}, { writable = false, backupValidation, backupEvents = [] } = {}) {
  const posts = trash.posts || [], media = trash.media || [];
  const restore = (kind, item) => button('恢复', 'restore-trash', 'refresh', 'secondary', `data-kind="${kind}" ${kind === 'post' ? `data-slug="${e(item.slug)}" data-status="${e(item.status)}"` : `data-name="${e(item.name)}"`} ${writable && item.revision ? '' : 'disabled data-locked="true"'}`);
  const rows = [
    ...posts.map(item => `<div class="recovery-row"><div class="recovery-copy"><strong>${e(item.data?.title || item.slug)}</strong><p>${item.status === 'published' ? '已发表版本' : '草稿'} · ${e(item.slug)} · ${e(timestamp(item.deletedAt))}</p></div><div class="recovery-actions">${button('历史版本', 'post-history', 'clock', 'quiet', `data-slug="${e(item.slug)}"`)}${restore('post', item)}</div></div>`),
    ...media.map(item => `<div class="recovery-row"><div class="recovery-copy"><strong>${e(item.name)}</strong><p>图片 · ${size(item.size)} · ${e(timestamp(item.deletedAt))}</p></div><div class="recovery-actions">${restore('media', item)}</div></div>`),
  ].join('');
  return `${pageHeading('恢复与备份', '找回已删除内容、检查历史版本，并保存可迁移的完整备份。', button('刷新状态', 'refresh', 'refresh'))}
  <section class="settings-section"><div class="section-heading"><h2>回收站</h2><p>删除的文章和图片保留在这里。恢复已发表版本后，前台立即更新。</p></div>${rows || empty('回收站为空', '删除内容后，可以在这里找回。', 'go-posts', '管理文章', 'delete')}</section>
  <section class="settings-section"><div class="section-heading"><h2>完整备份</h2><p>备份包含配置、文章与草稿、回收站、历史版本以及图片文件和校验清单，以标准 .tar 文件下载。</p></div><div class="backup-actions">${button('导出完整备份', 'export-backup', 'save', 'primary', writable ? '' : 'disabled')}${button('校验备份文件', 'validate-backup', 'check', 'secondary', writable ? '' : 'disabled')}</div><p class="field-hint">校验不会修改当前内容。浏览器预检上限为 32 MB，更大的备份请通过部署命令校验。恢复导入通过部署命令执行，默认仅允许导入空数据库。</p>
  ${backupValidation ? `<div class="backup-validation" role="status">${notice(`${backupValidation.importable ? '预检通过，可导入空库' : '当前不可导入'}${backupValidation.reason || backupValidation.message ? `：${backupValidation.reason || backupValidation.message}` : ''}`, backupValidation.importable ? 'info' : 'error')}<details><summary>查看预检详情</summary><pre>${e(JSON.stringify(backupValidation.summary || backupValidation, null, 2))}</pre></details></div>` : ''}
  ${backupEvents.length ? `<div class="backup-records"><h3>本次会话的备份操作</h3><ul>${backupEvents.map(event => `<li><strong>${e(event.action)} · ${event.status === 'failed' ? '失败' : '完成'}</strong><span>${e(event.message)}</span><small>${e(timestamp(event.createdAt))}</small></li>`).join('')}</ul></div>` : ''}</section>`;
}

export function historyView({ kind, id, versions = [], expectedRevision, writable = true }) {
  const settings = kind === 'settings';
  const description = settings ? '恢复将同时还原该时刻的公开配置和未发布配置，公开配置立即生效。' : '每个快照包含该文章当时的已发表版本和草稿。恢复后，已发表版本立即影响前台。';
  return `${pageHeading('历史版本', settings ? '站点配置' : `文章 / ${id}`, button('刷新状态', 'refresh', 'refresh', 'quiet') + `<a class="button secondary" href="${settings ? '#/settings/general' : '#/posts'}">返回${settings ? '站点配置' : '文章管理'}</a>`)}${notice(description)}${!expectedRevision ? notice('当前内容版本尚未读取，无法安全恢复。请刷新工作区后重试。', 'error') : ''}<section class="history-list">${versions.length ? versions.map(version => `<article class="settings-section history-item"><div class="recovery-row"><div class="recovery-copy"><h2>${e(timestamp(version.createdAt))}</h2><p>${e(version.actor || '管理员')} · <code>${e(version.revision)}</code></p></div>${button('恢复此版本', 'restore-version', 'refresh', 'secondary', `data-revision="${e(version.revision)}" ${expectedRevision && writable ? '' : 'disabled data-locked="true"'}`)}</div><details class="history-snapshot"><summary>查看版本内容</summary><pre>${e(JSON.stringify(version.snapshot, null, 2))}</pre></details></article>`).join('') : empty('还没有历史版本', '第一次修改或删除后，这里会保留此前的版本。', '', '', 'clock')}</section>`;
}
