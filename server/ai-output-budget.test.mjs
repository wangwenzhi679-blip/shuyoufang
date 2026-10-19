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
  await service.ask([], undefined, undefined, { maxOutputTokens: 16384 });
  await service.ask([], undefined, undefined, { maxOutputTokens: 32768 });
  await service.ask([]);
  assert.equal(requests[0].max_tokens, 2048);
  assert.equal(requests[1].max_tokens, 16384);
  assert.equal(requests[2].max_tokens, 32768);
  assert.equal('max_tokens' in requests[3], false);
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

test('图片资料整理显式使用JSON和非思考模式，普通问答保持默认设置', async () => {
  const bodies = [];
  const service = manager(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
  });
  await service.ask([], undefined, undefined, {
    thinking: false,
    jsonObject: true,
    maxOutputTokens: 2048,
  });
  await service.ask([]);
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
  assert.equal('thinking' in bodies[1], false);
  assert.equal('response_format' in bodies[1], false);
});

test('AI 返回空值或非文字内容时产生明确错误，不抛出内部类型异常', async () => {
  for (const content of [null, {}, [], 42, '  ']) {
    const service = manager(async () =>
      Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    );
    await assert.rejects(
      () => service.ask([]),
      (error) => error.code === 'AI_EMPTY_RESPONSE' && error.status === 502,
    );
  }
});

test('网络失败和超时给出明确原因，主动取消保持取消语义', async () => {
  for (const [error, code] of [
    [new TypeError('PRIVATE_PROVIDER_DETAIL'), 'AI_CONNECTION'],
    [new DOMException('PRIVATE_PROVIDER_DETAIL', 'TimeoutError'), 'AI_TIMEOUT'],
  ]) {
    const service = manager(async () => {
      throw error;
    });
    await assert.rejects(
      () => service.ask([]),
      (error) => error.code === code && !error.message.includes('PRIVATE_'),
    );
  }
  const controller = new AbortController();
  const service = manager(async () => {
    controller.abort();
    throw new Error('network');
  });
  await assert.rejects(() => service.ask([], undefined, controller.signal), { name: 'AbortError' });
});

test('服务器成功状态下的非JSON响应明确失败，鉴权错误不被解析错误覆盖', async () => {
  const invalid = manager(async () => new Response('<html>PRIVATE</html>'));
  await assert.rejects(
    () => invalid.ask([]),
    (error) => error.code === 'AI_INVALID_RESPONSE',
  );
  const unauthorized = manager(async () => new Response('<html>PRIVATE</html>', { status: 401 }));
  await assert.rejects(
    () => unauthorized.ask([]),
    (error) => /鉴权失败/.test(error.message),
  );
});

test('服务额度、权限、接口和限流错误分别提示，不回显供应商原文', async () => {
  for (const [status, expected] of [
    [402, /额度不足/],
    [403, /权限不足/],
    [404, /接口或模型/],
    [400, /参数/],
    [429, /受限/],
  ]) {
    const service = manager(async () =>
      Response.json({ error: { message: 'PRIVATE_PROVIDER_DETAIL' } }, { status }),
    );
    await assert.rejects(
      () => service.ask([]),
      (error) => expected.test(error.message) && !error.message.includes('PRIVATE_'),
    );
  }
});
