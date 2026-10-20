import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNoteEnhancements } from './note-enhancements.js';

test('扫描页读取/OCR在返回任务编号后进行，进度更新并保存识别来源', async () => {
  const routes = new Map(),
    stages = [];
  let releaseSource, sourceStarted, finished;
  const gate = new Promise((resolve) => {
    releaseSource = resolve;
  });
  const started = new Promise((resolve) => {
    sourceStarted = resolve;
  });
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  let savedInput, savedResult;
  const db = {
    async execute(sql, args) {
      if (sql.startsWith('SELECT ch.id,ch.title')) return [[{ id: 13, title: '扫描课文' }]];
      if (sql.startsWith('SELECT id FROM note_ai_jobs')) return [[]];
      if (sql.startsWith('INSERT INTO note_ai_jobs')) return [{ insertId: 37 }];
      if (sql.startsWith('SELECT status FROM note_ai_jobs')) return [[{ status: 'running' }]];
      if (sql.includes('SET progress_text=')) {
        stages.push(args[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SET input_json=')) {
        savedInput = JSON.parse(args[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET status='done'")) {
        savedResult = args[0];
        finished();
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET status='failed'")) {
        finished();
        throw new Error(args[0]);
      }
      throw new Error(sql);
    },
  };
  const app = {
    locals: {},
    get() {},
    put() {},
    post(paths, ...handlers) {
      for (const p of Array.isArray(paths) ? paths : [paths]) routes.set(p, handlers.at(-1));
    },
  };
  const response = {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  registerNoteEnhancements(
    app,
    db,
    () => {},
    (x) => x,
    async () => '识别后的学习笔记',
    async (_course, _chapter, options) => {
      assert.equal(response.code, 202);
      assert.equal(response.body.jobId, 37);
      assert.ok(options.signal);
      sourceStarted();
      await gate;
      await options.onProgress('本章文字识别 1/1 页');
      return '这是扫描页识别后的课文内容';
    },
  );
  await routes.get('/api/courses/:courseId/chapters/:chapterId/note/generate')(
    {
      params: { courseId: '1', chapterId: '13' },
      path: '/generate',
      user: { sub: 9 },
      body: { version: 0 },
    },
    response,
  );
  await started;
  assert.equal(savedResult, undefined);
  releaseSource();
  await done;
  assert.equal(savedInput.mode, 'generate');
  assert.match(savedInput.text, /扫描页识别/);
  assert.ok(stages.includes('本章文字识别 1/1 页'));
  assert.equal(savedResult, '识别后的学习笔记');
});
