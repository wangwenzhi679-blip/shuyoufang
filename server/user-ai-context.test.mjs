import test from 'node:test';
import assert from 'node:assert/strict';
import { UserAiContext } from './user-ai-context.js';

function setup() {
  const config = { baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' };
  const preferences = new Map([
    [1, { defaultModel: 'deepseek-flash' }],
    [2, { defaultModel: 'deepseek-v4-pro' }],
    [99, { defaultModel: 'configured' }],
  ]);
  const requests = [],
    reads = [];
  const context = new UserAiContext({
    services: {
      snapshot: () => config,
      ask: async (_messages, model, signal, options) => {
        requests.push({ model, signal, options });
        return model;
      },
      askStream: async (_messages, model) => {
        requests.push({ model, streaming: true });
        return model;
      },
    },
    readPreferences: async (id) => {
      reads.push(id);
      await new Promise((resolve) => setImmediate(resolve));
      return preferences.get(id);
    },
  });
  return { context, config, preferences, requests, reads };
}

test('并行请求按各自设置选模型，问答流与自动分析保持一致', async () => {
  const { context, reads, requests } = setup();
  await Promise.all(
    [1, 2].map((userId) =>
      context.run(userId, async () => {
        const normal = await context.ask([], undefined);
        const streamed = await context.askStream([], undefined);
        assert.equal(normal, streamed);
        assert.ok((await context.fingerprint()).endsWith('|' + normal));
      }),
    ),
  );
  assert.deepEqual(reads.sort(), [1, 2]);
  assert.equal(requests.filter((request) => request.model === 'deepseek-flash').length, 2);
  assert.equal(requests.filter((request) => request.model === 'deepseek-v4-pro').length, 2);
});

test('后台代重试按资料所属用户设置执行，不串用管理员模型', async () => {
  const { context } = setup();
  await context.run(99, async () => {
    assert.equal(await context.model(), 'deepseek-chat');
    await context.run(1, async () => assert.equal(await context.model(), 'deepseek-flash'));
    assert.equal(await context.model(), 'deepseek-chat');
  });
});

test('设置变更在新任务生效，缓存指纹随实际所选模型变化', async () => {
  const { context, preferences, config } = setup();
  const first = await context.run(1, () => context.fingerprint());
  preferences.set(1, { defaultModel: 'deepseek-v4-pro' });
  const second = await context.run(1, () => context.fingerprint());
  assert.notEqual(first, second);
  preferences.set(1, { defaultModel: 'configured' });
  config.model = 'deepseek-flash';
  assert.equal(await context.run(1, () => context.model()), 'deepseek-flash');
});

test('自定义 API 按服务设置的模型调用，保留输出预算与取消信号', async () => {
  const { context, config, reads, requests } = setup();
  config.baseUrl = 'https://example.com/v1/chat/completions';
  config.model = 'custom-model';
  const controller = new AbortController();
  await context.run(1, () =>
    context.ask([], undefined, controller.signal, { maxOutputTokens: 2048 }),
  );
  assert.equal(requests[0].model, 'custom-model');
  assert.equal(requests[0].signal, controller.signal);
  assert.equal(requests[0].options.maxOutputTokens, 2048);
  assert.equal(reads.length, 0);
});

test('已选模型不支持图片时明确提示，不能擅自切成另一模型', async () => {
  const { context, requests } = setup();
  const images = [
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,dGVzdA==' } }],
    },
  ];
  await assert.rejects(
    context.run(2, () => context.ask(images)),
    /当前设置.*不支持图片/,
  );
  assert.equal(requests.length, 0);
  await context.run(1, () => context.ask(images));
  assert.equal(requests[0].model, 'deepseek-flash');
});
