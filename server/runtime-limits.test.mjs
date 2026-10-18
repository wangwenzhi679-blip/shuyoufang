import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeLimits, defaults, validate } from './runtime-limits.js';
test('验证限制范围和暂停开关', () => {
  assert.deepEqual(validate(defaults), defaults);
  for (const patch of [
    { uploadMB: 0 },
    { uploadCount: 21 },
    { aiConcurrency: 1.5 },
    { chatEnabled: 'false' },
  ])
    assert.throws(() => validate({ ...defaults, ...patch }));
  const runtime = new RuntimeLimits();
  runtime.config.chatEnabled = false;
  assert.throws(
    () => runtime.assert('chat'),
    (e) => e.status === 503,
  );
  runtime.assert('generation');
});
test('并发排队、取消和异常释放', async () => {
  const runtime = new RuntimeLimits();
  runtime.config.aiConcurrency = 1;
  let finish;
  const first = runtime.run(() => new Promise((resolve) => (finish = resolve)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.active, 1);
  const abort = new AbortController();
  const second = runtime.run(() => assert.fail('取消的请求不能执行'), abort.signal);
  const rejected = assert.rejects(second);
  assert.equal(runtime.queue.length, 1);
  abort.abort();
  await rejected;
  assert.equal(runtime.queue.length, 0);
  let ran = false;
  const third = runtime.run(() => {
    ran = true;
    throw new Error('provider failed');
  });
  const thirdRejected = assert.rejects(third, /provider failed/);
  assert.equal(ran, false);
  finish('done');
  assert.equal(await first, 'done');
  await thirdRejected;
  assert.equal(ran, true);
  assert.equal(runtime.active, 0);
  assert.equal(await runtime.run(() => 42), 42);
});
test('配置事务、版本冲突和重启读取', async () => {
  let row = { config_json: { ...defaults }, version: 0 },
    routes = {};
  const conn = {
    beginTransaction: async () => {},
    execute: async (sql, args) => {
      if (row.version !== args[1]) return [{ affectedRows: 0 }];
      row = { config_json: JSON.parse(args[0]), version: row.version + 1 };
      return [{ affectedRows: 1 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release() {},
  };
  const db = {
    query: async (sql) => (sql.startsWith('SELECT') ? [[row]] : []),
    execute: async () => [],
    getConnection: async () => conn,
  };
  const runtime = new RuntimeLimits(db);
  await runtime.init();
  let audits = 0;
  runtime.register(
    (method, url, handler) => (routes[method] = handler),
    async () => audits++,
  );
  await routes.put(
    { body: { config: { ...defaults, uploadMB: 8 }, version: 0, reason: '调整上传' }, user: {} },
    { json() {} },
  );
  assert.equal(runtime.snapshot().uploadMB, 8);
  assert.equal(audits, 1);
  await assert.rejects(
    routes.put(
      { body: { config: defaults, version: 0, reason: '旧版本' }, user: {} },
      { json() {} },
    ),
    (e) => e.status === 409,
  );
  const reloaded = new RuntimeLimits(db);
  await reloaded.init();
  assert.equal(reloaded.snapshot().uploadMB, 8);
  assert.equal(reloaded.version, 1);
});
