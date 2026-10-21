import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const cloudflareTarget = process.env.DEPLOY_TARGET === 'cloudflare';
const configuredOrigin = new URL(process.env.SITE_URL || 'https://huaoblog.cn');
const allowedDomains = [
  { protocol: configuredOrigin.protocol.slice(0, -1), hostname: configuredOrigin.hostname },
  { protocol: 'https', hostname: 'huaoblog.cn' },
  { protocol: 'https', hostname: 'www.huaoblog.cn' },
  { protocol: 'https', hostname: 'huaoblog-app.huaoqaq.workers.dev' },
  ...(!cloudflareTarget ? [{ protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'http', hostname: 'localhost' }] : []),
];
const adapter = cloudflareTarget
  ? (await import('@astrojs/cloudflare')).default({ imageService: 'passthrough' })
  : (await import('@astrojs/node')).default({ mode: 'standalone' });
const redirects = Object.fromEntries(readFileSync(new URL('./public/_redirects', import.meta.url), 'utf8')
  .split('\n').filter(line => line.trim() && !line.startsWith('#')).map(line => {
    const [from, destination, status] = line.trim().split(/\s+/);
    return [from.replace(/\/$/, '') || '/', { destination, status: Number(status) }];
  }));

export default defineConfig({
  output: 'server',
  adapter,
  session: false,
  security: { allowedDomains },
  redirects,
  site: process.env.SITE_URL || process.env.CF_PAGES_URL || undefined,
  devToolbar: { enabled: false },
  compressHTML: true,
  markdown: {
    processor: unified({ remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }),
  },
  vite: {
    resolve: {
      alias: { '#content-runtime': fileURLToPath(new URL(`./src/server/runtime-${cloudflareTarget ? 'cloudflare' : 'node'}.js`, import.meta.url)) },
    },
    server: { strictPort: true },
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['three'],
    },
  },
});
