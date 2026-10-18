import test from 'node:test';
import assert from 'node:assert/strict';
import { validGeneratedQuestions } from './generated-questions.js';
const choice = { type: '单选题', options: ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'], answer: 'A' };
test('合法题型可供作答', () => {
  assert.equal(
    validGeneratedQuestions([
      choice,
      { ...choice, type: '多选题', answer: 'AC' },
      { type: '判断题', options: ['正确', '错误'], answer: '正确' },
      { type: '简答题', options: [], answer: '说明' },
    ]),
    true,
  );
});
test('拒绝缺失、重复或错位选项及无效答案', () => {
  for (const item of [
    { ...choice, options: choice.options.slice(0, 3) },
    { ...choice, options: ['B. 甲', ...choice.options.slice(1)] },
    { ...choice, options: ['A. 甲', 'B. 甲', 'C. 丙', 'D. 丁'] },
    { ...choice, answer: 'E' },
    { ...choice, type: '多选题', answer: 'AA' },
    { ...choice, type: '多选题', answer: 'BA' },
    { ...choice, type: '多选题', answer: 'A' },
    { type: '判断题', options: ['正确', '错误'], answer: 'A' },
    { type: '填空题', options: ['甲'], answer: '甲' },
  ])
    assert.equal(validGeneratedQuestions([item]), false);
});
