import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer } from './wrong-review.js';
import { validGeneratedQuestions } from './generated-questions.js';
import { answerLetters, optionLetter, questionTypeLabel } from '../shared/question-types.mjs';

const judgment = (answer) => ({
  question_type: '判断题',
  options_json: ['正确', '错误'],
  answer_text: answer,
});

test('生成器允许的中文判断题标准答案能用界面选项字母判分', () => {
  for (const [text, right, wrong] of [
    ['正确', 'A', 'B'],
    ['错误', 'B', 'A'],
  ]) {
    const generated = { type: '判断题', options: ['正确', '错误'], answer: text };
    assert.equal(validGeneratedQuestions([generated]), true);
    assert.deepEqual(generated.options.map(optionLetter), ['A', 'B']);
    assert.deepEqual(answerLetters(text, generated.options, generated.type), [right]);
    assert.deepEqual(gradeAnswer(judgment(text), [right]), { answered: true, correct: true });
    assert.deepEqual(gradeAnswer(judgment(text), [wrong]), { answered: true, correct: false });
    assert.deepEqual(gradeAnswer(judgment(text), []), { answered: false, correct: false });
  }
});

test('已存判断题支持文字和字母答案，且按选项顺序或明确字母对应', () => {
  for (const expected of ['正确', 'A']) {
    const question = judgment(expected);
    for (const answer of [['A'], ['a'], ['正确'], 'A', '正确'])
      assert.equal(gradeAnswer(question, answer).correct, true);
    for (const answer of [['B'], ['错误'], ['A', 'B'], ['A', '未知'], ['C'], '错误'])
      assert.equal(gradeAnswer(question, answer).correct, false);
  }
  const reversed = { ...judgment('正确'), options_json: JSON.stringify(['错误', '正确']) };
  assert.equal(gradeAnswer(reversed, ['B']).correct, true);
  assert.equal(gradeAnswer(reversed, ['A']).correct, false);
  const labelled = { ...judgment('正确'), options_json: ['B. 正确', 'A. 错误'] };
  assert.equal(gradeAnswer(labelled, ['B']).correct, true);
  assert.equal(gradeAnswer(labelled, ['A']).correct, false);
  assert.equal(gradeAnswer(judgment('正确 B'), ['B']).correct, false);
});

test('旧单选和多选仍要求答案字母集合完整匹配，不猜未知题型', () => {
  const options = ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'];
  assert.equal(questionTypeLabel('choice'), '单选题');
  assert.equal(questionTypeLabel('true_false'), 'true_false');
  assert.equal(
    gradeAnswer({ question_type: 'choice', options_json: options, answer_text: 'A' }, ['A'])
      .correct,
    true,
  );
  assert.equal(
    gradeAnswer({ question_type: 'choice', options_json: options, answer_text: 'A' }, ['B'])
      .correct,
    false,
  );
  const multiple = { question_type: '多选题', options_json: options, answer_text: 'AC' };
  assert.equal(gradeAnswer(multiple, ['C', 'A']).correct, true);
  assert.equal(gradeAnswer(multiple, ['A']).correct, false);
  assert.equal(gradeAnswer(multiple, ['A', 'B', 'C']).correct, false);
  assert.equal(
    gradeAnswer({ ...judgment('正确'), question_type: 'true_false' }, ['A']).correct,
    false,
  );
});

test('无选项的数学文字和主观题保留原来去首尾空格与大小写比对', () => {
  for (const type of ['填空题', '简答题', '判断题', 'unknown']) {
    const question = { question_type: type, options_json: [], answer_text: 'x = 2' };
    assert.equal(gradeAnswer(question, ' X = 2 ').correct, true);
    assert.equal(gradeAnswer(question, '2').correct, false);
    assert.deepEqual(gradeAnswer(question, ''), { answered: false, correct: false });
  }
  assert.equal(
    gradeAnswer({ question_type: '简答题', options_json: [], answer_text: '正确' }, '错误').correct,
    false,
  );
});
