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
