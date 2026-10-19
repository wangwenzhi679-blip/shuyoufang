import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MaterialImportJobs, registerMaterialImportJobs } from './material-import-jobs.js';
import { registerMaterialRoutes } from './material-routes.js';
import { createMaterialService } from './material-service.js';

test('PDF 导入不等待整本 OCR，扫描件也可保留原文件供图片分章', async () => {
  const calls = [];
  let pdfReads = 0;
  const service = createMaterialService({
    readPdfText: async () => {
      pdfReads++;
      return '';
    },
    parseOffice: async (_file, config) => {
      calls.push(config);
      return { to: async () => ({ value: '' }) };
    },
  });
  const result = await service.processMaterial('scan.pdf', 'scan.pdf');
  assert.equal(pdfReads, 1);
  assert.equal(calls.length, 0);
  assert.equal(result.extractedText, '');
  await service.processMaterial('notes.docx', 'notes.docx');
  assert.equal(calls[0].ocr, true);
});

test('删除课程立即中止正在解析的导入，不能保存回已删课程', async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let openedTransaction = false;
  const jobs = new MaterialImportJobs({
    uploadRoot: os.tmpdir(),
    getOwnedCourse: async () => ({ id: 4 }),
    db: {
      execute: async () => [{}],
      getConnection: async () => {
        openedTransaction = true;
        throw Error('不应保存');
      },
    },
    processMaterial: async (_file, _name, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        started();
      }),
  });
  const parsing = jobs.processJob({
    id: 8,
    user_id: 2,
    course_id: 4,
    files_json: [{ filename: 'a.pdf', originalname: 'a.pdf' }],
  });
  await ready;
  jobs.cancelCourse(4);
  await parsing;
  assert.equal(openedTransaction, false);
  assert.equal(jobs.controllers.size, 0);
});

test('后台导入接口接收文件后即返回202，不等待资料解析', async () => {
  const routes = {};
  let enqueued;
  registerMaterialRoutes(
    {
      post: (url, ...handlers) => {
        routes[url] = handlers;
      },
      get() {},
      put() {},
      delete() {},
    },
    {
      auth() {},
      asyncRoute: (handler) => handler,
      upload: { array: () => () => {} },
      processMaterial() {
        throw Error('不应在上传请求中解析');
      },
      importJobs: {
        enqueue: async (...args) => {
          enqueued = args;
          return { id: 8 };
        },
      },
    },
  );
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  await routes['/api/courses/:courseId/materials'].at(-1)(
    {
      uploadCourse: { id: 4 },
      user: { sub: 2 },
      files: [{ filename: 'a.pdf' }],
      query: { background: '1' },
      body: { importKey: 'request-1' },
    },
    res,
  );
  assert.equal(res.code, 202);
  assert.equal(res.body.job.id, 8);
  assert.deepEqual(enqueued.slice(0, 2), [2, 4]);
});

test('后台解析结束后，资料与完成状态在同一事务提交', async () => {
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const writes = [];
  const connection = {
    beginTransaction: async () => writes.push('begin'),
    commit: async () => writes.push('commit'),
    rollback: async () => writes.push('rollback'),
    release: () => writes.push('release'),
    execute: async (sql) => {
      writes.push(sql);
      return sql.startsWith('SELECT') ? [[{ id: 8 }]] : [{ insertId: 10 }];
    },
  };
  const jobs = new MaterialImportJobs({
    db: { execute: async () => [{}], getConnection: async () => connection },
    uploadRoot: os.tmpdir(),
    getOwnedCourse: async () => ({ id: 4 }),
    normalizeUploadedName: (name) => name,
    processMaterial: async () => {
      await gate;
      return { extractedText: '完整资料', previewName: null };
    },
  });
  const running = jobs.processJob({
    id: 8,
    user_id: 2,
    course_id: 4,
    files_json: [{ filename: 'a.pdf', originalname: 'a.pdf', size: 10 }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, []);
  resume();
  await running;
  assert.equal(writes[0], 'begin');
  assert.ok(writes.some((sql) => sql.startsWith('INSERT INTO course_materials')));
  assert.ok(writes.some((sql) => sql.includes("status='done'")));
  assert.deepEqual(writes.slice(-2), ['commit', 'release']);
});

test('保存失败回滚全部资料，保留原文件重试并清理临时预览', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-job-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'a.pdf'), 'original');
  await fs.writeFile(path.join(root, 'preview.pdf'), 'preview');
  const events = [];
  const jobs = new MaterialImportJobs({
    uploadRoot: root,
    previewRoot: root,
    getOwnedCourse: async () => ({ id: 4 }),
    normalizeUploadedName: (value) => value,
    processMaterial: async () => ({ extractedText: '正文', previewName: 'preview.pdf' }),
    db: {
      execute: async (sql) => {
        events.push(sql);
        return [{}];
      },
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {
          throw Error('不应提交');
        },
        rollback: async () => events.push('rollback'),
        release: () => events.push('release'),
        execute: async (sql) => {
          if (sql.startsWith('SELECT')) return [[{ id: 8 }]];
          throw Error('write failure');
        },
      }),
    },
  });
  await jobs.processJob({
    id: 8,
    user_id: 2,
    course_id: 4,
    files_json: [{ filename: 'a.pdf', originalname: 'a.pdf' }],
  });
  assert.ok(events.includes('rollback'));
  assert.ok(events.some((sql) => sql.includes("status='failed'")));
  assert.equal(await fs.readFile(path.join(root, 'a.pdf'), 'utf8'), 'original');
  await assert.rejects(fs.access(path.join(root, 'preview.pdf')));
});

test('重启后未完成导入重新排队', async () => {
  const statements = [];
  const jobs = new MaterialImportJobs({
    db: {
      query: async (sql) => statements.push(sql),
      execute: async (sql) => statements.push(sql),
    },
  });
  jobs.kick = () => {};
  try {
    await jobs.init();
    assert.ok(
      statements.some(
        (sql) => sql.includes("status='queued'") && sql.includes("WHERE status='running'"),
      ),
    );
  } finally {
    clearInterval(jobs.timer);
  }
});

test('相同上传请求重试不重复导入，并清理重复收到的文件', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-job-retry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'retry.pdf'), 'duplicate');
  await fs.writeFile(path.join(root, 'original.pdf'), 'original');
  const jobs = new MaterialImportJobs({
    uploadRoot: root,
    db: {
      execute: async (sql) =>
        sql.startsWith('INSERT')
          ? [{ affectedRows: 0 }]
          : [[{ id: 5, course_id: 4, status: 'done' }]],
    },
  });
  const job = await jobs.enqueue(2, 4, [{ filename: 'retry.pdf' }], 'same-request');
  assert.equal(job.id, 5);
  await assert.rejects(fs.access(path.join(root, 'retry.pdf')));
  assert.equal(await fs.readFile(path.join(root, 'original.pdf'), 'utf8'), 'original');
});

test('任务读取和重试均限定当前用户，不能重试其他人的任务', async () => {
  const routes = {},
    writes = [];
  const auth = () => {};
  registerMaterialImportJobs(
    {
      get: (url, ...handlers) => {
        assert.equal(handlers[0], auth);
        routes[url] = handlers.at(-1);
      },
      post: (url, ...handlers) => {
        assert.equal(handlers[0], auth);
        routes[url] = handlers.at(-1);
      },
    },
    {
      auth,
      asyncRoute: (handler) => handler,
      db: {
        execute: async (sql, args) => {
          writes.push([sql, args]);
          return sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 0 }];
        },
      },
      importJobs: {
        kick() {
          throw Error('不应启动无权访问的任务');
        },
      },
    },
  );
  await routes['/api/material-import-jobs']({ user: { sub: 2 } }, { json() {} });
  assert.deepEqual(writes[0][1], [2]);
  await assert.rejects(
    routes['/api/material-import-jobs/:id/retry']({ params: { id: '8' }, user: { sub: 2 } }, {}),
    /任务不存在/,
  );
  assert.deepEqual(writes[1][1], [8, 2]);
});
