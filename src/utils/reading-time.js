/**
 * 统计中英混合技术文章的有效字数与预计阅读时间，并提取代码块安全的 Markdown 大纲。
 */
export function estimateReadingStats(source = '') {
  const raw = String(source || '');
  if (!raw.trim()) {
    return { words: 0, minutes: 1, label: '约 1 分钟阅读' };
  }

  let codeLines = 0;
  const withoutCode = raw.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
    if (inner.trim()) codeLines += inner.split('\n').length;
    return ' ';
  });

  const plain = withoutCode
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/`[^`\n]+`/g, (match) => match.slice(1, -1))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ');

  const cjkMatches = plain.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const latinWords = plain
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  const latinCount = latinWords ? latinWords.length : 0;

  const words = cjkCount + latinCount;
  const readingMinutes = (cjkCount / 320) + (latinCount / 200) + (codeLines / 18);
  const minutes = Math.max(1, Math.ceil(readingMinutes));
  return {
    words,
    minutes,
    label: `约 ${minutes} 分钟阅读`,
  };
}

/**
 * 提取 Markdown H1-H3 标题（自动跳过围栏代码块内部的 # 注释）。
 */
export function extractMarkdownHeadings(source = '') {
  const lines = String(source || '').split(/\r?\n/);
  const headings = [];
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (match) {
      const text = match[2]
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .trim();
      if (text) {
        headings.push({
          depth: match[1].length,
          text,
          line: i + 1,
        });
      }
    }
  }
  return headings;
}

/**
 * 根据文章标题与日期建议合法的 URL slug（仅含小写字母、数字和连字符）。
 */
export function suggestSlugFromTitle(title = '', pubDate = '') {
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(String(pubDate))
    ? String(pubDate)
    : new Date().toISOString().slice(0, 10);
  const ascii = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (ascii.length >= 3) {
    return ascii.slice(0, 96).replace(/-+$/g, '');
  }
  const suffix = ascii ? `${ascii}-` : '';
  const random = Math.random().toString(36).slice(2, 8);
  return `${datePart}-${suffix}post-${random}`.slice(0, 96);
}
