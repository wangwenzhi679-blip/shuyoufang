import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLongContext } from './long-context.js';

const text = '资料章节与知识范围。'.repeat(2100);

test('分段返回超长时完整保留返回并压缩一次，成功后继续生成上下文', async () => {
  let retries = 0;
  const result = await prepareLongContext(
    text,
    async (messages) => {
      const previous = messages.find((message) => message.role === 'assistant');
      if (!previous) return '片段开头' + '资料说明'.repeat(1600) + '片段末尾';
      retries++;
      assert.ok(previous.content.startsWith('片段开头'));
      assert.ok(previous.content.endsWith('片段末尾'));
      return '章节主题、知识范围与片段末尾要点';
    },
    undefined,
    { purpose: 'outline' },
  );
  assert.ok(retries > 0);
  assert.ok(result.includes('片段末尾要点'));
});

test('持续扩写时有限失败，不截断后伪装成功', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      prepareLongContext(text, async () => {
        calls++;
        return '资料说明'.repeat(4000);
      }),
    /未能缩减/,
  );
  assert.ok(calls <= 4, `调用次数应受两个并发片段及单次重试约束：${calls}`);
});

test('超过六千字但已有效压缩的片段可参与后续整理', async () => {
  const result = await prepareLongContext(text, async (_messages, _signal, options) => {
    assert.ok(options.maxOutputTokens > 0);
    assert.equal(options.thinking, false);
    return '资料要点'.repeat(1600);
  });
  assert.ok(result.includes('资料要点'));
  assert.ok(result.length < text.length);
});

test('接口截断时从原资料重试，不将不完整回答加入上下文', async () => {
  let initial = 0;
  const result = await prepareLongContext(text, async (messages, _signal, options) => {
    assert.equal(options.thinking, false);
    if (options.maxOutputTokens === 2048) {
      initial++;
      throw Object.assign(new Error('truncated'), { code: 'AI_OUTPUT_LIMIT' });
    }
    assert.equal(options.maxOutputTokens, 4096);
    assert.equal(
      messages.some((message) => message.role === 'assistant'),
      false,
    );
    return '完整片段要点';
  });
  assert.ok(initial > 0);
  assert.ok(result.includes('完整片段要点'));
});

test('取消在压缩重试前生效，不继续请求模型', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(() =>
    prepareLongContext(
      text,
      async () => {
        calls++;
        controller.abort();
        return '资料说明'.repeat(1600);
      },
      controller.signal,
    ),
  );
  assert.equal(calls, 1);
});

test('空整理结果仍拒绝，不进入重试或写入缓存', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      prepareLongContext(text, async () => {
        calls++;
        return '';
      }),
    /结果无效/,
  );
  assert.ok(calls <= 2);
});
