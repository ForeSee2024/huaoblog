import siteSettings from '../data/site.json' with { type: 'json' };

export interface SiteSettings {
  identity: {
    name: string;
    brand: string;
    author: string;
    description: string;
    avatar: string;
    tagline: string;
    bio: string;
    socialLinks: Array<{ label: string; url: string; icon?: string }>;
  };
  home: {
    eyebrow: string;
    title: string;
    intro: string;
    primaryLabel: string;
    secondaryLabel: string;
    announcementEnabled: boolean;
    announcementTitle: string;
    announcement: string;
    feedTitle: string;
    postsPerPage: number;
  };
  navigation: Array<{ label: string; href: string; enabled: boolean }>;
  appearance: {
    theme: 'system' | 'light' | 'dark';
    accent: 'cyberblue' | 'neoncyan' | 'violet' | 'lumine';
    backgroundEffect: boolean;
  };
  about: {
    title: string;
    subtitle: string;
    body: string;
    introduction?: string;
    languages?: string;
    operatingSystems?: Array<'macos' | 'windows' | 'linux'>;
    coverImage?: string;
    tools?: Array<{ name: string; description: string; icon: 'typescript' | 'python' | 'astro' | 'cloudflare' | 'zotero' | 'obsidian' | 'code' | 'terminal' | 'cloud' | 'book' | 'notebook' | 'monitor' }>;
    githubEnabled?: boolean;
  };
  friends: Array<{ name: string; url: string; description: string; avatar?: string }>;
  footer: { text: string; icp: string; icpUrl: string };
}

export const settings = siteSettings as SiteSettings;
export const site = {
  ...settings.identity,
  fonts: 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;600;700;900&display=swap',
};
export const categories = ['软件工程与系统', 'AI 与前沿科研', '极客安全与攻防', '计算机体系沉淀', '生活随笔与杂项'] as const;

export function safeExternalHref(value: string): string | undefined {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : undefined;
  } catch {
    return undefined;
  }
}

export function safeImageSrc(value: string): string | undefined {
  if (value?.startsWith('/') && !value.startsWith('//') && !/[\u0000-\u0020\u007f\\]/.test(value)) return value;
  return safeExternalHref(value);
}

export function safeNavigationHref(value: string): string | undefined {
  const href = safeImageSrc(value);
  if (!href) return undefined;
  if (!href.startsWith('/')) return new URL(href).protocol === 'https:' ? href : undefined;
  const path = new URL(href, 'https://site.invalid').pathname.replace(/\/$/, '') || '/';
  return ['/', '/posts', '/archive', '/friends', '/about'].includes(path) || path.startsWith('/posts/') ? href : undefined;
}
