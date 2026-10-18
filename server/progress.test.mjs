import { getOverview } from './overview.js';
import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import assert from 'node:assert/strict';
import { ensureProgress, registerProgress } from './progress.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid, server;
try {
  await ensureProgress(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'进度测试','test','disabled')",
    ['progress_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'进度测试课程')", [
    uid,
  ]);
  const cid = c.insertId;
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')", [
    cid,
  ]);
  const id = ch.insertId;
  const tasks = [
    { id: 'auto', chapterId: id, kind: 'read', completedAt: null },
    { id: 'manual', chapterId: id, kind: 'read', completedAt: '2026-10-01' },
    { id: 'practice', chapterId: id, kind: 'practice', completedAt: null },
  ];
  await db.execute(
    'INSERT INTO learning_plans(user_id,course_id,settings_json,tasks_json,version) VALUES(?,?,?,?,1)',
    [uid, cid, '{}', JSON.stringify(tasks)],
  );
  const app = express();
  app.use(express.json());
  registerProgress(
    app,
    db,
    (req, res, next) => {
      req.user = { sub: req.headers.foreign ? uid + 100000 : uid };
      next();
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  );
  app.use((e, req, res, next) => res.status(500).json({ message: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const call = async (completed, foreign = false) => {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/courses/${cid}/chapters/${id}/progress`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(foreign ? { foreign: '1' } : {}) },
        body: JSON.stringify({ completed }),
      },
    );
    return res.status;
  };
  const read = async () => {
    const [rows] = await db.execute(
      'SELECT tasks_json,version FROM learning_plans WHERE course_id=?',
      [cid],
    );
    return {
      ...rows[0],
      tasks:
        typeof rows[0].tasks_json === 'string'
          ? JSON.parse(rows[0].tasks_json)
          : rows[0].tasks_json,
    };
  };
  assert.equal(await call(true, true), 404);
  assert.equal(await call('yes'), 400);
  assert.equal(await call(true), 200);
  let state = await read();
  assert.equal(state.tasks[0].completionSource, 'chapter');
  assert.equal(state.tasks[1].completedAt, '2026-10-01');
  assert.equal(state.tasks[2].completedAt, null);
  const version = state.version;
  assert.equal(await call(true), 200);
  assert.equal((await read()).version, version);
  const [rows] = await db.execute('SELECT completed_at FROM course_chapters WHERE id=?', [id]);
  assert.ok(rows[0].completed_at);
  let overview = await getOverview(db, uid);
  assert.equal(overview.completedChapters, 1);
  assert.equal(overview.totalChapters, 1);
  assert.equal(Number(overview.courseCounts[0].completed_count), 1);
  await db.execute("UPDATE course_chapters SET title='改名章节',sort_order=9 WHERE id=?", [id]);
  assert.equal(await call(false), 200);
  state = await read();
  assert.equal(state.tasks[0].completedAt, null);
  overview = await getOverview(db, uid);
  assert.equal(overview.completedChapters, 0);
  assert.equal(Number(overview.courseCounts[0].completed_count), 0);
  assert.equal(state.tasks[1].completedAt, '2026-10-01');
  assert.equal(state.tasks[2].completedAt, null);
  await call(true);
  await db.execute('DELETE FROM course_chapters WHERE id=?', [id]);
  const [count] = await db.execute(
    'SELECT COUNT(*) AS total,SUM(completed_at IS NOT NULL) AS done FROM course_chapters WHERE course_id=?',
    [cid],
  );
  assert.equal(Number(count[0].total), 0);
  console.log(
    'PASS progress: persistence, ownership, validation, idempotency, plan sync and manual completion protection',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
