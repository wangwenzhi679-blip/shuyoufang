import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mysql from 'mysql2/promise';
import { registerAdmin } from './admin.js';

test('小连接池下并发失败操作正常返回，登录并发请求受限', { timeout: 20000 }, async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 2,
  });
  const app = express();
  app.use(express.json());
  const prefix = `admin_concurrency_${Date.now()}`;
  let actorId, targetId, announcementId, server;
  try {
    const [actor] = await db.execute(
      'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
      [prefix + '_admin', '并发测试', '', 'disabled-test-login', 'admin'],
    );
    actorId = actor.insertId;
    const [target] = await db.execute(
      'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
      [prefix + '_student', '并发测试', '', 'disabled-test-login', 'student'],
    );
    targetId = target.insertId;
    const [announcement] = await db.execute(
      'INSERT INTO platform_announcements(title,body) VALUES(?,?)',
      [prefix, '测试'],
    );
    announcementId = announcement.insertId;
    registerAdmin(
      app,
      db,
      (req, res, next) => {
        req.user = { sub: actorId, role: 'admin', account: prefix + '_admin' };
        next();
      },
      (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
      { secret: 'test-only', uploadRoot: '.', previewRoot: '.', imageRoot: '.' },
    );
    app.use((error, req, res, next) =>
      res.status(error.status || 500).json({ message: error.message }),
    );
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const request = async (path, method, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      await response.text();
      return response.status;
    };
    for (const [path, method, body] of [
      [
        `users/${targetId}/status`,
        'PATCH',
        { status: 'disabled', version: 99, reason: '验证并发冲突' },
      ],
      [`announcements/${announcementId}/action`, 'POST', { action: 'publish', version: 99 }],
    ])
      assert.deepEqual(
        await Promise.all(Array.from({ length: 12 }, () => request(path, method, body))),
        Array(12).fill(409),
      );
    const [[logs]] = await db.execute(
      "SELECT COUNT(*) AS total FROM admin_action_logs WHERE actor_id=? AND result='failed'",
      [actorId],
    );
    assert.equal(logs.total, 24);
    const statuses = await Promise.all(
      Array.from({ length: 16 }, () =>
        request('login', 'POST', { account: prefix + '_missing', password: 'wrong' }),
      ),
    );
    assert.equal(statuses.filter((status) => status === 401).length, 8);
    assert.equal(statuses.filter((status) => status === 429).length, 8);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (announcementId)
      await db.execute('DELETE FROM platform_announcements WHERE id=?', [announcementId]);
    await db.execute('DELETE FROM admin_action_logs WHERE actor_id=? OR target_id=?', [
      actorId || 0,
      prefix + '_missing',
    ]);
    for (const id of [targetId, actorId])
      if (id) await db.execute('DELETE FROM users WHERE id=?', [id]);
    await db.end();
  }
});
