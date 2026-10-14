import { ContentError, safeUrl, textField } from './content-model.js';

export const THEMES = ['system', 'light', 'dark'];
export const ACCENTS = ['cyberblue', 'neoncyan', 'violet', 'lumine'];
export const ABOUT_TOOL_ICONS = ['code', 'terminal', 'cloud', 'book', 'notebook', 'monitor'];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError(`${label}格式不正确。`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new ContentError(`${label}必须是布尔值。`);
  return value;
}
function list(value, label, max, map) {
  if (!Array.isArray(value) || value.length > max) throw new ContentError(`${label}最多 ${max} 项。`);
  return value.map((item, index) => map(object(item, `${label}第 ${index + 1} 项`)));
}

export function validateSettings(input) {
  const source = object(input, '站点设置');
  const identity = object(source.identity, '站点身份');
  const home = object(source.home, '首页设置');
  const appearance = object(source.appearance, '外观设置');
  const about = object(source.about, '关于页面');
  const footer = object(source.footer, '页脚设置');
  if (!THEMES.includes(appearance.theme) || !ACCENTS.includes(appearance.accent)) throw new ContentError('请选择有效的主题与强调色。');
  if (!Number.isInteger(home.postsPerPage) || home.postsPerPage < 3 || home.postsPerPage > 24) throw new ContentError('每页文章数量应为 3 至 24 的整数。');
  const settings = {
    identity: {
      name: textField(identity.name, '站点名称', 100, true), brand: textField(identity.brand, '站点品牌', 40, true), author: textField(identity.author, '作者', 100, true),
      description: textField(identity.description, '站点简介', 300, true), avatar: safeUrl(identity.avatar, { label: '头像地址' }), tagline: textField(identity.tagline, '身份标签', 160), bio: textField(identity.bio, '作者简介', 1000),
      socialLinks: list(identity.socialLinks ?? [], '社交链接', 12, item => {
        const icon = textField(item.icon, '图标', 64);
        if (icon && !/^[a-z0-9][a-z0-9:-]*$/i.test(icon)) throw new ContentError('图标名称只支持字母、数字、连字符和冒号。');
        return { label: textField(item.label, '社交链接名称', 80, true), url: safeUrl(item.url, { local: false, optional: false, label: '社交网址' }), ...(icon ? { icon } : {}) };
      }),
    },
    home: {
      eyebrow: textField(home.eyebrow, '首页眉题', 100), title: textField(home.title, '首页标题', 240, true), intro: textField(home.intro, '首页简介', 1500),
      primaryLabel: textField(home.primaryLabel, '主按钮文字', 40, true), secondaryLabel: textField(home.secondaryLabel, '次按钮文字', 40, true),
      announcementEnabled: boolean(home.announcementEnabled, '公告状态'), announcementTitle: textField(home.announcementTitle, '公告标题', 100), announcement: textField(home.announcement, '公告内容', 1500),
      feedTitle: textField(home.feedTitle, '文章列表标题', 100, true), postsPerPage: home.postsPerPage,
    },
    navigation: list(source.navigation, '导航', 12, item => {
      const href = safeUrl(item.href, { optional: false, label: '导航地址' });
      if (href.startsWith('http:')) throw new ContentError('外部导航地址必须使用 HTTPS。');
      if (href.startsWith('/')) {
        const pathname = new URL(href, 'https://site.invalid').pathname.replace(/\/$/, '') || '/';
        if (!['/', '/posts', '/archive', '/friends', '/about'].includes(pathname) && !/^\/posts\/[a-z0-9][a-z0-9-]*$/.test(pathname)) throw new ContentError('站内导航仅支持首页、博文、归档、友链、关于与文章页面。');
      }
      return { label: textField(item.label, '导航名称', 40, true), href, enabled: boolean(item.enabled, '导航状态') };
    }),
    appearance: { theme: appearance.theme, accent: appearance.accent, backgroundEffect: boolean(appearance.backgroundEffect, '背景效果') },
    about: {
      title: textField(about.title, '关于页标题', 200, true),
      subtitle: textField(about.subtitle, '关于页副标题', 300),
      body: textField(about.body, '关于页正文', 30000),
      coverImage: safeUrl(about.coverImage ?? '', { label: '关于页封面' }),
      tools: list(about.tools ?? [], '常用工具', 12, item => {
        if (!ABOUT_TOOL_ICONS.includes(item.icon)) throw new ContentError('请选择有效的工具图标。');
        return { name: textField(item.name, '工具名称', 80, true), description: textField(item.description, '工具说明', 160), icon: item.icon };
      }),
      githubEnabled: boolean(about.githubEnabled ?? true, 'GitHub 展示状态'),
      recentPostsEnabled: boolean(about.recentPostsEnabled ?? true, '最近文章展示状态'),
    },
    friends: list(source.friends ?? [], '友情链接', 100, item => ({ name: textField(item.name, '友链名称', 100, true), url: safeUrl(item.url, { local: false, optional: false, label: '友链网址' }), description: textField(item.description, '友链简介', 300), ...(item.avatar ? { avatar: safeUrl(item.avatar, { label: '友链头像' }) } : {}) })),
    footer: { text: textField(footer.text, '页脚文字', 300), icp: textField(footer.icp, '备案号', 100), icpUrl: safeUrl(footer.icpUrl, { local: false, label: '备案链接' }) },
    ...(typeof source.revision === 'string' ? { revision: source.revision } : {}),
  };
  if (!settings.navigation.some(item => item.enabled)) throw new ContentError('至少保留一项可见导航。');
  return settings;
}

export function serializeSettings(input) {
  const { revision: _revision, ...settings } = validateSettings(input);
  return `${JSON.stringify(settings, null, 2)}\n`;
}
