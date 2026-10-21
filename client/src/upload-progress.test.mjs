import test from 'node:test';
import assert from 'node:assert/strict';
import { requestUpload } from './api-client.mjs';

function fakeUpload(t) {
  const previous = globalThis.XMLHttpRequest;
  let current;
  globalThis.XMLHttpRequest = class {
    constructor() {
      current = this;
      this.upload = {};
      this.headers = {};
    }
    open(method, url) {
      Object.assign(this, { method, url });
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      this.body = body;
    }
    abort() {
      this.onabort();
    }
  };
  t.after(() => {
    globalThis.XMLHttpRequest = previous;
  });
  return () => current;
}

test('上传进度来自字节数，服务端确认前不显示完成，并保留认证和 multipart 边界', async (t) => {
  const current = fakeUpload(t),
    values = [],
    body = new FormData();
  const pending = requestUpload('courses/1/materials?background=1', {
    token: 'test-token',
    body,
    onProgress: (value) => values.push(value),
  });
  const xhr = current();
  xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 200 });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 200, total: 200 });
  assert.deepEqual(values, [25, 99]);
  assert.equal(xhr.headers.Authorization, 'Bearer test-token');
  assert.equal(xhr.headers['Content-Type'], undefined);
  assert.equal(xhr.body, body);
  xhr.status = 202;
  xhr.responseText = '{"job":{"id":8}}';
  await xhr.onload();
  assert.equal((await pending).job.id, 8);
  assert.equal(values.at(-1), 100);
});

test('上传的服务端错误保留提示和状态，HTML 错误不被当成成功', async (t) => {
  const current = fakeUpload(t);
  for (const [status, responseText, message] of [
    [401, '{"message":"请先登录"}', /请先登录/],
    [413, '<html>too large</html>', /资料上传失败/],
  ]) {
    const values = [];
    const pending = requestUpload('upload', {
      body: new FormData(),
      onProgress: (value) => values.push(value),
    });
    const rejected = assert.rejects(
      pending,
      (error) => error.status === status && message.test(error.message),
    );
    Object.assign(current(), { status, responseText });
    await current().onload();
    await rejected;
    assert.ok(!values.includes(100));
  }
});

test('未知上传长度保持未定进度，取消和断网不能显示导入完成', async (t) => {
  const current = fakeUpload(t),
    controller = new AbortController(),
    values = [];
  const pending = requestUpload('upload', {
    signal: controller.signal,
    onProgress: (value) => values.push(value),
  });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  current().upload.onprogress({ lengthComputable: false, loaded: 100 });
  assert.deepEqual(values, [null]);
  controller.abort();
  await rejected;
  const offline = requestUpload('upload');
  const offlineRejected = assert.rejects(offline, /网络连接中断/);
  current().onerror();
  await offlineRejected;
});
