import assert from 'node:assert/strict';
import {
  cleanAiNoteText,
  cleanLegacyNoteDocument,
  textDocument,
  documentText,
} from '../../shared/note-document.mjs';
import test from 'node:test';
test('清理早期 AI 笔记的标题、加粗与列表标记', () => {
  const doc = cleanLegacyNoteDocument(textDocument('# 学习笔记\n**重要概念**\n* 第一项\n- 第二项'));
  assert.equal(documentText(doc), '学习笔记\n重要概念\n• 第一项\n• 第二项');
  assert.deepEqual(cleanLegacyNoteDocument(doc), doc);
});
test('保留运算符、富文本标记和图片来源', () => {
  assert.equal(cleanAiNoteText('a * b = c\nx - y\nC#'), 'a * b = c\nx - y\nC#');
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { important: true, source: { name: '原资料' } },
        content: [{ type: 'text', text: '已有加粗', marks: [{ type: 'bold' }] }],
      },
      { type: 'image', attrs: { attachmentId: 12, src: 'note-image:12' } },
    ],
  };
  const cleaned = cleanLegacyNoteDocument(doc);
  assert.equal(cleaned.content[0].attrs.important, true);
  assert.equal(cleaned.content[0].attrs.source.name, '原资料');
  assert.equal(cleaned.content[0].content[0].marks[0].type, 'bold');
  assert.equal(cleaned.content[1].attrs.attachmentId, 12);
});
test('字号经过保存规范化后保留，非法值被过滤，HTML 输出保留字号', async () => {
  const { normalizeDocument, documentHtml } = await import('../../shared/note-document.mjs');
  const input = textDocument('字号文字');
  input.content[0].content[0].marks = [{ type: 'fontSize', attrs: { size: 20 } }, { type: 'bold' }];
  const doc = normalizeDocument(input);
  assert.equal(doc.content[0].content[0].marks[0].attrs.size, 20);
  assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.match(documentHtml(doc), /font-size:20px/);
  input.content[0].content[0].marks[0].attrs.size = '20;position:fixed';
  assert.deepEqual(normalizeDocument(input).content[0].content[0].marks, [{ type: 'bold' }]);
});
