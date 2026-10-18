import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeLimits, defaults } from './runtime-limits.js';
test('较早配置的延迟提交响应不能覆盖较新运行配置', async () => {
  let unblock, firstCommit;
  const committed = new Promise((r) => (firstCommit = r)),
    gate = new Promise((r) => (unblock = r));
  let count = 0;
  const db = {
    getConnection: async () => {
      const first = count++ === 0;
      return {
        beginTransaction: async () => {},
        execute: async () => [{ affectedRows: 1 }],
        commit: async () => {
          if (first) {
            firstCommit();
            await gate;
          }
        },
        rollback: async () => {},
        release() {},
      };
    },
  };
  const runtime = new RuntimeLimits(db),
    routes = {};
  runtime.register(
    (method, url, handler) => (routes[method] = handler),
    async () => {},
  );
  const res = { json() {} };
  const early = routes.put(
    { body: { config: { ...defaults, uploadMB: 10 }, version: 0, reason: '第一次' }, user: {} },
    res,
  );
  await committed;
  await routes.put(
    { body: { config: { ...defaults, uploadMB: 30 }, version: 1, reason: '第二次' }, user: {} },
    res,
  );
  unblock();
  await early;
  assert.equal(runtime.version, 2);
  assert.equal(runtime.snapshot().uploadMB, 30);
});
