import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype)
  .use(rehypeSanitize, { ...defaultSchema, attributes: { ...defaultSchema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] } });

function collectHeadings({ headings }) {
  return tree => {
    const used = new Set();
    const textOf = node => node.type === 'text' ? node.value : (node.children || []).map(textOf).join('');
    function walk(node) {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
        const text = textOf(node);
        const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s+/g, '-') || 'section';
        let slug = base;
        let suffix = 0;
        while (used.has(slug)) slug = `${base}-${++suffix}`;
        used.add(slug);
        node.properties.id = slug;
        headings.push({ depth: Number(node.tagName[1]), slug, text });
      }
      for (const child of node.children || []) walk(child);
    }
    walk(tree);
  };
}

/** Render published Markdown with safe HTML and request-local table of contents. */
export function renderMarkdown(source = '') {
  const headings = [];
  const html = String(processor().use(collectHeadings, { headings })
    .use(rehypeKatex, { throwOnError: false, trust: false })
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(rehypeStringify).processSync(source));
  return { html, headings };
}
