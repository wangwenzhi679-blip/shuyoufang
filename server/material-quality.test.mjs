import assert from 'node:assert/strict';
import { hasDamagedFormula } from './material-quality.js';
import { prepareLongContext } from './long-context.js';
for (const text of [
  '矩阵 □ 3 −1 □ □ 4 6□',
  '解矩阵方程 □ − □ X = □ □',
  '内容\ufffd缺失',
  '公式\ue000',
])
  assert.equal(hasDamagedFormula(text), true);
for (const text of [
  '■ 第一条概念',
  '□ 待完成任务',
  '□ 2026 年学习计划',
  '集合 A={1,2,3}',
  '矩阵 [[1,2],[3,4]]',
  '请填写：□',
])
  assert.equal(hasDamagedFormula(text), false);
let calls = 0;
await assert.rejects(
  prepareLongContext('解矩阵方程 □ − □ X = □ □', () => {
    calls++;
  }),
  (error) => error.status === 422 && error.message.includes('原资料'),
);
await assert.rejects(
  prepareLongContext('可读文字'.repeat(6000) + '\n公式\ufffd', () => {
    calls++;
  }),
  (error) => error.status === 422,
);
assert.equal(calls, 0);
assert.equal(
  await prepareLongContext('■ 第一条概念', () => {
    calls++;
  }),
  '■ 第一条概念',
);
console.log(
  'PASS material quality: broken formula rejected before AI, including chapter tail; valid symbols and checklist retained',
);
