import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mysql from 'mysql2/promise';
import { ensureAdminTasks, registerAdminTasks } from './admin-task-actions.js';
test('管理员任务详情隐藏正文，取消禁止重复，重试防重复且保留原任务', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  let uid, server;
  const ids = [];
  let aborted = 0;
  const audits = [];
  try {
    await ensureAdminTasks(db);
    const [u] = await db.execute(
      "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'任务管理测试','','disabled-test-login')",
      ['admin_tasks_' + Date.now()],
    );
    uid = u.insertId;
    const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'测试课程')", [uid]);
    const job = async (status) => {
      const [r] = await db.execute(
        'INSERT INTO course_generation_jobs(user_id,course_id,kind,status,input_json) VALUES(?,?,?,?,?)',
        [uid, c.insertId, 'chapters', status, JSON.stringify({ text: 'PRIVATE_BODY' })],
      );
      ids.push(r.insertId);
      return r.insertId;
    };
    const running = await job('running'),
      failed = await job('failed');
    const app = express();
    app.use(express.json());
    app.locals.adminTasks = {
      course: {
        abort() {
          aborted++;
        },
        validate: async () => {},
        retry: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return job('running');
        },
      },
    };
    const route = (method, path, fn) =>
      app[method]('/api/admin' + path, (req, res, next) => {
        req.user = { sub: uid };
        Promise.resolve(fn(req, res)).catch(next);
      });
    registerAdminTasks(
      route,
      app,
      db,
      async (con, actor, action, target, result, detail) => {
        audits.push({ action, detail });
      },
      () => '处理失败',
    );
    app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const call = async (path, body) => {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}/api/admin/jobs/course/${path}`,
        {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      return { status: r.status, data: await r.json() };
    };
    assert.equal(JSON.stringify((await call(running)).data).includes('PRIVATE_BODY'), false);
    assert.equal((await call(running + '/cancel', { reason: '' })).status, 400);
    assert.equal((await call(running + '/cancel', { reason: '停止异常任务' })).status, 200);
    assert.equal(aborted, 1);
    assert.equal((await call(running + '/cancel', { reason: '重复取消' })).status, 409);
    const [late] = await db.execute(
      "UPDATE course_generation_jobs SET status='done' WHERE id=? AND status='running'",
      [running],
    );
    assert.equal(late.affectedRows, 0);
    app.locals.runtime = {
      assert() {
        throw Object.assign(new Error('AI 生成已暂停，请稍后再试'), { status: 503 });
      },
    };
    const paused = (await call(failed)).data.job;
    assert.equal(paused.canRetry, false);
    assert.match(paused.retryReason, /暂停/);
    assert.equal((await call(failed + '/retry', { reason: '暂停期间重试' })).status, 503);
    assert.equal(
      (
        await db.execute(
          'SELECT COUNT(*) AS total FROM admin_task_retries WHERE source=? AND old_id=?',
          ['course', failed],
        )
      )[0][0].total,
      0,
    );
    delete app.locals.runtime;
    const races = await Promise.all([
      call(failed + '/retry', { reason: '重试失败任务' }),
      call(failed + '/retry', { reason: '重试失败任务' }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [202, 409]);
    const detail = (await call(failed)).data.job;
    assert.equal(detail.canRetry, false);
    assert.ok(detail.newJobId);
    assert.equal(detail.status, 'failed');
    assert.equal(audits.filter((a) => a.action === 'task_cancel').length, 1);
    app.locals.adminTasks.course.validate = async () => {
      throw Object.assign(new Error('资料已变化'), { status: 409 });
    };
    const changed = await job('failed');
    assert.equal((await call(changed + '/retry', { reason: '重新尝试' })).status, 409);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    for (const id of ids)
      await db.execute("DELETE FROM admin_task_retries WHERE source='course' AND old_id=?", [id]);
    if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
    await db.end();
  }
});
