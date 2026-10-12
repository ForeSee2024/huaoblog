/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'cyber-base': 'var(--bg-base)',
        'cyber-surface': 'var(--bg-surface)',
        'cyber-elevated': 'var(--bg-surface-elevated)',
        'cyber-card': 'var(--bg-card)',
        'cyber-accent': 'var(--accent)',
        'cyber-accent-soft': 'var(--accent-soft)',
        'cyber-accent-contrast': 'var(--accent-contrast)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
        serif: ['Cinzel', 'Noto Sans SC', 'serif'],
      },
    },
  },
  plugins: [],
};
