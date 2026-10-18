import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatStream } from './ai-stream.js';

const event = (content, finishReason) =>
  'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] });
const streamResponse = (body) =>
  new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });

test('非流式回答保留正文与换行，拒绝空内容和错误类型', async () => {
  const chunks = [];
  const content = '先独立思考。\n再核对思路。';
  const response = Response.json({ choices: [{ message: { content } }] });
  assert.equal(await readChatStream(response, (text) => chunks.push(text)), content);
  assert.deepEqual(chunks, [content]);
  for (const invalid of ['', '   ', 123, []]) {
    await assert.rejects(
      readChatStream(Response.json({ choices: [{ message: { content: invalid } }] }), () => {}),
      (error) => error.status === 502 && /有效内容/.test(error.message),
    );
  }
});

test('流式回答兼容拆开的 UTF-8 字符、CRLF 和心跳事件', async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n' + event('学') + '\r\n\r\n' + event('而思') + '\r\ndata: [DONE]\r\n',
  );
  const character = bytes.indexOf(0xe5);
  const parts = [
    bytes.slice(0, character + 1),
    bytes.slice(character + 1, character + 2),
    bytes.slice(character + 2),
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
  const chunks = [];
  assert.equal(await readChatStream(streamResponse(body), (text) => chunks.push(text)), '学而思');
  assert.deepEqual(chunks, ['学', '而思']);
  assert.equal(body.locked, false);
});

test('结束标记会关闭尚未结束的上游，不读取标记之后的内容', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(event('正文') + '\ndata: [DONE]\n' + event('不应出现') + '\n'),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.equal(await readChatStream(streamResponse(body), () => {}), '正文');
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('兼容末行没有换行的正常结束，拒绝没有结束信号的截断回答', async () => {
  assert.equal(
    await readChatStream(streamResponse(event('完整回答', 'stop')), () => {}),
    '完整回答',
  );
  const chunks = [];
  await assert.rejects(
    readChatStream(streamResponse(event('仅收到一部分') + '\n'), (text) => chunks.push(text)),
    /回答中断/,
  );
  assert.deepEqual(chunks, ['仅收到一部分']);
});

test('数据损坏、供应商错误和超长回答都返回明确错误', async () => {
  for (const [body, message] of [
    ['data: {broken}\n', /数据不完整/],
    ['data: {"error":{"message":"private provider detail"}}\n', /生成中断/],
    [event('字'.repeat(60001)) + '\n', /回答过长/],
    ['data: [DONE]\n', /有效内容/],
  ]) {
    await assert.rejects(
      readChatStream(streamResponse(body), () => {}),
      message,
    );
  }
});

test('取消和回调失败都会释放响应流，不吞掉原始错误', async () => {
  for (const abortBeforeRead of [true, false]) {
    let cancelled = false;
    const controller = new AbortController();
    const expected = new Error('fixture interrupted');
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(event('正文') + '\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    if (abortBeforeRead) controller.abort(expected);
    await assert.rejects(
      readChatStream(
        streamResponse(body),
        () => {
          throw expected;
        },
        controller.signal,
      ),
      (error) => error === expected,
    );
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
});

test('HTTP 错误不回显供应商正文', async () => {
  for (const [status, message] of [
    [401, 'AI 服务鉴权失败'],
    [429, 'AI 服务请求受限'],
    [500, 'AI 服务暂时无法回答'],
  ]) {
    const response = new Response('private provider detail', { status });
    await assert.rejects(
      readChatStream(response, () => {}),
      (error) => error.status === 502 && error.message === message,
    );
  }
});
