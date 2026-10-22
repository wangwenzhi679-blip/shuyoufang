import test from 'node:test';
import assert from 'node:assert/strict';
import { generateValidated, generationError } from './ai-generation.js';
import { validatePlan, validateGeneratedPlan, today } from './learning-plans.js';

test('统一生成修复一次格式或截断，传递用户模型上下文与足够输出预算', async () => {
  for (const bad of ['{', '', Object.assign(new Error('截断'), { code: 'AI_OUTPUT_LIMIT' })]) {
    const calls = [];
    const value = await generateValidated({
      ask: async (m, s, o) => {
        calls.push({ m, s, o });
        if (calls.length === 1) {
          if (bad instanceof Error) throw bad;
          return bad;
        }
        return '```json\n{"ok":true}\n```';
      },
      messages: [{ role: 'user', content: '资料' }],
      options: { userId: 9 },
      validate: (x) => x,
      maxOutputTokens: 4096,
    });
    assert.equal(value.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].o.maxOutputTokens, 8192);
    assert.equal(calls[1].o.userId, 9);
    assert.equal(calls[1].o.thinking, false);
  }
});
test('鉴权额度限流网络错误及取消不重试，持续无效结果有限失败', async () => {
  for (const status of [401, 402, 429, 502]) {
    let calls = 0;
    await assert.rejects(
      generateValidated({
        ask: async () => {
          calls++;
          throw Object.assign(new Error('service failure'), { status });
        },
        messages: [],
        validate: (x) => x,
      }),
      /service failure/,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    generateValidated({
      ask: async () => {
        calls++;
        return '{}';
      },
      messages: [],
      validate: () => {
        throw new Error('章节无效');
      },
    }),
    /章节无效/,
  );
  assert.equal(calls, 2);
  const controller = new AbortController();
  await assert.rejects(
    generateValidated({
      ask: async () => {
        controller.abort();
        return '{}';
      },
      messages: [],
      signal: controller.signal,
      validate: (x) => x,
    }),
    { name: 'AbortError' },
  );
  assert.equal(
    generationError({ status: 401, message: 'AI 服务鉴权失败' }, 'fallback'),
    'AI 服务鉴权失败。如仍有问题，请联系管理员。',
  );
  assert.equal(
    generationError({ message: 'private database detail' }, 'fallback'),
    'fallback。如仍有问题，请联系管理员。',
  );
});
test('学习计划不存在的章节、非学习日或超期必须修复后才接受', async () => {
  const config = { targetDate: today(), minutes: 30, weekdays: [0, 1, 2, 3, 4, 5, 6] };
  const task = { chapterId: 13, kind: 'read', date: today(), minutes: 20, title: '阅读课文' };
  let count = 0;
  const result = await generateValidated({
    ask: async () => JSON.stringify({ tasks: [{ ...task, chapterId: ++count === 1 ? 999 : 13 }] }),
    messages: [],
    validate: (x) => validatePlan(x.tasks, config, [{ id: 13 }]),
  });
  assert.equal(count, 2);
  assert.equal(result.tasks[0].chapterId, 13);
});
test('笔记纯文字任务不强制JSON，空结果最多补偿一次', async () => {
  const options = [];
  const result = await generateValidated({
    ask: async (_m, _s, o) => {
      options.push(o);
      return options.length === 1 ? '' : '章节笔记';
    },
    messages: [],
    jsonObject: false,
    validate: (x) => x,
  });
  assert.equal(result, '章节笔记');
  assert.ok(!('jsonObject' in options[1]));
});

test('计划返回0分钟时反馈具体任务和字段，让有限重试可以修复真实故障', async () => {
  const config = { targetDate: today(), minutes: 60, weekdays: [0, 1, 2, 3, 4, 5, 6] };
  const task = { chapterId: 13, kind: 'read', date: today(), minutes: 20, title: '阅读本章' };
  let calls = 0;
  const result = await generateValidated({
    messages: [],
    ask: async (messages) => {
      calls++;
      if (calls === 2) assert.match(messages.at(-1).content, /第 1 项任务.*5—480/);
      return JSON.stringify({ tasks: [{ ...task, minutes: calls === 1 ? 0 : 20 }] });
    },
    validate: (value) => validatePlan(value.tasks, config, [{ id: 13 }]),
  });
  assert.equal(result.tasks[0].minutes, 20);
  assert.equal(calls, 2);
});

test('计划日历由服务端校正零分钟及无效日期，仍拒绝虚构章节与不足的学习时间', () => {
  const config = { targetDate: '2026-10-22', minutes: 30, weekdays: [0, 1, 2, 3, 4, 5, 6] };
  const tasks = Array.from({ length: 3 }, (_, i) => ({
    chapterId: 13 + i,
    kind: 'read',
    date: '2020-01-01',
    minutes: i === 1 ? 0 : 60,
    title: '真实章节',
  }));
  const chapters = tasks.map((t) => ({ id: t.chapterId }));
  const result = validateGeneratedPlan(tasks, config, chapters, '2026-10-21');
  assert.equal(result.tasks.length, 3);
  assert.ok(result.tasks.every((t) => t.minutes >= 5));
  const daily = new Map();
  for (const t of result.tasks) daily.set(t.date, (daily.get(t.date) || 0) + t.minutes);
  assert.ok([...daily.values()].every((n) => n <= 30));
  assert.match(result.warning, /校正/);
  assert.throws(() => validateGeneratedPlan(tasks, config, [], '2026-10-21'), /不存在/);
  assert.throws(
    () =>
      validateGeneratedPlan(
        tasks,
        { ...config, targetDate: '2026-10-21', minutes: 10 },
        chapters,
        '2026-10-21',
      ),
    /不足/,
  );
});
