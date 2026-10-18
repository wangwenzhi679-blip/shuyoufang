import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import assert from 'node:assert/strict';
import { ensureGenerationJobs, registerGenerationJobs } from './generation-jobs.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid, server;
const gates = [];
try {
  await ensureGenerationJobs(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'任务测试','test','disabled-test-login')",
    ['jobs_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'测试课程')", [uid]);
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'测试章节')",
    [c.insertId],
  );
  const app = express();
  app.use(express.json());
  registerGenerationJobs(
    app,
    db,
    (req, res, next) => {
      req.user = { sub: req.headers.foreign ? uid + 100000 : uid };
      next();
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    async (user, input, signal, save) => {
      await new Promise((resolve) => gates.push(resolve));
      signal.throwIfAborted();
      await save();
      return { kind: input.kind, value: '完成' };
    },
  );
  app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/generation-jobs`;
  const call = async (path = '', body, foreign = false) => {
    const r = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(foreign ? { foreign: '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const wait = async (id, status) => {
    for (let i = 0; i < 40; i++) {
      const jobs = (await call()).data.jobs;
      if (jobs.find((j) => j.id === id)?.status === status) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error('任务状态未变为' + status);
  };
  for (const kind of ['chapters', 'summary', 'practice']) {
    const input = {
      kind,
      courseId: c.insertId,
      ...(kind === 'chapters' ? {} : { chapterId: ch.insertId }),
      requirements: '保留条件',
    };
    const races = await Promise.all([call('', input), call('', input)]);
    assert.deepEqual(races.map((r) => r.status).sort(), [202, 409]);
    const id = races.find((r) => r.status === 202).data.jobId;
    assert.equal((await call()).data.jobs.find((j) => j.id === id).status, 'running');
    assert.equal((await call('', undefined, true)).data.jobs.length, 0);
    assert.equal((await call(`/${id}/cancel`, {}, true)).status, 404);
    assert.equal((await call(`/${id}/cancel`, {})).status, 200);
    gates.shift()();
    await new Promise((r) => setTimeout(r, 20));
    await wait(id, 'cancelled');
    const retry = await call(`/${id}/retry`, {});
    assert.equal(retry.status, 202);
    gates.shift()();
    await wait(retry.data.jobId, 'done');
    const restored = (await call()).data.jobs.find((j) => j.id === retry.data.jobId);
    assert.equal(restored.input.requirements, '保留条件');
    assert.equal((await call(`/${retry.data.jobId}/cancel`, {})).status, 409);
    assert.equal((await call(`/${retry.data.jobId}/dismiss`, {})).status, 200);
    assert.equal((await call()).data.jobs.length, 0);
  }
  console.log(
    'PASS: three job kinds, duplicate prevention, restored state, ownership, cancellation, late results, retry and dismissal',
  );
} finally {
  gates.forEach((r) => r());
  if (server) await new Promise((r) => server.close(r));
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
