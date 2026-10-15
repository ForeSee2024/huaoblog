import { ContentError } from './content-model.js';
import { MAX_PROFILE_SYSTEMS, MAX_PROFILE_TOOLS, SYSTEM_CATALOG, TOOL_CATALOG } from '../data/profile-catalog.js';

const systems = new Map(SYSTEM_CATALOG.map(item => [item.id, item]));
const tools = new Map(TOOL_CATALOG.map(item => [item.id, item]));

function profileList(about, kind) {
  if (!about || typeof about !== 'object' || Array.isArray(about)) throw new ContentError('关于页面格式不正确。');
  if (!['systems', 'tools'].includes(kind)) throw new ContentError('请选择有效的个人资料类别。');
  const field = kind === 'systems' ? 'operatingSystems' : 'tools';
  const items = about[field] ?? [];
  if (!Array.isArray(items)) throw new ContentError('个人资料列表格式不正确。');
  return { field, items, catalog: kind === 'systems' ? systems : tools, max: kind === 'systems' ? MAX_PROFILE_SYSTEMS : MAX_PROFILE_TOOLS };
}

export function profileMatches(item, query) {
  const search = String(query ?? '').trim().toLocaleLowerCase();
  if (!search) return true;
  return [item.name, item.id, ...(item.aliases ?? [])].some(value => value.toLocaleLowerCase().includes(search));
}

export function toggleProfileItem(about, kind, id, selected) {
  const { field, items, catalog, max } = profileList(about, kind);
  const item = catalog.get(id);
  if (!item) throw new ContentError('请选择有效的个人资料项目。');
  if (typeof selected !== 'boolean') throw new ContentError('选择状态必须是布尔值。');
  const matches = value => kind === 'systems' ? value === id : value?.icon === id;
  const next = selected ? [...items] : items.filter(value => !matches(value));
  if (selected && !items.some(matches)) next.push(kind === 'systems' ? id : { name: item.name, description: '', icon: id });
  if (next.length > max) throw new ContentError(`${kind === 'systems' ? '个人用系统' : '常用工具'}最多 ${max} 项。`);
  return { ...about, [field]: next };
}

export function moveProfileItem(about, kind, index, direction) {
  const { field, items, max } = profileList(about, kind);
  if (items.length > max) throw new ContentError(`${kind === 'systems' ? '个人用系统' : '常用工具'}最多 ${max} 项。`);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new ContentError('项目位置无效。');
  if (!['up', 'down'].includes(direction)) throw new ContentError('请选择有效的排序方向。');
  const next = [...items];
  const target = index + (direction === 'up' ? -1 : 1);
  if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
  return { ...about, [field]: next };
}
