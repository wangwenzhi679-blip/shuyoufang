import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceSettings } from './service-settings.js';

function manager(fetcher) {
  return new ServiceSettings(null, 'unit-test-only-secret', {
    env: { DEEPSEEK_API_KEY: 'unit-test-only-key' },
    fetcher,
  });
}

test('资料整理的输出预算传入接口，普通问答仍保持原请求参数', async () => {
  const requests = [];
  const service = manager(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '完整要点' } }],
    });
  });
  await service.ask([], undefined, undefined, { maxOutputTokens: 2048 });
  await service.ask([]);
  assert.equal(requests[0].max_tokens, 2048);
  assert.equal('max_tokens' in requests[1], false);
});

test('资料整理接口被截断时发出可识别错误，不把残缺回答当作摘要', async () => {
  const service = manager(async () =>
    Response.json({
      choices: [{ finish_reason: 'length', message: { content: '不完整的内容' } }],
    }),
  );
  await assert.rejects(
    () => service.ask([], undefined, undefined, { maxOutputTokens: 2048 }),
    (error) => error.code === 'AI_OUTPUT_LIMIT',
  );
});
