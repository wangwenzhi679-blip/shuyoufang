const blocks = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'horizontalRule',
  'image',
]);
const marks = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'fontSize']);
export const textDocument = (text) => ({
  type: 'doc',
  content: String(text || '')
    .split('\n')
    .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
});
export function normalizeDocument(input) {
  let count = 0;
  function visit(node, depth = 0) {
    if (++count > 12000 || depth > 20 || !node || typeof node !== 'object')
      throw new Error('笔记结构过大或不正确');
    if (node.type === 'text')
      return {
        type: 'text',
        text: String(node.text || '').slice(0, 100000),
        ...(node.marks?.length
          ? {
              marks: node.marks
                .filter(
                  (mark) =>
                    marks.has(mark.type) &&
                    (mark.type !== 'fontSize' ||
                      [12, 14, 16, 18, 20, 24, 28, 32].includes(Number(mark.attrs?.size))),
                )
                .map((mark) =>
                  mark.type === 'fontSize'
                    ? { type: mark.type, attrs: { size: Number(mark.attrs.size) } }
                    : { type: mark.type },
                ),
            }
          : {}),
      };
    if (node.type === 'hardBreak') return { type: 'hardBreak' };
    if (node.type !== 'doc' && !blocks.has(node.type)) throw new Error('不支持的笔记格式');
    const attrs = node.attrs || {};
    const result = { type: node.type };
    if (node.type !== 'doc') {
      result.attrs = {
        noteId: /^[\w-]{1,80}$/.test(attrs.noteId || '') ? attrs.noteId : null,
        important: attrs.important === true,
        question: attrs.question === true,
        resolved: attrs.resolved === true,
      };
      if (attrs.source && typeof attrs.source === 'object')
        result.attrs.source = {
          name: String(attrs.source.name || '').slice(0, 200),
          materialId:
            Number.isSafeInteger(Number(attrs.source.materialId)) &&
            Number(attrs.source.materialId) > 0
              ? Number(attrs.source.materialId)
              : null,
          page:
            Number.isSafeInteger(Number(attrs.source.page)) && Number(attrs.source.page) > 0
              ? Number(attrs.source.page)
              : null,
          date: String(attrs.source.date || '').slice(0, 40),
          fingerprint: String(attrs.source.fingerprint || '').slice(0, 100),
        };
      if (node.type === 'heading') result.attrs.level = attrs.level === 2 ? 2 : 1;
      if (node.type === 'orderedList')
        result.attrs.start = Math.max(1, Math.min(10000, Number(attrs.start) || 1));
      if (node.type === 'image') {
        const id = Number(attrs.attachmentId || String(attrs.src || '').replace('note-image:', ''));
        if (!Number.isSafeInteger(id) || id < 1) throw new Error('图片引用不正确');
        Object.assign(result.attrs, {
          attachmentId: id,
          src: `note-image:${id}`,
          alt: String(attrs.alt || '').slice(0, 500),
          width: Math.max(20, Math.min(100, Number(attrs.width) || 100)),
        });
      }
    }
    if (node.content) result.content = node.content.map((child) => visit(child, depth + 1));
    return result;
  }
  if (input?.type !== 'doc') throw new Error('笔记必须为文档');
  return visit(input);
}
export function documentText(doc) {
  function text(node) {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'image') return node.attrs?.alt ? `[图片：${node.attrs.alt}]` : '[图片]';
    const content = (node.content || [])
      .map(text)
      .join(
        ['doc', 'bulletList', 'orderedList', 'blockquote', 'listItem'].includes(node.type)
          ? '\n'
          : '',
      );
    return content;
  }
  return text(doc);
}
export function attachmentIds(doc) {
  const ids = new Set();
  function visit(node) {
    if (node.type === 'image') ids.add(Number(node.attrs.attachmentId));
    (node.content || []).forEach(visit);
  }
  visit(doc);
  return [...ids];
}
export function appendExcerpt(doc, text, source) {
  const fingerprint = source?.fingerprint || '';
  if (fingerprint && JSON.stringify(doc).includes(`"fingerprint":"${fingerprint}"`))
    throw new Error('这段内容已加入笔记');
  return normalizeDocument({
    type: 'doc',
    content: [
      ...(doc.content || []),
      { type: 'blockquote', attrs: { source }, content: textDocument(text).content },
    ],
  });
}
export function replaceOrdinaryText(doc, text) {
  // 图片、引用和用户标记的整个顶层块保留，避免丢失关联信息。
  function protectedBlock(node) {
    return (
      node.type === 'image' ||
      node.attrs?.source ||
      node.attrs?.important ||
      node.attrs?.question ||
      (node.content || []).some(protectedBlock)
    );
  }
  const protectedNodes = doc.content.filter(protectedBlock);
  return normalizeDocument({
    type: 'doc',
    content: [...textDocument(text).content, ...protectedNodes],
  });
}
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
export function documentHtml(doc, imageUrl = (id) => `images/${id}`) {
  function render(node) {
    if (node.type === 'text')
      return (node.marks || []).reduce(
        (value, mark) =>
          mark.type === 'fontSize'
            ? `<span style="font-size:${mark.attrs.size}px">${value}</span>`
            : `<${{ bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u' }[mark.type]}>${value}</${{ bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u' }[mark.type]}>`,
        escapeHtml(node.text),
      );
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr>';
    const inner = (node.content || []).map(render).join('');
    if (node.type === 'doc') return inner;
    const attrs = node.attrs || {};
    const label = [
      attrs.important && '重点',
      attrs.question && (attrs.resolved ? '疑问已解决' : '疑问'),
    ]
      .filter(Boolean)
      .join(' · ');
    const source = attrs.source
      ? `<small>${escapeHtml(attrs.source.name)}${attrs.source.page ? ` · 第 ${attrs.source.page} 页` : ''}</small>`
      : '';
    if (node.type === 'image')
      return `<figure><img src="${escapeHtml(imageUrl(attrs.attachmentId))}" style="max-width:100%;width:${attrs.width}%"><figcaption>${escapeHtml(attrs.alt || '')} ${escapeHtml(label)}</figcaption></figure>`;
    const tag = {
      paragraph: 'p',
      heading: `h${attrs.level || 1}`,
      blockquote: 'blockquote',
      bulletList: 'ul',
      orderedList: 'ol',
      listItem: 'li',
    }[node.type];
    return `<${tag}>${label ? `<small>${escapeHtml(label)}</small>` : ''}${inner}${source}</${tag}>`;
  }
  return render(doc);
}
export function documentMarkdown(doc, imageUrl = (id) => `images/${id}`) {
  function render(node) {
    if (node.type === 'text')
      return (node.marks || []).reduce(
        (value, mark) =>
          mark.type === 'bold'
            ? `**${value}**`
            : mark.type === 'italic'
              ? `*${value}*`
              : mark.type === 'code'
                ? `\`${value}\``
                : mark.type === 'strike'
                  ? `~~${value}~~`
                  : value,
        node.text.replace(/([\\`*_[\]])/g, '\\$1'),
      );
    if (node.type === 'hardBreak') return '  \n';
    if (node.type === 'horizontalRule') return '\n---\n';
    const inner = (node.content || [])
      .map(render)
      .join(['doc', 'bulletList', 'orderedList', 'listItem'].includes(node.type) ? '\n' : '');
    const attrs = node.attrs || {};
    const label = [
      attrs.important && '重点',
      attrs.question && (attrs.resolved ? '疑问已解决' : '疑问'),
    ]
      .filter(Boolean)
      .join(' · ');
    const source = attrs.source
      ? `\n\n来源：${attrs.source.name}${attrs.source.page ? `，第 ${attrs.source.page} 页` : ''}`
      : '';
    if (node.type === 'image')
      return `\n![${(attrs.alt || '图片').replace(/[\[\]]/g, '')}](${imageUrl(attrs.attachmentId)})${label ? `\n${label}` : ''}\n`;
    if (node.type === 'heading')
      return `${'#'.repeat(attrs.level || 1)} ${label ? `【${label}】` : ''}${inner}${source}\n`;
    if (node.type === 'blockquote')
      return `${inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}${source}\n`;
    if (node.type === 'bulletList' || node.type === 'orderedList')
      return (
        node.content
          .map(
            (child, i) =>
              `${node.type === 'bulletList' ? '-' : `${i + (attrs.start || 1)}.`} ${render(child).trim().replace(/\n/g, '\n  ')}`,
          )
          .join('\n') + '\n'
      );
    if (node.type === 'paragraph') return `${label ? `【${label}】` : ''}${inner}${source}\n`;
    return inner;
  }
  return render(doc);
}

// 仅用于 AI 笔记输出：去掉成对格式标记，不删除正文中的运算符。
export function cleanAiNoteText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\s*```(?:markdown|md|text)?\s*\n([\s\S]*?)\n\s*```\s*$/i, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '$1')
    .replace(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/^([ \t]*)[-*+][ \t]+(?=\S)/gm, '$1• ')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/(^|[\s（(])\*([^*\n]+?)\*(?=$|[\s，。！？、；：）)])/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1');
}

// 兼容早期以普通段落保存的 AI Markdown，不修改图片、来源和已有富文本样式。
export function cleanLegacyNoteDocument(input) {
  const doc = normalizeDocument(input);
  function visit(node) {
    if (
      node.type === 'paragraph' &&
      node.content?.every((part) => part.type === 'text' && !part.marks?.length)
    ) {
      const original = node.content.map((part) => part.text).join('');
      const text = cleanAiNoteText(original);
      if (text !== original) {
        const heading = original.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
        if (heading)
          return {
            ...node,
            type: 'heading',
            attrs: { ...node.attrs, level: Math.min(2, heading[1].length) },
            content: [{ type: 'text', text }],
          };
        if (/\*\*[^\n]+?\*\*/.test(original)) {
          const content = [];
          let start = 0;
          for (const match of original.matchAll(/\*\*([^\n]+?)\*\*/g)) {
            const prefix = cleanAiNoteText(original.slice(start, match.index));
            if (prefix) content.push({ type: 'text', text: prefix });
            content.push({
              type: 'text',
              text: cleanAiNoteText(match[1]),
              marks: [{ type: 'bold' }],
            });
            start = match.index + match[0].length;
          }
          const tail = cleanAiNoteText(original.slice(start));
          if (tail) content.push({ type: 'text', text: tail });
          return { ...node, content };
        }
        return { ...node, content: text ? [{ type: 'text', text }] : [] };
      }
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  }
  return visit(doc);
}
