import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

export default defineConfig({
  site: process.env.SITE_URL || process.env.CF_PAGES_URL || undefined,
  devToolbar: { enabled: false },
  compressHTML: true,
  markdown: {
    processor: unified({ remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }),
  },
  vite: {
    server: { strictPort: true },
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['three'],
    },
  },
});
