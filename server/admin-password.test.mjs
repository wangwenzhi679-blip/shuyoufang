import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sessionAuth } from './admin.js';
import { registerAdminPassword } from './admin-password.js';
test('修改密码验证旧密码，撤销旧登录且日志不含密码', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  let uid, server;
  const logs = [];
  try {
    const [u] = await db.execute(
      "INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,'密码测试','',?,'admin')",
      ['password_test_' + Date.now(), await bcrypt.hash('OldTestPass1', 4)],
    );
    uid = u.insertId;
    const token = jwt.sign({ sub: uid, version: 0 }, 'password-test-secret');
    const app = express();
    app.use(express.json());
    const auth = sessionAuth(db, 'password-test-secret');
    const route = (m, p, fn) =>
      app[m](p, auth, (req, res, next) => {
        if (req.user.role !== 'admin') return res.sendStatus(403);
        Promise.resolve(fn(req, res)).catch(next);
      });
    registerAdminPassword(route, db, async (con, actor, action, target, result, detail) =>
      logs.push({ action, result, detail }),
    );
    app.get('/me', auth, (req, res) => res.json({ ok: true }));
    app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const call = async (body) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/password`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await r.text();
      return r.status;
    };
    assert.equal(
      await call({
        currentPassword: 'WrongPass1',
        newPassword: 'NewTestPass2',
        confirmPassword: 'NewTestPass2',
      }),
      400,
    );
    assert.equal(
      await call({
        currentPassword: 'OldTestPass1',
        newPassword: 'NewTestPass2',
        confirmPassword: 'DifferentPass3',
      }),
      400,
    );
    assert.equal(
      await call({
        currentPassword: 'OldTestPass1',
        newPassword: 'NewTestPass2',
        confirmPassword: 'NewTestPass2',
      }),
      200,
    );
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${server.address().port}/me`, {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).status,
      401,
    );
    const [[user]] = await db.execute('SELECT password_hash,status_version FROM users WHERE id=?', [
      uid,
    ]);
    assert.equal(user.status_version, 1);
    assert.ok(await bcrypt.compare('NewTestPass2', user.password_hash));
    assert.equal(JSON.stringify(logs).includes('TestPass'), false);
    assert.equal(logs.filter((l) => l.result === 'success').length, 1);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
    await db.end();
  }
});
