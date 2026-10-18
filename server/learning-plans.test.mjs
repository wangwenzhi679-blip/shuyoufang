import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import { registerLearningPlans, today, validatePlan } from './learning-plans.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let userId, server;
try {
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'计划测试','test','disabled-test-login')",
    [`plan_${Date.now()}`],
  );
  userId = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'计划测试课程')", [
    userId,
  ]);
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'计划测试章节')",
    [c.insertId],
  );
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET),
    foreign = jwt.sign({ sub: userId + 100000 }, process.env.JWT_SECRET);
  const config = {
    targetDate: today(),
    minutes: 30,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    requirements: '简短',
  };
  const app = express();
  app.use(express.json());
  registerLearningPlans(
    app,
    db,
    (req, res, next) => {
      try {
        req.user = jwt.verify(
          req.headers.authorization.replace('Bearer ', ''),
          process.env.JWT_SECRET,
        );
        next();
      } catch {
        res.sendStatus(401);
      }
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    async () => {
      await new Promise((r) => setTimeout(r, 80));
      return JSON.stringify({
        tasks: [
          { chapterId: ch.insertId, kind: 'read', date: today(), minutes: 15, title: '阅读本章' },
          { chapterId: ch.insertId, kind: 'notes', date: today(), minutes: 15, title: '整理笔记' },
        ],
      });
    },
  );
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}/api/`;
  const call = async (path, body, method = 'POST', access = token) => {
    const response = await fetch(origin + path, {
      method: body ? method : 'GET',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  const races = await Promise.all([
    call('learning-plans/generate', { courseId: c.insertId, settings: config }),
    call('learning-plans/generate', { courseId: c.insertId, settings: config }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [202, 409]);
  assert.equal((await call('learning-plans')).data.plans.length, 0);
  let data;
  for (let i = 0; i < 30; i++) {
    data = (await call('learning-plans')).data;
    if (data.jobs[0].status === 'done') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(data.jobs[0].status, 'done');
  const job = data.jobs[0];
  const payload = {
    jobId: job.id,
    courseId: c.insertId,
    settings: config,
    tasks: job.result.tasks,
    version: 0,
  };
  const adoptions = await Promise.all([
    call('learning-plans/adopt', payload),
    call('learning-plans/adopt', payload),
  ]);
  assert.deepEqual(adoptions.map((r) => r.status).sort(), [200, 409]);
  data = (await call('learning-plans')).data;
  assert.equal(data.plans.length, 1);
  let plan = data.plans[0];
  assert.equal(plan.tasks[0].practiceId, null);
  assert.equal(
    (
      await call(
        `learning-plans/${plan.id}/tasks/${plan.tasks[0].id}`,
        { completed: true, version: plan.version },
        'PATCH',
        foreign,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        `learning-plans/${plan.id}/tasks/${plan.tasks[0].id}`,
        { completed: true, version: plan.version },
        'PATCH',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `learning-plans/${plan.id}/tasks/${plan.tasks[0].id}`,
        { completed: false, version: plan.version },
        'PATCH',
      )
    ).status,
    409,
  );
  plan = (await call('learning-plans')).data.plans[0];
  const completed = plan.tasks[0];
  assert.ok(completed.completedAt);
  assert.equal(
    (
      await call(
        'learning-plans',
        {
          courseId: c.insertId,
          settings: config,
          tasks: [{ ...plan.tasks[1], title: '调整后任务' }],
          version: plan.version,
        },
        'PUT',
      )
    ).status,
    200,
  );
  plan = (await call('learning-plans')).data.plans[0];
  assert.equal(plan.tasks[0].completedAt, completed.completedAt);
  assert.equal(plan.tasks[1].title, '调整后任务');
  assert.equal((await call('learning-plans', undefined, 'GET', foreign)).data.plans.length, 0);
  assert.throws(() =>
    validatePlan([{ ...plan.tasks[1], chapterId: 999999 }], config, [{ id: ch.insertId }]),
  );
  assert.throws(() =>
    validatePlan([{ ...plan.tasks[1], date: '2020-01-01' }], config, [{ id: ch.insertId }]),
  );
  await db.execute('DELETE FROM course_chapters WHERE id=?', [ch.insertId]);
  assert.equal((await call('learning-plans')).data.plans[0].tasks[0].available, false);
  plan = (await call('learning-plans')).data.plans[0];
  assert.equal(
    (await call(`learning-plans/${plan.id}`, { version: plan.version }, 'DELETE', foreign)).status,
    404,
  );
  assert.equal(
    (await call(`learning-plans/${plan.id}`, { version: plan.version - 1 }, 'DELETE')).status,
    409,
  );
  assert.equal(
    (await call(`learning-plans/${plan.id}`, { version: plan.version }, 'DELETE')).status,
    200,
  );
  assert.equal((await call('learning-plans')).data.plans.length, 0);
  const [kept] = await db.execute('SELECT id FROM courses WHERE id=?', [c.insertId]);
  assert.equal(kept.length, 1);
  console.log(
    'PASS: background generation, duplicate prevention, explicit adoption, concurrent conflict, manual completion, retained completed records, account isolation, task validation and deleted-chapter handling',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  await db.end();
}
