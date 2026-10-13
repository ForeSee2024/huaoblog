import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { registerHooks } from 'node:module';
import { CrepeFeature } from '@milkdown/crepe';
import { latex } from '@milkdown/crepe/feature/latex';
import { Clock, Container, Ctx } from '@milkdown/kit/ctx';
import {
  InitReady, editorViewCtx, marksCtx, nodesCtx, remarkPluginsCtx,
  remarkStringifyOptionsCtx, schemaCtx,
} from '@milkdown/kit/core';
import { imageBlockSchema, remarkImageBlockPlugin } from '@milkdown/kit/component/image-block';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import {
  codeBlockSchema, docSchema, imageAttr, imageSchema,
  inlineCodeSchema, paragraphSchema, textSchema,
} from '@milkdown/kit/preset/commonmark';
import { Fragment, Schema } from '@milkdown/kit/prose/model';
import { ParserState, SerializerState } from '@milkdown/kit/transformer';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

// Keep Milkdown's real schemas and transformers; replace only the DOM mount.
const events = new EventTarget();
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
  globalThis[name] = events[name].bind(events);
}

class HeadlessCrepe {
  static last;

  constructor(config) {
    HeadlessCrepe.last = this;
    this.config = config;
    this.configurations = [];
    this.extraPlugins = [];
    this.destroyCount = 0;
    this.editor = {
      config: (configure) => { this.configurations.push(configure); return this.editor; },
      use: (plugins) => { this.extraPlugins.push(...[plugins].flat(2)); return this.editor; },
      action: (action) => action(this.ctx),
    };
  }

  on(register) {
    register({ markdownUpdated: (callback) => { this.listener = callback; } });
    return this;
  }

  async create() {
    this.ctx = new Ctx(new Container(), new Clock());
    const ctx = this.ctx;
    ctx.inject(nodesCtx, []).inject(marksCtx, []).inject(remarkPluginsCtx, [])
      .inject(remarkStringifyOptionsCtx, {}).record(InitReady);
    const initialized = ctx.wait(InitReady);
    ctx.done(InitReady);
    await initialized;
    const plugins = [
      docSchema, textSchema, paragraphSchema, codeBlockSchema,
      imageAttr, imageSchema, inlineCodeSchema, uploadConfig,
    ].flat();
    if (this.config.features[CrepeFeature.ImageBlock]) {
      plugins.push(...imageBlockSchema, ...remarkImageBlockPlugin);
    }
    if (this.config.features[CrepeFeature.Latex]) {
      latex({
        config() { return this; },
        use(feature) {
          if (Array.isArray(feature) && (feature.node || feature.options)) plugins.push(...feature);
          return this;
        },
      });
    }
    plugins.push(...this.extraPlugins);
    const runners = plugins.map((plugin) => plugin(ctx));
    for (const run of runners) await run();
    this.schema = new Schema({
      nodes: Object.fromEntries(ctx.get(nodesCtx)),
      marks: Object.fromEntries(ctx.get(marksCtx)),
    });
    ctx.inject(schemaCtx, this.schema);
    const remark = ctx.get(remarkPluginsCtx).reduce(
      (processor, { plugin, options }) => processor.use(plugin, options),
      unified().use(remarkParse).use(remarkStringify, { fences: true }),
    );
    this.parse = ParserState.create(this.schema, remark);
    this.serialize = SerializerState.create(this.schema, remark);
    this.view = {
      state: { doc: this.parse(this.config.defaultValue) },
      dom: { setAttribute() {} },
      focus() {},
    };
    ctx.inject(editorViewCtx, this.view);
    for (const configure of this.configurations) configure(ctx);
  }

  getMarkdown() { return this.serialize(this.view.state.doc); }
  async destroy() { this.destroyCount += 1; }
  appendText(text) {
    const paragraph = this.schema.nodes.paragraph.create(null, this.schema.text(text));
    this.view.state.doc = this.view.state.doc.copy(this.view.state.doc.content.append(Fragment.from(paragraph)));
  }
}

globalThis.articleEditorTestCrepe = HeadlessCrepe;
globalThis.articleEditorTestFeatures = CrepeFeature;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@milkdown/crepe' && context.parentURL?.endsWith('/src/admin/article-editor.js')) {
      const source = 'export const Crepe = globalThis.articleEditorTestCrepe; export const CrepeFeature = globalThis.articleEditorTestFeatures;';
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
after(() => hooks.deregister());
const { createArticleEditor } = await import('../src/admin/article-editor.js');

test('body edits retain image alt/title, inline and display math, and code fences', async () => {
  const inline = String.raw`\frac{1}{2} + x_i^2`;
  const display = String.raw`\int_0^1 x^2 \, dx = \frac{1}{3}`;
  const aligned = String.raw`\begin{aligned}a &= b + c \\ d &= e\end{aligned}`;
  const code = 'const price = "$25";\nconsole.log("$$ untouched", price);';
  const value = [
    '正文 $' + inline + '$ 与行内 `x = "$5"`。', '',
    '$$', display, '$$', '', '$$', aligned, '$$', '',
    '```javascript', code, '```', '',
    '![用于屏幕阅读器的图片描述](/images/posts/demo.png "图片标题")', '',
  ].join('\n');
  const changes = [];
  const editor = await createArticleEditor({}, { value, onChange: (markdown) => changes.push(markdown) });
  const native = HeadlessCrepe.last;
  const original = native.view.state.doc;
  assert.equal(editor.getMarkdown(), value);
  assert.deepEqual(changes, []);
  native.appendText('修改正文');
  const output = editor.getMarkdown();
  assert.ok(output.includes('$' + inline + '$'));
  assert.ok(output.includes('$$\n' + display + '\n$$'));
  assert.ok(output.includes('$$\n' + aligned + '\n$$'));
  assert.ok(output.includes('```javascript\n' + code + '\n```'));
  assert.ok(output.includes('![用于屏幕阅读器的图片描述](/images/posts/demo.png "图片标题")'));
  const retained = (doc) => {
    const data = [];
    doc.descendants((node) => {
      if (['math_inline', 'code_block', 'image'].includes(node.type.name)) {
        data.push({ type: node.type.name, attrs: node.attrs, content: node.textContent });
      }
    });
    return data;
  };
  assert.deepEqual(retained(native.parse(output)), retained(original));
  native.listener(native.ctx, output);
  assert.deepEqual(changes, [output]);
  await editor.destroy();
});

test('uploads keep canonical model URLs while resolving only rendered image sources', async () => {
  const uploadedFiles = [];
  const editor = await createArticleEditor({}, {
    value: '![原有描述](/images/posts/legacy.png)\n',
    onUpload: async (file) => { uploadedFiles.push(file); return '/images/posts/photo.png'; },
    resolveImage: (path) => `blob:https://example.test/${encodeURIComponent(path)}`,
  });
  const native = HeadlessCrepe.last;
  const file = { type: 'image/png', name: '山间日落.png' };
  const config = native.ctx.get(uploadConfig.key);
  const [image] = await config.uploader([file], native.schema, native.ctx, 1);
  assert.deepEqual(uploadedFiles, [file]);
  assert.equal(image.attrs.src, '/images/posts/photo.png');
  assert.equal(image.attrs.alt, '山间日落');
  const [, attributes] = image.type.spec.toDOM(image);
  assert.match(attributes.src, /^blob:/);
  assert.equal(attributes['data-article-image-src'], image.attrs.src);
  const reparsedAttrs = image.type.spec.parseDOM[0].getAttrs({
    getAttribute: (name) => attributes[name] ?? null,
  });
  assert.equal(reparsedAttrs.src, image.attrs.src);
  assert.equal(reparsedAttrs.alt, image.attrs.alt);
  native.view.state.doc = native.schema.nodes.doc.create(null,
    native.schema.nodes.paragraph.create(null, native.schema.nodes.image.create(reparsedAttrs)));
  assert.ok(editor.getMarkdown().includes('![山间日落](/images/posts/photo.png)'));
  assert.ok(!editor.getMarkdown().includes('blob:'));
  await editor.destroy();
});

test('destroy is idempotent and retains the final synchronous markdown snapshot', async () => {
  const editor = await createArticleEditor({}, { value: '初稿\n' });
  const native = HeadlessCrepe.last;
  native.appendText('尚未触发监听的最后输入');
  const finalMarkdown = editor.getMarkdown();
  const destruction = editor.destroy();
  assert.equal(editor.destroy(), destruction);
  await destruction;
  assert.equal(native.destroyCount, 1);
  assert.equal(editor.getMarkdown(), finalMarkdown);
  assert.throws(() => editor.insertMarkdown('新的输入'), /编辑器已关闭/);
});
