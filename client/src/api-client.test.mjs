import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, requestBlob } from './api-client.mjs';

test('JSON 请求使用统一地址、身份信息，并传递取消信号', async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/courses/12');
    assert.equal(options.method, 'PATCH');
    assert.equal(options.headers.get('Authorization'), 'Bearer fixture-token');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.equal(options.signal, controller.signal);
    assert.equal(options.keepalive, true);
    assert.deepEqual(JSON.parse(options.body), { title: '线性代数' });
    return Response.json({ saved: true });
  });
  assert.deepEqual(
    await requestJson('/courses/12', {
      token: 'fixture-token',
      method: 'PATCH',
      body: { title: '线性代数' },
      signal: controller.signal,
      keepalive: true,
    }),
    { saved: true },
  );
  assert.equal(fetch.mock.callCount(), 1);
});

test('表单上传保留浏览器生成的 multipart 边界', async (t) => {
  const form = new FormData();
  form.append('files', new Blob(['fixture']), 'example.txt');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.body, form);
    assert.equal(options.headers.has('Content-Type'), false);
    return Response.json({ uploaded: true });
  });
  assert.deepEqual(await requestJson('materials', { method: 'POST', body: form }), {
    uploaded: true,
  });
});

test('空响应可以成功返回，HTTP 错误保留服务端提示与状态', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.deepEqual(await requestJson('empty'), {});
  fetch.mock.mockImplementation(async () =>
    Response.json({ message: '版本已变化' }, { status: 409 }),
  );
  await assert.rejects(
    requestJson('conflict'),
    (error) => error.status === 409 && error.message === '版本已变化。如仍有问题，请联系管理员。',
  );
});

test('非 JSON 错误不显示 HTML，取消请求继续作为取消处理', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>proxy failure</html>', { status: 502 }),
  );
  await assert.rejects(
    requestJson('broken', { errorMessage: '加载失败' }),
    (error) => error.status === 502 && error.message === '加载失败。如仍有问题，请联系管理员。',
  );
  fetch.mock.mockImplementation(async () => new Response('not JSON', { status: 200 }));
  await assert.rejects(requestJson('malformed'), /数据无法读取/);
  const aborted = new DOMException('cancelled', 'AbortError');
  fetch.mock.mockImplementation(async () => {
    throw aborted;
  });
  await assert.rejects(requestJson('cancelled'), (error) => error === aborted);
});

test('二进制请求保留文件字节、身份和取消信号', async (t) => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/courses/12/cover/file?v=fixture');
    assert.equal(options.headers.get('Authorization'), 'Bearer fixture-token');
    assert.equal(options.signal, controller.signal);
    assert.equal(Object.hasOwn(options, 'errorMessage'), false);
    return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  });
  const image = await requestBlob('courses/12/cover/file?v=fixture', {
    token: 'fixture-token',
    signal: controller.signal,
    errorMessage: '图片加载失败',
  });
  assert.equal(image.type, 'image/png');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
});

test('图片请求失败时返回错误，不把错误正文当作图片', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: '没有读取权限' }, { status: 403 }),
  );
  await assert.rejects(
    requestBlob('private-image'),
    (error) => error.status === 403 && error.message === '没有读取权限。如仍有问题，请联系管理员。',
  );
  fetch.mock.mockImplementation(async () => new Response('<html>failure</html>', { status: 502 }));
  await assert.rejects(
    requestBlob('broken-image', { errorMessage: '图片加载失败' }),
    /图片加载失败/,
  );
});

test('模型故障给设置指引，网络错误保留网络提示，登录失效仍可识别', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: '该模型已停用，请重新选择' }, { status: 400 }),
  );
  await assert.rejects(requestJson('ask'), /请打开设置.*更换.*模型/);
  fetch.mock.mockImplementation(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(
    requestJson('ask'),
    (error) => /网络连接失败.*联系管理员/.test(error.message) && !/更换.*模型/.test(error.message),
  );
  fetch.mock.mockImplementation(async () =>
    Response.json({ message: '请先登录' }, { status: 401 }),
  );
  await assert.rejects(
    requestJson('me'),
    (error) => error.status === 401 && error.message === '请先登录',
  );
});
