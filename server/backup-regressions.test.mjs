import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminBackups } from './admin-backups.js';
const value = '11111111-1111-1111-1111-111111111111';
const response = {
  status() {
    return this;
  },
  json() {},
};
test('同时验证只接受一项，完成日志失败不改写成功状态', async () => {
  let unblock,
    finalStatus = 'pending',
    released = 0;
  const gate = new Promise((resolve) => (unblock = resolve)),
    conn = {
      beginTransaction: async () => {},
      execute: async (sql) => {
        if (sql.startsWith('SELECT')) return [[{ status: 'done' }]];
      },
      commit: async () => {},
      rollback: async () => {},
      release() {
        released++;
      },
    };
  const db = {
    getConnection: async () => {
      await gate;
      return conn;
    },
    execute: async (sql) => {
      if (sql.includes("verify_status='done'")) finalStatus = 'done';
      if (sql.includes("verify_status='failed'")) finalStatus = 'failed';
    },
  };
  const backups = new AdminBackups(db, {
    root: process.cwd(),
    uploadRoot: process.cwd(),
    imageRoot: process.cwd(),
    previewRoot: process.cwd(),
  });
  let verified = 0;
  backups.verify = async () => verified++;
  const routes = {};
  backups.register(
    (method, url, handler) => (routes[method + ' ' + url] = handler),
    async (conn, actor, action, id, result) => {
      if (result === 'success') throw Error('audit unavailable');
    },
  );
  const request = { params: { id: value }, body: { reason: '测试重复请求' }, user: {} };
  const first = routes['post /backups/:id/verify'](request, response);
  await assert.rejects(
    routes['post /backups/:id/verify'](request, response),
    (e) => e.status === 409,
  );
  unblock();
  await first;
  for (let i = 0; i < 10 && backups.running; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(verified, 1);
  assert.equal(finalStatus, 'done');
  assert.equal(backups.running, false);
  assert.equal(released, 1);
});
test('受理日志失败回滚任务并释放运行锁', async () => {
  let rolledBack = false,
    committed = false;
  const conn = {
    beginTransaction: async () => {},
    execute: async () => [[{ status: 'done' }]],
    commit: async () => (committed = true),
    rollback: async () => (rolledBack = true),
    release() {},
  };
  const backups = new AdminBackups({ getConnection: async () => conn }, { root: process.cwd() });
  backups.verify = async () => assert.fail('未受理的任务不能执行');
  const routes = {};
  backups.register(
    (method, url, handler) => (routes[method + ' ' + url] = handler),
    async () => {
      throw Error('audit unavailable');
    },
  );
  await assert.rejects(
    routes['post /backups/:id/verify'](
      { params: { id: value }, body: { reason: '事务测试' }, user: {} },
      response,
    ),
    /audit unavailable/,
  );
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.equal(backups.running, false);
});
