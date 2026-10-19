import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountSchema,
  passwordSchema,
  emailSchema,
  courseSchema,
  questionGenerateSchema,
  practiceProgressSchema,
} from './request-schemas.mjs';

test('账号和密码保留长度边界，邮箱保持规范化', () => {
  for (const length of [8, 16]) {
    assert.equal(accountSchema.parse('a'.repeat(length)).length, length);
    assert.equal(passwordSchema.parse('a'.repeat(length)).length, length);
  }
  for (const length of [7, 17]) {
    assert.equal(accountSchema.safeParse('a'.repeat(length)).success, false);
    assert.equal(passwordSchema.safeParse('a'.repeat(length)).success, false);
  }
  assert.equal(accountSchema.safeParse('账号abcdefgh').success, false);
  assert.equal(emailSchema.parse(' Student@Example.COM '), 'student@example.com');
});

test('课程名称去除空白并保留简介默认值', () => {
  assert.deepEqual(courseSchema.parse({ title: ' 数学 ' }), { title: '数学', description: '' });
  assert.equal(courseSchema.safeParse({ title: '   ' }).success, false);
  assert.equal(courseSchema.safeParse({ title: '数'.repeat(101) }).success, false);
});

test('练习生成限制总题量并保留默认设置', () => {
  const input = {
    chapterId: '1',
    questionCounts: [
      { type: '单选题', count: 10 },
      { type: '多选题', count: 10 },
    ],
  };
  const parsed = questionGenerateSchema.parse(input);
  assert.equal(parsed.chapterId, 1);
  assert.equal(parsed.difficulty, '适中');
  assert.equal(parsed.persist, true);
  assert.equal(parsed.requirements, '');
  const overLimit = questionGenerateSchema.safeParse({
    ...input,
    questionCounts: [...input.questionCounts, { type: '判断题', count: 1 }],
  });
  assert.equal(overLimit.success, false);
  assert.deepEqual(overLimit.error.issues[0].path, ['questionCounts']);
  assert.equal(questionGenerateSchema.safeParse({ ...input, chapterId: 0 }).success, false);
});

test('答题草稿允许空记录和多选答案，拒绝越界或歧义题号', () => {
  assert.equal(practiceProgressSchema.safeParse({ answers: {} }).success, true);
  assert.equal(
    practiceProgressSchema.safeParse({ answers: { 0: 'A', 19: ['A', 'B'] } }).success,
    true,
  );
  for (const key of ['20', '-1', '01', '1.5']) {
    assert.equal(practiceProgressSchema.safeParse({ answers: { [key]: 'A' } }).success, false);
  }
});
