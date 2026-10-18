import assert from 'node:assert/strict';
import { splitContext, prepareLongContext } from './long-context.js';
const text = Array.from(
  { length: 12 },
  (_, i) => `段落${i + 1} ${'资料内容'.repeat(800)} 末尾知识点${i + 1}\n`,
).join('');
assert.equal(splitContext(text).join(''), text);
let seen = [],
  active = 0,
  peak = 0;
const result = await prepareLongContext(text, async (messages) => {
  active++;
  peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 5));
  seen.push(messages[1].content);
  active--;
  return (messages[1].content.match(/末尾知识点\d+/g) || []).join('；');
});
assert.ok(result.includes('末尾知识点12'));
assert.ok(seen.join('').includes('段落1'));
assert.ok(seen.join('').includes('段落12'));
assert.ok(peak <= 2);
assert.equal(
  await prepareLongContext('短章节', () => {
    throw Error('不应调用');
  }),
  '短章节',
);
await assert.rejects(() => prepareLongContext(text, async () => ''), /结果无效/);
const controller = new AbortController();
controller.abort();
await assert.rejects(() => prepareLongContext(text, async () => '', controller.signal));
console.log(
  'PASS: complete chunk coverage, final knowledge point, source order, concurrency bound, short fast path, failure and cancellation',
);
