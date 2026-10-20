import assert from 'node:assert/strict';
import { sliceChapterText as slice } from './chapter-text.mjs';
const first = '第1章 学习内容',
  second = '第2章 学习内容';
const text =
  first + '\n' + '第一章原文。'.repeat(20) + '\n' + second + '\n' + '第二章原文。'.repeat(20);
const result = slice(text, { title: first }, [{ title: second }]);
assert.ok(result.includes('第一章原文'));
assert.ok(!result.includes('第二章原文'));
assert.ok(slice(text, { title: second }, []).startsWith(second));
const withContents = `目录\n${first}…… 1\n${second}...... 8\n\n${text}`;
const body = slice(withContents, { title: first }, [{ title: second }]);
assert.ok(body.includes('第一章原文'));
assert.ok(!body.includes('第二章原文'));
assert.ok(!body.includes('…… 1'));
const mentionedNext = `前言提到${second}。\n${text}`;
assert.ok(!slice(mentionedNext, { title: first }, [{ title: second }]).includes('第二章原文'));
assert.equal(slice(text, { title: '不存在的章节' }, []), null);
console.log('PASS chapter slicing: identical names keep chapter-number boundaries');

const undotted = `目录\n${first} 1\n${second} 8\n${text}`;
assert.ok(!slice(undotted, { title: first }, [{ title: second }]).includes('学习内容 1'));
assert.ok(!slice(text, { title: first }, []).includes('第二章原文'));
const cited = `前言提到${first}，请阅读正文。\n${text}`;
assert.ok(slice(cited, { title: first }, []).startsWith(first));
const spaced = `第一章 学 习 内 容\n${'第一章原文。'.repeat(20)}\n第二章 学习内容\n${'第二章原文。'.repeat(20)}`;
assert.ok(!slice(spaced, { title: first }, []).includes('第二章原文'));
assert.equal(slice('相关文字：学习内容的一些讨论。'.repeat(30), { title: first }, []), null);
console.log(
  'PASS: undotted contents, complete heading, Chinese chapter numbers and missing next course chapter',
);

const annotatedText = [
  '目录',
  '子路、曾皙、冉有、公西华侍坐 /《论语》 2',
  '* 齐桓晋文之事 /《孟子》 4',
  '子路、曾皙、冉有、公西华侍坐 a',
  '《论语》',
  '第一篇课文正文。'.repeat(20),
  '* 齐桓晋文之事 a',
  '《孟子》',
  '第二篇课文正文。'.repeat(20),
].join('\n');
const annotated = slice(annotatedText, { title: '子路、曾皙、冉有、公西华侍坐' }, [
  { title: '齐桓晋文之事' },
]);
assert.ok(annotated.startsWith('子路、曾皙、冉有、公西华侍坐 a'));
assert.ok(annotated.includes('第一篇课文正文'));
assert.ok(!annotated.includes('第二篇课文正文'));
assert.ok(!annotated.includes('/《论语》 2'));
assert.equal(
  slice('正文提及齐桓晋文之事 a\n' + '正文。'.repeat(40), { title: '齐桓晋文之事' }, []),
  null,
);
const variableTitle = '函数 a\n' + '函数正文。'.repeat(20);
assert.ok(slice(variableTitle, { title: '函数 a' }, []).startsWith('函数 a'));
assert.equal(slice(variableTitle, { title: '函数' }, []), null);
console.log(
  'PASS: annotated textbook headings keep the original lesson boundary and reject body mentions',
);
