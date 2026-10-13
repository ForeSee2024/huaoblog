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
  .use(rehypeSanitize, { ...defaultSchema, attributes: { ...defaultSchema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] } })
  .use(rehypeKatex, { throwOnError: false }).use(rehypeHighlight, { detect: false, ignoreMissing: true });

function resolveImages(options) {
  return tree => {
    function walk(node) {
      if (node.type === 'element' && node.tagName === 'img' && typeof node.properties?.src === 'string') {
        if (options.annotate) node.properties.dataPreviewPath = node.properties.src;
        node.properties.src = String(options.resolve(node.properties.src));
      }
      for (const child of node.children || []) walk(child);
    }
    walk(tree);
  };
}
export function renderMarkdownPreview(source, resolveImage = path => path, annotateImages = false) {
  return String(processor().use(resolveImages, { resolve: resolveImage, annotate: annotateImages }).use(rehypeStringify).processSync(source || ''));
}
