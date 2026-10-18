import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import assert from 'node:assert/strict';
import { registerLearningPlans, today } from './learning-plans.js';
import { registerNoteEnhancements } from './note-enhancements.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let userId, server;
const releases = [];
const signals = [];
try {
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'取消验证','test','disabled-test-login')",
    [`cancel_${Date.now()}`],
  );
  userId = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'验证课程')", [userId]);
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'验证章节')",
    [c.insertId],
  );
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => {
    req.user = { sub: req.headers['x-foreign'] ? userId + 100000 : userId };
    next();
  };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const waitAi = (messages, signal) => {
    signals.push(signal);
    return new Promise((resolve) => releases.push(resolve));
  };
  registerLearningPlans(app, db, auth, wrap, waitAi);
  registerNoteEnhancements(app, db, auth, wrap, waitAi, async () => '测试章节资料');
  app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const call = async (path, body, foreign = false) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(foreign ? { 'x-foreign': '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const waitStarted = async () => {
    for (let i = 0; i < 100; i++) {
      if (releases.length) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('模型请求未启动');
  };
  const config = {
    targetDate: today(),
    minutes: 30,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    requirements: '保留要求',
  };
  for (const kind of ['plan', 'note']) {
    const start =
      kind === 'plan'
        ? 'learning-plans/generate'
        : `courses/${c.insertId}/chapters/${ch.insertId}/note/generate`;
    const payload =
      kind === 'plan'
        ? { courseId: c.insertId, settings: config }
        : { version: 0, requirements: '保留要求' };
    const first = await call(start, payload);
    assert.equal(first.status, 202, JSON.stringify(first));
    await waitStarted();
    const prefix = kind === 'plan' ? 'learning-plan-jobs' : 'notes/jobs';
    assert.equal((await call(`${prefix}/${first.data.jobId}/cancel`, {}, true)).status, 409);
    assert.equal((await call(`${prefix}/${first.data.jobId}/cancel`, {})).status, 200);
    assert.equal(signals.at(-1).aborted, true);
    // 模拟已经离开模型服务器的晚到结果，不能覆盖 cancelled。
    releases.shift()(
      kind === 'plan'
        ? JSON.stringify({
            tasks: [
              { chapterId: ch.insertId, kind: 'read', date: today(), minutes: 15, title: '阅读' },
            ],
          })
        : '生成的笔记',
    );
    await new Promise((r) => setTimeout(r, 40));
    const table = kind === 'plan' ? 'learning_plan_jobs' : 'note_ai_jobs';
    const [rows] = await db.execute(`SELECT status FROM ${table} WHERE id=?`, [first.data.jobId]);
    assert.equal(rows[0].status, 'cancelled');
    const retry = await call(start, payload);
    assert.equal(retry.status, 202);
    await waitStarted();
    releases.shift()(
      kind === 'plan'
        ? JSON.stringify({
            tasks: [
              { chapterId: ch.insertId, kind: 'read', date: today(), minutes: 15, title: '阅读' },
            ],
          })
        : '重试笔记',
    );
    await new Promise((r) => setTimeout(r, 40));
    const [done] = await db.execute(`SELECT status FROM ${table} WHERE id=?`, [retry.data.jobId]);
    assert.equal(done[0].status, 'done');
  }
  console.log(
    'PASS cancellation: ownership, upstream abort, late results ignored, retry succeeds for plans and notes',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  await db.end();
}
