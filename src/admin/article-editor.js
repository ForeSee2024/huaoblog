import { EditorView as CodeMirrorView } from '@codemirror/view';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import { editorViewCtx } from '@milkdown/kit/core';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import {
  createCodeBlockCommand,
  imageAttr,
  imageSchema,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { Decoration } from '@milkdown/kit/prose/view';
import { callCommand, insert } from '@milkdown/kit/utils';

const commands = {
  bold: [toggleStrongCommand.key],
  italic: [toggleEmphasisCommand.key],
  heading: [wrapInHeadingCommand.key, 2],
  list: [wrapInBulletListCommand.key],
  ordered: [wrapInOrderedListCommand.key],
  quote: [wrapInBlockquoteCommand.key],
  code: [createCodeBlockCommand.key],
};

/** Mount the article body editor. Uploads must return a persistent public URL. */
export async function createArticleEditor(element, { value = '', onChange, onUpload, resolveImage } = {}) {
  const originalMarkdown = value;
  let markdown = value;
  let lastChange = value;
  let initialDoc;
  let ready = false;
  let destroyPromise;

  const uploadImage = async (file) => {
    if (typeof onUpload !== 'function') throw new Error('尚未配置图片上传');
    const path = await onUpload(file);
    if (typeof path !== 'string' || !path.trim() || /^(?:blob|data):/i.test(path)) {
      throw new Error('图片上传后需要返回可访问的文件地址');
    }
    return path;
  };

  const crepe = new Crepe({
    root: element,
    defaultValue: value,
    features: {
      [CrepeFeature.CodeMirror]: true,
      [CrepeFeature.ImageBlock]: false,
      [CrepeFeature.Table]: true,
      [CrepeFeature.Latex]: true,
      [CrepeFeature.Toolbar]: true,
      [CrepeFeature.BlockEdit]: true,
      [CrepeFeature.TopBar]: false,
      [CrepeFeature.AI]: false,
    },
    featureConfigs: {
      [CrepeFeature.Placeholder]: {
        text: '开始写作，输入 / 插入内容…',
        mode: 'doc',
      },
      [CrepeFeature.Toolbar]: {
        boldLabel: '加粗',
        italicLabel: '斜体',
        strikethroughLabel: '删除线',
        codeLabel: '行内代码',
        latexLabel: '行内公式',
        linkLabel: '链接',
      },
      [CrepeFeature.LinkTooltip]: {
        inputPlaceholder: '粘贴链接地址…',
        editButton: '编辑',
        removeButton: '移除',
        confirmButton: '确认',
      },
      [CrepeFeature.CodeMirror]: {
        theme: CodeMirrorView.theme({
          '&': { color: 'var(--crepe-color-on-surface)', backgroundColor: 'transparent' },
          '.cm-gutters': { color: 'var(--crepe-color-on-surface-variant)', backgroundColor: 'transparent' },
        }),
        searchPlaceholder: '搜索代码语言…',
        noResultText: '没有匹配的语言',
        copyText: '复制',
        previewLabel: '预览',
        previewLoading: '加载中…',
        previewToggleText: (previewOnly) => previewOnly ? '编辑' : '收起预览',
      },
      [CrepeFeature.Latex]: {
        inlineEditConfirm: '确认',
        katexOptions: { throwOnError: false, trust: false },
      },
      [CrepeFeature.BlockEdit]: {
        textGroup: {
          label: '文本',
          text: { label: '正文' },
          h1: { label: '一级标题' },
          h2: { label: '二级标题' },
          h3: { label: '三级标题' },
          h4: { label: '四级标题' },
          h5: { label: '五级标题' },
          h6: { label: '六级标题' },
          quote: { label: '引用' },
          divider: { label: '分隔线' },
        },
        listGroup: {
          label: '列表',
          bulletList: { label: '无序列表' },
          orderedList: { label: '有序列表' },
          taskList: { label: '任务列表' },
        },
        advancedGroup: {
          label: '插入',
          image: null,
          codeBlock: { label: '代码块' },
          table: { label: '表格' },
          math: { label: '公式' },
        },
      },
    },
  });

  if (typeof resolveImage === 'function') {
    crepe.editor.use(imageSchema.extendSchema((previous) => (ctx) => {
      const schema = previous(ctx);
      return {
        ...schema,
        parseDOM: [{
          tag: 'img[data-article-image-src]',
          priority: 100,
          getAttrs: (image) => ({
            src: image.getAttribute('data-article-image-src') || '',
            alt: image.getAttribute('alt') || '',
            title: image.getAttribute('title') || '',
          }),
        }, ...schema.parseDOM],
        toDOM: (node) => ['img', {
          ...ctx.get(imageAttr.key)(node),
          ...node.attrs,
          src: resolveImage(node.attrs.src) || node.attrs.src,
          'data-article-image-src': node.attrs.src,
        }],
      };
    }));
  }

  crepe.editor.config((ctx) => {
    ctx.update(imageAttr.key, (attributes) => (node) => ({
      ...attributes(node),
      class: 'article-editor-image',
    }));
    ctx.update(uploadConfig.key, (config) => ({
      ...config,
      enableHtmlFileUploader: true,
      getInsertPos: (_event, uploadCtx, position) => {
        const resolved = uploadCtx.get(editorViewCtx).state.doc.resolve(position);
        return resolved.parent.type.spec.code ? resolved.after() : position;
      },
      uploader: async (files, schema, uploadCtx, position) => {
        const parent = uploadCtx.get(editorViewCtx).state.doc.resolve(position).parent;
        const images = await Promise.all(
          Array.from(files)
            .filter((file) => file.type.startsWith('image/'))
            .map(async (file) => schema.nodes.image.create({
              src: await uploadImage(file),
              alt: file.name.replace(/\.[^.]+$/, ''),
            })),
        );
        if (!images.length) return [];
        return parent.inlineContent ? images : [schema.nodes.paragraph.create(null, images)];
      },
      uploadWidgetFactory: (position, spec) => {
        const status = document.createElement('span');
        status.className = 'article-image-upload';
        status.setAttribute('role', 'status');
        status.textContent = '正在上传图片…';
        return Decoration.widget(position, status, spec);
      },
    }));
  });

  crepe.on((listener) => {
    listener.markdownUpdated((ctx, nextMarkdown) => {
      if (!ready) return;
      const doc = ctx.get(editorViewCtx).state.doc;
      markdown = initialDoc.eq(doc) ? originalMarkdown : nextMarkdown;
      if (markdown === lastChange) return;
      lastChange = markdown;
      onChange?.(markdown);
    });
  });

  await crepe.create();
  initialDoc = crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
  crepe.editor.action((ctx) => {
    ctx.get(editorViewCtx).dom.setAttribute('aria-label', '文章正文');
  });
  ready = true;

  const requireReady = () => {
    if (!ready) throw new Error('编辑器已关闭');
  };

  const getMarkdown = () => {
    if (!ready) return markdown;
    const doc = crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
    // Read synchronously: the markdownUpdated listener is debounced by Milkdown.
    markdown = initialDoc.eq(doc) ? originalMarkdown : crepe.getMarkdown();
    return markdown;
  };

  return {
    getMarkdown,
    insertMarkdown(content) {
      requireReady();
      return crepe.editor.action((ctx) => {
        ctx.get(editorViewCtx).focus();
        insert(content, true)(ctx);
        ctx.get(editorViewCtx).focus();
      });
    },
    command(name) {
      requireReady();
      if (!Object.hasOwn(commands, name)) throw new Error(`未知编辑命令：${name}`);
      const [key, payload] = commands[name];
      return crepe.editor.action((ctx) => {
        ctx.get(editorViewCtx).focus();
        return callCommand(key, payload)(ctx);
      });
    },
    destroy() {
      if (destroyPromise) return destroyPromise;
      getMarkdown();
      ready = false;
      destroyPromise = crepe.destroy();
      return destroyPromise;
    },
  };
}
