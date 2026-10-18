import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { endpoint, publicAddress, safeAiFetch } from './ai-endpoint.js';
import { readChatStream } from './ai-stream.js';
import { ServiceSettings } from './service-settings.js';

const options = () => ({
  headers: { 'Content-Type': 'application/json' },
  body: '{"messages":[]}',
});
function transport(
  t,
  { contentType = 'text/event-stream', status = 200, deferHeaders = false } = {},
) {
  const response = new PassThrough();
  response.statusCode = status;
  response.headers = { 'content-type': contentType };
  const request = new EventEmitter();
  request.destroyed = false;
  let headersSent = false;
  request.destroy = (error) => {
    if (request.destroyed) return request;
    request.destroyed = true;
    if (!response.destroyed) response.destroy(headersSent ? error : undefined);
    if (error) queueMicrotask(() => request.emit('error', error));
    return request;
  };
  let callback, record;
  request.end = (body) => {
    record.body = body;
    if (!deferHeaders)
      queueMicrotask(() => {
        if (!request.destroyed) {
          headersSent = true;
          callback(response);
        }
      });
  };
  t.mock.method(https, 'request', (address, requestOptions, onResponse) => {
    record = { address, options: requestOptions };
    callback = onResponse;
    return request;
  });
  t.after(() => {
    response.destroy();
    request.destroy();
  });
  return {
    response,
    request,
    get record() {
      return record;
    },
  };
}

test('safeAiFetch exposes a real streaming Response before the upstream ends', async (t) => {
  const fake = transport(t);
  const response = await safeAiFetch('https://api.example.com/v1', options());
  assert.ok(response instanceof Response);
  assert.ok(response.headers instanceof Headers);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(fake.record.address, 'https://api.example.com/v1/chat/completions');
  let chunks = '',
    received;
  const first = new Promise((resolve) => (received = resolve));
  const reading = readChatStream(response, (chunk) => {
    chunks += chunk;
    received();
  });
  const encoded = Buffer.from(
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '中文' } }] }) + '\n\n',
  );
  const split = encoded.indexOf(Buffer.from('中文')) + 1;
  fake.response.write(encoded.subarray(0, split));
  fake.response.write(encoded.subarray(split));
  await first;
  assert.equal(chunks, '中文');
  assert.equal(fake.response.readableEnded, false);
  fake.response.end(
    'data: ' +
      JSON.stringify({ choices: [{ delta: { content: '续答' }, finish_reason: 'stop' }] }) +
      '\n\ndata: [DONE]\n\n',
  );
  assert.equal(await reading, '中文续答');
  assert.equal(chunks, '中文续答');
});

test('safeAiFetch keeps JSON response compatibility', async (t) => {
  const fake = transport(t, { contentType: 'application/json' });
  const response = await safeAiFetch('https://api.example.com', options());
  fake.response.end(JSON.stringify({ choices: [{ message: { content: 'JSON 回答' } }] }));
  let answer = '';
  assert.equal(await readChatStream(response, (chunk) => (answer += chunk)), 'JSON 回答');
  assert.equal(answer, 'JSON 回答');
});

test('ServiceSettings default transport streams without a custom fetcher', async (t) => {
  const fake = transport(t);
  const settings = new ServiceSettings({}, 'fixture encryption secret', {
    env: { DEEPSEEK_API_KEY: 'fixture-not-a-real-key' },
  });
  let answer = '',
    received;
  const first = new Promise((resolve) => (received = resolve));
  const reading = settings.askStream(
    [{ role: 'user', content: 'fixture question' }],
    'configured',
    undefined,
    (chunk) => {
      answer += chunk;
      received();
    },
  );
  fake.response.write(
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '首段' } }] }) + '\n\n',
  );
  await first;
  assert.equal(answer, '首段');
  assert.equal(fake.response.readableEnded, false);
  assert.equal(JSON.parse(fake.record.body).stream, true);
  fake.response.end(
    'data: ' +
      JSON.stringify({ choices: [{ delta: { content: '末段' }, finish_reason: 'stop' }] }) +
      '\n\ndata: [DONE]\n\n',
  );
  assert.equal(await reading, '首段末段');
});

test('safeAiFetch preserves HTTP status and JSON errors', async (t) => {
  const fake = transport(t, { contentType: 'application/json', status: 401 });
  const response = await safeAiFetch('https://api.example.com', options());
  fake.response.end('{"error":{"message":"fixture"}}');
  assert.equal(response.ok, false);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { message: 'fixture' } });
});

test('readChatStream closes an unread HTTP error response immediately', async (t) => {
  const fake = transport(t, { contentType: 'application/json', status: 401 });
  const response = await safeAiFetch('https://api.example.com', options());
  await assert.rejects(
    readChatStream(response, () => {}),
    /AI 服务鉴权失败/,
  );
  assert.equal(fake.request.destroyed, true);
  assert.equal(fake.response.destroyed, true);
});

test('safeAiFetch rejects responses beyond the 4 MiB bound at the reader', async (t) => {
  const fake = transport(t, { contentType: 'application/json' });
  const response = await safeAiFetch('https://api.example.com', options());
  const reading = response.arrayBuffer();
  fake.response.write(Buffer.alloc(2 * 1024 * 1024));
  fake.response.write(Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(reading, /AI 响应过大/);
  assert.equal(fake.request.destroyed, true);
});

test('safeAiFetch propagates AbortSignal after headers to a pending reader', async (t) => {
  const fake = transport(t),
    controller = new AbortController();
  const response = await safeAiFetch('https://api.example.com', {
    ...options(),
    signal: controller.signal,
  });
  const reading = response.text();
  const reason = new Error('fixture aborted');
  controller.abort(reason);
  await assert.rejects(reading, (error) => error === reason);
  assert.equal(fake.request.destroyed, true);
  assert.equal(fake.record.options.signal, controller.signal);
});

test('safeAiFetch aborts before headers and skips pre-aborted requests', async (t) => {
  const fake = transport(t, { deferHeaders: true }),
    controller = new AbortController();
  const pending = safeAiFetch('https://api.example.com', {
    ...options(),
    signal: controller.signal,
  });
  controller.abort(new Error('fixture before headers'));
  await assert.rejects(pending, /fixture before headers/);
  assert.equal(fake.request.destroyed, true);
  const other = new AbortController();
  other.abort(new Error('fixture already aborted'));
  await assert.rejects(
    safeAiFetch('https://api.example.com', { ...options(), signal: other.signal }),
    /fixture already aborted/,
  );
});

test('safeAiFetch propagates mid-response socket failures', async (t) => {
  const fake = transport(t);
  const response = await safeAiFetch('https://api.example.com', options());
  const reader = response.body.getReader();
  fake.response.write('first');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  const next = reader.read();
  fake.response.destroy(new Error('fixture socket error'));
  await assert.rejects(next, /fixture socket error/);
  reader.releaseLock();
});

test('safeAiFetch propagates an upstream aborted event', async (t) => {
  const fake = transport(t);
  const response = await safeAiFetch('https://api.example.com', options());
  const reading = response.text();
  fake.response.emit('aborted');
  await assert.rejects(reading, /AI 响应中断/);
});

test('canceling the response reader closes the upstream request', async (t) => {
  const fake = transport(t);
  const response = await safeAiFetch('https://api.example.com', options());
  const reader = response.body.getReader();
  await reader.cancel();
  reader.releaseLock();
  assert.equal(fake.request.destroyed, true);
  assert.equal(fake.response.destroyed, true);
});

test('safeAiFetch retains public DNS pinning and rejects mixed private answers', async (t) => {
  const fake = transport(t, { deferHeaders: true });
  const pending = safeAiFetch('https://api.example.com', options());
  t.mock.method(dns, 'lookup', (_host, lookupOptions, callback) => {
    assert.deepEqual(lookupOptions, { all: true });
    callback(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
  });
  const error = await new Promise((resolve) =>
    fake.record.options.lookup('api.example.com', { all: true }, resolve),
  );
  assert.match(error.message, /公网服务/);
  dns.lookup.mock.mockImplementation((_host, _options, callback) =>
    callback(null, [{ address: '93.184.216.34', family: 4 }]),
  );
  const pinned = await new Promise((resolve, reject) =>
    fake.record.options.lookup('api.example.com', { family: 4 }, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    ),
  );
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 });
  fake.request.destroy(new Error('fixture cleanup'));
  await assert.rejects(pending, /fixture cleanup/);
});

test('AI endpoints still reject unsafe URLs and private addresses', () => {
  for (const address of [
    'http://api.example.com',
    'https://127.0.0.1',
    'https://example.local',
    'https://name:secret@api.example.com',
    'https://api.example.com?redirect=local',
  ])
    assert.throws(() => endpoint(address));
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.2.3',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '::1',
    '2001:db8::1',
  ])
    assert.equal(publicAddress(address), false);
  assert.equal(publicAddress('93.184.216.34'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});
