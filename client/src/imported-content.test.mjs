import test from 'node:test';
import assert from 'node:assert/strict';
import { splitImportedContent } from './imported-content.mjs';

test('冒号题号与冒号选项可分段，不拆小数', () => {
  const result = splitImportedContent(
    '1：第一题 A：甲 B：乙 答案：A 2：第二题 A：丙 B：丁 答案：B',
  );
  assert.equal(result.blocks.length, 2);
  assert.match(result.blocks[0], /\nA\. 甲\nB\. 乙\n答案：A/);
  assert.equal(splitImportedContent('比例为1:2，取值1.25。').blocks.length, 1);
});
test('题内小问不干扰紧挨的下一道选择题', () => {
  const result = splitImportedContent(
    '引言 1.第一题（1）小问 A.甲 B.乙 答案：A 2.第二题 A.丙 B.丁 答案：B',
  );
  assert.equal(result.introduction, '引言');
  assert.equal(result.blocks.length, 2);
  assert.match(result.blocks[0], /（1）小问/);
});

test('同一题的小问保留在一起，下一道题独立展示', () => {
  const result = splitImportedContent(
    '解答题\n1、求解方程\n（1）求齐次解。\n（2）求非齐次解。\n2、计算行列式',
  );
  assert.equal(result.introduction, '解答题');
  assert.equal(result.blocks.length, 2);
  assert.match(result.blocks[0], /（1）.*\n（2）/);
  assert.equal(result.blocks[1], '2、计算行列式');
});
test('紧挨的选择题按题号拆开，选项和答案换行', () => {
  const result = splitImportedContent('1.第一题 A.甲 B.乙 答案：B 2.第二题 A.丙 B.丁 答案：A');
  assert.equal(result.blocks.length, 2);
  assert.match(result.blocks[0], /\nA\. 甲\nB\. 乙\n答案：B/);
});
test('小数和数学表达式不会变成题号', () => {
  const result = splitImportedContent('取值 1.25，与 3.14 比较。');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0], '取值 1.25，与 3.14 比较。');
});
test('仅使用括号编号的资料仍可以分题', () => {
  assert.equal(splitImportedContent('(1)第一题\n(2)第二题').blocks.length, 2);
});
