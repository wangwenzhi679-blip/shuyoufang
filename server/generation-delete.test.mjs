import test from 'node:test';
import assert from 'node:assert/strict';
import { registerGenerationJobs } from './generation-jobs.js';

test('删除课程立即取消其在途 AI 请求，不能继续保存生成结果', async () => {
  const routes = {},
    writes = [];
  let started, stopped;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const cancelled = new Promise((resolve) => {
    stopped = resolve;
  });
  const app = {
    locals: {},
    post: (route, ...handlers) => {
      routes[route] = handlers.at(-1);
    },
    get() {},
  };
  const db = {
    execute: async (sql) => {
      if (sql.startsWith('SELECT id FROM courses')) return [[{ id: 7 }]];
      if (sql.startsWith('SELECT status')) return [[{ status: 'running' }]];
      if (sql.startsWith('SELECT')) return [[]];
      writes.push(sql);
      return [{ insertId: 8, affectedRows: 1 }];
    },
  };
  registerGenerationJobs(
    app,
    db,
    () => {},
    (handler) => handler,
    async (_user, _input, signal, beginSave) => {
      started();
      await new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            stopped();
            reject(signal.reason);
          },
          { once: true },
        ),
      );
      await beginSave();
      return { chapters: [] };
    },
  );
  await routes['/api/generation-jobs'](
    { user: { sub: 2 }, body: { kind: 'chapters', courseId: 7 } },
    {
      status() {
        return this;
      },
      json() {},
    },
  );
  await ready;
  app.locals.adminTasks.course.abortCourse(7);
  await cancelled;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    writes.some((sql) => sql.includes("status='saving'") || sql.includes("status='done'")),
    false,
  );
});

test('目录保存复用事务连接检查权限和更新状态，不额外等待连接池', { timeout: 2000 }, async () => {
  const routes = {},
    checkedConnections = [];
  let complete;
  const done = new Promise((resolve) => {
    complete = resolve;
  });
  let markedSaving = false;
  const connection = {
    execute: async (sql) => {
      assert.ok(sql.includes("status='saving'"));
      markedSaving = true;
      return [{ affectedRows: 1 }];
    },
  };
  const app = {
    locals: {
      contentControl: {
        assertCourse: async (_user, _course, _materials, passed) => checkedConnections.push(passed),
      },
    },
    post: (url, ...handlers) => {
      routes[url] = handlers.at(-1);
    },
    get() {},
  };
  const db = {
    execute: async (sql) => {
      if (sql.includes("status='saving'")) throw new Error('不应另占连接');
      if (sql.startsWith('SELECT id FROM courses')) return [[{ id: 7 }]];
      if (sql.startsWith('SELECT status')) return [[{ status: 'running' }]];
      if (sql.startsWith('SELECT')) return [[]];
      if (sql.includes("status='done'")) complete();
      return [{ insertId: 8, affectedRows: 1 }];
    },
  };
  registerGenerationJobs(
    app,
    db,
    () => {},
    (handler) => handler,
    async (_user, _input, _signal, save) => {
      await save(connection);
      return { chapters: [] };
    },
  );
  await routes['/api/generation-jobs'](
    { user: { sub: 2 }, body: { kind: 'chapters', courseId: 7 } },
    {
      status() {
        return this;
      },
      json() {},
    },
  );
  await done;
  assert.equal(markedSaving, true);
  assert.equal(checkedConnections.at(-1), connection);
});
