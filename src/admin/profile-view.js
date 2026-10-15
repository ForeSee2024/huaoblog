import { escape as e, icon, field, button } from './ui.js';
import { SYSTEM_CATALOG, SYSTEM_GROUPS, TOOL_CATALOG, TOOL_GROUPS, PROFILE_GENERIC_ICONS, MAX_PROFILE_TOOLS, profileIconSrc } from '../data/profile-catalog.js';

const catalogFor = kind => kind === 'systems' ? SYSTEM_CATALOG : TOOL_CATALOG;
export function profileBadgeIcon(key) {
  const src = profileIconSrc(key);
  const item = [...SYSTEM_CATALOG, ...TOOL_CATALOG].find(item => item.id === key);
  return src ? `<img src="${e(src)}" alt="" width="32" height="32" loading="lazy" />` : icon(item?.fallback || key);
}
export const profilePreviewBadge = (name, key) => `<span>${profileBadgeIcon(key)}<small>${e(name)}</small></span>`;

export function profileSelectedItems(about, kind) {
  const items = kind === 'systems' ? about.operatingSystems || [] : about.tools || [];
  if (!items.length) return '<p class="profile-empty">暂未选择，前台将隐藏这一栏。可以从上方目录勾选。</p>';
  return items.map((value, index) => {
    const key = kind === 'systems' ? value : value.icon;
    const entry = catalogFor(kind).find(item => item.id === key);
    const name = kind === 'systems' ? entry?.name || key : value.name || '自定义项目';
    const attributes = `data-kind="${kind}" data-index="${index}"`;
    return `<div class="profile-selected-item"><div class="profile-selected-header"><span class="profile-selected-icon">${profileBadgeIcon(key)}</span><strong>${e(name)}</strong><div class="profile-order"><button type="button" class="icon-button" data-action="move-profile-item" ${attributes} data-direction="up" aria-label="上移 ${e(name)}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="move-profile-item" ${attributes} data-direction="down" aria-label="下移 ${e(name)}" ${index === items.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove-profile-item" ${attributes} aria-label="移除 ${e(name)}">${icon('delete')}</button></div></div>${kind === 'tools' ? `<details class="profile-item-details" ${!entry ? 'open' : ''}><summary>${entry ? '调整名称与提示（可选）' : '自定义名称、图标与提示'}</summary><div class="form-grid">${field(`展示名称 ${index + 1}`,`about.tools.${index}.name`,value.name,{required:true,max:80,wide:!!entry,placeholder:'填写展示名称'})}${!entry ? field(`图标 ${index + 1}`,`about.tools.${index}.icon`,value.icon,{choices:PROFILE_GENERIC_ICONS}) : ''}${field(`提示 ${index + 1}`,`about.tools.${index}.description`,value.description,{wide:true,max:160,hint:'鼠标停留在前台图标时显示，可留空。'})}</div></details>` : ''}</div>`;
  }).join('');
}

export function profilePicker(about, kind) {
  const systems = kind === 'systems', catalog = catalogFor(kind), groups = systems ? SYSTEM_GROUPS : TOOL_GROUPS;
  const selected = new Set(systems ? about.operatingSystems || [] : (about.tools || []).map(item => item.icon));
  const count = systems ? (about.operatingSystems || []).length : (about.tools || []).length;
  const label = systems ? '个人用系统' : '技能与工具';
  return `<fieldset class="profile-picker" data-profile-picker="${kind}"><legend class="sr-only">选择展示的${label}</legend><div class="profile-picker-bar"><label class="profile-search">${icon('search')}<input type="search" data-profile-search="${kind}" aria-label="搜索${label}" placeholder="${systems ? '搜索系统，如 Windows、安卓…' : '搜索图标，例如 Flutter、Next.js…'}" autocomplete="off" /></label><small>${catalog.length} 个待选图标</small></div><div class="profile-groups">${groups.map(group => {
    const items = catalog.filter(item => item.group === group.id);
    return `<details class="profile-group" data-profile-group="${group.id}" ${group.id === (systems ? 'desktop' : 'frameworks') ? 'open' : ''}><summary><span>${e(group.name)}</span><small data-profile-group-count>${items.filter(item => selected.has(item.id)).length} 已选 / ${items.length}</small></summary><div class="profile-catalog-grid">${items.map(item => `<label class="profile-card ${selected.has(item.id) ? 'selected' : ''}" data-profile-card="${e(item.id)}"><input type="checkbox" class="profile-checkbox" data-profile-item="${e(item.id)}" data-profile-kind="${kind}" aria-label="展示 ${e(item.name)}" ${selected.has(item.id) ? 'checked' : ''} /><span class="profile-card-icon">${profileBadgeIcon(item.id)}</span><span class="profile-card-name">${e(item.name)}</span></label>`).join('')}</div></details>`;
  }).join('')}</div><p class="profile-empty" data-profile-no-results hidden>没有匹配的图标，试试英文名称或常见别名。</p><div class="profile-selection-heading"><h3>已选择展示 <span data-profile-total="${kind}">${count}</span> 项</h3><small>顺序与前台一致${systems ? '' : `，最多 ${MAX_PROFILE_TOOLS} 项`}</small></div><div class="profile-selected-list" id="profile-selected-${kind}">${profileSelectedItems(about,kind)}</div>${systems ? '' : `<details class="profile-custom-action"><summary>添加目录以外的项目（可选）</summary><p class="field-hint">仅在待选库没有对应内容时使用。</p>${button('添加自定义项目','add-about-tool','plus','secondary',count >= MAX_PROFILE_TOOLS ? 'disabled' : '')}</details>`}</fieldset>`;
}
