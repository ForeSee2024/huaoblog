import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ContentError } from '../src/admin/content-model.js';

const catalog = await import('../src/data/profile-catalog.js').catch(() => ({}));
const selection = await import('../src/admin/profile-selection.js').catch(() => ({}));

function requireCatalog() {
  assert.ok(Array.isArray(catalog.SYSTEM_CATALOG), 'the system catalog is not implemented');
  assert.ok(Array.isArray(catalog.TOOL_CATALOG), 'the tool catalog is not implemented');
}

function requireSelection() {
  assert.equal(typeof selection.toggleProfileItem, 'function', 'profile selection is not implemented');
  assert.equal(typeof selection.moveProfileItem, 'function', 'profile ordering is not implemented');
}

test('catalogs cover common systems and tools without duplicate or unsafe ids', () => {
  requireCatalog();
  assert.ok(catalog.SYSTEM_CATALOG.length <= 16);
  assert.ok(catalog.TOOL_CATALOG.length >= 90 && catalog.TOOL_CATALOG.length <= 120);
  const systems = new Set(catalog.SYSTEM_CATALOG.map(item => item.id));
  const tools = new Set(catalog.TOOL_CATALOG.map(item => item.id));
  for (const id of ['macos', 'windows', 'linux', 'ubuntu', 'debian', 'arch', 'fedora', 'kali', 'linux-mint', 'android', 'ios', 'ipados', 'freebsd', 'nixos']) assert.ok(systems.has(id), `${id} system is missing`);
  for (const id of ['typescript', 'javascript', 'python', 'c', 'cpp', 'csharp', 'go', 'rust', 'java', 'kotlin', 'swift', 'dart', 'php', 'r', 'ruby', 'julia', 'lua', 'matlab', 'bash', 'powershell', 'html', 'css', 'zig', 'astro', 'react', 'vue', 'svelte', 'nextjs', 'nuxt', 'angular', 'nodejs', 'express', 'django', 'flask', 'fastapi', 'spring', 'dotnet', 'flutter', 'tailwind', 'vite', 'pytorch', 'tensorflow', 'opencv', 'scikit-learn', 'jupyter', 'numpy', 'pandas', 'anaconda', 'git', 'github', 'gitlab', 'docker', 'kubernetes', 'cloudflare', 'aws', 'azure', 'nginx', 'terraform', 'jenkins', 'grafana', 'mysql', 'postgresql', 'redis', 'sqlite', 'mongodb', 'vscode', 'cursor', 'intellij-idea', 'pycharm', 'clion', 'webstorm', 'vim', 'neovim', 'sublime-text', 'zotero', 'obsidian', 'notion', 'markdown', 'latex', 'figma', 'blender', 'photoshop', 'illustrator', 'unity', 'unreal-engine', 'wireshark', 'burp-suite', 'nmap']) assert.ok(tools.has(id), `${id} tool is missing`);
  assert.equal(systems.size, catalog.SYSTEM_CATALOG.length);
  assert.equal(tools.size, catalog.TOOL_CATALOG.length);
  for (const [items, groups] of [[catalog.SYSTEM_CATALOG, catalog.SYSTEM_GROUPS], [catalog.TOOL_CATALOG, catalog.TOOL_GROUPS]]) {
    const groupIds = new Set(groups.map(group => group.id));
    assert.equal(groupIds.size, groups.length);
    for (const group of groups) assert.ok(group.name && items.some(item => item.group === group.id));
    for (const item of items) {
      assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/);
      assert.ok(item.name && groupIds.has(item.group));
      if (item.aliases) assert.ok(item.aliases.every(alias => typeof alias === 'string' && alias.length));
    }
  }
  assert.equal(catalog.MAX_PROFILE_TOOLS, 60);
  assert.equal(catalog.MAX_PROFILE_SYSTEMS, 16);
  assert.deepEqual(catalog.PROFILE_GENERIC_ICONS, [['code', '通用代码'], ['terminal', '终端'], ['cloud', '云服务'], ['book', '文献'], ['notebook', '笔记'], ['monitor', '设备']]);
});

test('catalog searches match names, ids and Chinese or English aliases', () => {
  requireCatalog();
  assert.equal(typeof selection.profileMatches, 'function', 'profile search is not implemented');
  const tool = id => catalog.TOOL_CATALOG.find(item => item.id === id);
  const system = id => catalog.SYSTEM_CATALOG.find(item => item.id === id);
  for (const [item, query] of [[tool('vscode'), ' VS CODE '], [tool('cpp'), 'C++'], [tool('csharp'), 'c#'], [tool('python'), '蟒蛇'], [tool('zotero'), '文献管理'], [system('macos'), '苹果'], [system('windows'), '微软'], [tool('scikit-learn'), 'sklearn'], [tool('postgresql'), 'Postgres']]) assert.equal(selection.profileMatches(item, query), true, `query ${query} should match ${item.id}`);
  assert.equal(selection.profileMatches(tool('python'), ''), true);
  assert.equal(selection.profileMatches(tool('python'), '   '), true);
  assert.equal(selection.profileMatches(tool('python'), 'rust'), false);
});

test('icon sources allow only catalog assets and reuse the Apple icon for mobile systems', () => {
  requireCatalog();
  assert.equal(typeof catalog.profileIconSrc, 'function', 'profile icon lookup is not implemented');
  assert.equal(catalog.profileIconSrc('typescript'), '/images/profile-icons/typescript.svg');
  assert.equal(catalog.profileIconSrc('ios'), '/images/profile-icons/macos.svg');
  assert.equal(catalog.profileIconSrc('ipados'), '/images/profile-icons/macos.svg');
  for (const id of ['code', 'terminal', 'cloud', 'book', 'notebook', 'monitor', '../python', 'javascript:alert(1)', '__proto__', '<svg>', '', null]) assert.equal(catalog.profileIconSrc(id), '');
  for (const item of [...catalog.SYSTEM_CATALOG, ...catalog.TOOL_CATALOG].filter(item => item.asset === '')) {
    assert.equal(catalog.profileIconSrc(item.id), '');
    assert.ok(catalog.PROFILE_GENERIC_ICONS.some(([id]) => id === item.fallback), `${item.id} needs a supported fallback`);
  }
});

test('every brand icon is a local static SVG with no script or external references', async () => {
  requireCatalog();
  const paths = new Set([...catalog.SYSTEM_CATALOG, ...catalog.TOOL_CATALOG].map(item => catalog.profileIconSrc(item.id)).filter(Boolean));
  assert.ok(paths.size > 80);
  for (const path of paths) {
    assert.match(path, /^\/images\/profile-icons\/[a-z0-9][a-z0-9-]*\.svg$/);
    const svg = await readFile(new URL(`../public${path}`, import.meta.url), 'utf8');
    assert.match(svg, /^\s*<svg[\s>]/);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|iframe|image)\b|\son[a-z]+\s*=/i, `${path} has active content`);
    assert.doesNotMatch(svg, /(?:href\s*=\s*["'](?!#)|url\(\s*["']?(?!#))/i, `${path} has an external reference`);
    assert.doesNotMatch(svg, /currentColor/i, `${path} must preserve a fixed brand color`);
  }
  const license = await readFile(new URL('../public/images/profile-icons/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(license, /Skill Icons/);
  assert.match(license, /MIT License/);
  assert.match(license, /Simple Icons/);
  assert.match(license, /CC0/);
});

test('tool selection appends by catalog id and leaves existing custom tools intact', () => {
  requireSelection();
  const custom = { name: 'Python', description: '自定义实验环境', icon: 'code' };
  const existing = { name: '我的编辑器', description: '保留说明', icon: 'vscode' };
  const before = { title: '关于我', tools: [custom, existing], operatingSystems: ['macos'], other: { retained: true } };
  const selected = selection.toggleProfileItem(before, 'tools', 'python', true);
  assert.deepEqual(selected.tools, [custom, existing, { name: 'Python', description: '', icon: 'python' }]);
  assert.notEqual(selected, before);
  assert.notEqual(selected.tools, before.tools);
  assert.equal(selected.other, before.other);
  assert.deepEqual(before.tools, [custom, existing]);
  const repeated = selection.toggleProfileItem(selected, 'tools', 'vscode', true);
  assert.deepEqual(repeated.tools, selected.tools);
  assert.equal(repeated.tools[1].description, '保留说明');
  const removed = selection.toggleProfileItem(selected, 'tools', 'python', false);
  assert.deepEqual(removed.tools, [custom, existing]);
  assert.equal(selected.tools.length, 3);
});

test('system selection preserves join order and returns new arrays for no-op changes', () => {
  requireSelection();
  const before = { operatingSystems: ['windows'], body: '正文', tools: [] };
  const first = selection.toggleProfileItem(before, 'systems', 'ubuntu', true);
  const second = selection.toggleProfileItem(first, 'systems', 'macos', true);
  assert.deepEqual(second.operatingSystems, ['windows', 'ubuntu', 'macos']);
  assert.deepEqual(before.operatingSystems, ['windows']);
  assert.equal(second.body, '正文');
  const unchanged = selection.toggleProfileItem(second, 'systems', 'ubuntu', true);
  assert.notEqual(unchanged, second);
  assert.notEqual(unchanged.operatingSystems, second.operatingSystems);
  assert.deepEqual(unchanged.operatingSystems, second.operatingSystems);
  assert.deepEqual(selection.toggleProfileItem(second, 'systems', 'windows', false).operatingSystems, ['ubuntu', 'macos']);
  assert.deepEqual(selection.toggleProfileItem({ title: '旧设置' }, 'systems', 'linux', true), { title: '旧设置', operatingSystems: ['linux'] });
});

test('removing a selected tool removes only entries with that catalog icon', () => {
  requireSelection();
  const before = { tools: [{ name: 'Python', description: '手写工具', icon: 'terminal' }, { name: '自定义 Python', description: '品牌工具', icon: 'python' }, { name: 'CLI', description: '', icon: 'terminal' }] };
  const after = selection.toggleProfileItem(before, 'tools', 'python', false);
  assert.deepEqual(after.tools, [before.tools[0], before.tools[2]]);
  assert.equal(before.tools.length, 3);
});

test('selected systems and custom tools can be reordered without changing their contents', () => {
  requireSelection();
  const custom = { name: '个人脚本', description: '保留说明', icon: 'terminal' };
  const python = { name: 'Python', description: '实验', icon: 'python' };
  const before = { operatingSystems: ['macos', 'ubuntu', 'windows'], tools: [custom, python], title: '关于' };
  const systems = selection.moveProfileItem(before, 'systems', 2, 'up');
  assert.deepEqual(systems.operatingSystems, ['macos', 'windows', 'ubuntu']);
  const tools = selection.moveProfileItem(before, 'tools', 0, 'down');
  assert.deepEqual(tools.tools, [python, custom]);
  assert.equal(tools.tools[1].description, '保留说明');
  assert.deepEqual(before.tools, [custom, python]);
  assert.equal(tools.title, '关于');
  assert.notEqual(tools, before);
  assert.notEqual(tools.tools, before.tools);
  assert.deepEqual(selection.moveProfileItem(before, 'systems', 0, 'up').operatingSystems, before.operatingSystems);
  assert.deepEqual(selection.moveProfileItem(before, 'tools', 1, 'down').tools, before.tools);
});

test('selection rejects invalid kinds, ids, flags and malformed lists with ContentError', () => {
  requireSelection();
  for (const args of [
    [{}, 'other', 'python', true], [{}, 'tools', '../python', true], [{}, 'tools', 'code', true], [{}, 'tools', '__proto__', true], [{}, 'systems', 'python', true], [{}, 'tools', 'python', 'true'], [null, 'tools', 'python', true], [{ tools: 'python' }, 'tools', 'python', true], [{ operatingSystems: {} }, 'systems', 'macos', false],
  ]) assert.throws(() => selection.toggleProfileItem(...args), ContentError);
  for (const args of [[{ tools: [] }, 'tools', 0, 'up'], [{ tools: [{}] }, 'tools', -1, 'up'], [{ tools: [{}] }, 'tools', 0.5, 'down'], [{ tools: [{}] }, 'tools', 0, 'left'], [{ tools: [] }, 'other', 0, 'up']]) assert.throws(() => selection.moveProfileItem(...args), ContentError);
});

test('selection allows current limits and rejects adding beyond them', () => {
  requireCatalog();
  requireSelection();
  const tools = Array.from({ length: 59 }, () => ({ name: '自定义工具', description: '', icon: 'code' }));
  const atLimit = selection.toggleProfileItem({ tools }, 'tools', 'python', true);
  assert.equal(atLimit.tools.length, 60);
  assert.throws(() => selection.toggleProfileItem(atLimit, 'tools', 'rust', true), ContentError);
  assert.equal(selection.toggleProfileItem(atLimit, 'tools', 'python', true).tools.length, 60);
  assert.equal(selection.toggleProfileItem(atLimit, 'tools', 'python', false).tools.length, 59);
  const systems = catalog.SYSTEM_CATALOG.slice(0, 15).map(item => item.id);
  const last = catalog.SYSTEM_CATALOG[15].id;
  assert.equal(selection.toggleProfileItem({ operatingSystems: systems }, 'systems', last, true).operatingSystems.length, 16);
  assert.throws(() => selection.toggleProfileItem({ operatingSystems: Array(16).fill('macos') }, 'systems', 'ubuntu', true), ContentError);
});

test('reordering rejects lists that exceed the profile limits', () => {
  requireSelection();
  assert.throws(() => selection.moveProfileItem({ tools: Array.from({ length: 61 }, () => ({ name: '自定义', description: '', icon: 'code' })) }, 'tools', 0, 'down'), ContentError);
  assert.throws(() => selection.moveProfileItem({ operatingSystems: Array(17).fill('macos') }, 'systems', 0, 'down'), ContentError);
});
