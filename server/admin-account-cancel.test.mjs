import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('注销仅限学习账号：确认、并发、会话撤销、不可恢复与日志', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const ids = [],
    suffix = Date.now().toString().slice(-9),
    student = 'cu' + suffix,
    admin = 'ca' + suffix;
  const request = async (path, token, method = 'GET', body) => {
    const r = await fetch('http://127.0.0.1:8005/api/' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    for (const [account, role] of [
      [student, 'student'],
      [admin, 'admin'],
    ]) {
      const [r] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [account, '注销功能测试', '', await bcrypt.hash('Testpass12', 4), role],
      );
      ids.push(r.insertId);
    }
    const token = (
      await request('admin/login', null, 'POST', {
        account: admin,
        password: 'Testpass12',
      })
    ).data.token;
    const old = jwt.sign({ sub: ids[0], version: 0 }, process.env.JWT_SECRET);
    const cancel = (id, account, version = 0) =>
      request(`admin/users/${id}/cancel`, token, 'POST', {
        account,
        version,
        reason: '隔离测试账号注销',
      });
    assert.equal(
      (
        await request(`admin/users/${ids[0]}/cancel`, old, 'POST', {
          account: student,
          version: 0,
          reason: '无权',
        })
      ).status,
      403,
    );
    assert.equal((await cancel(ids[1], admin)).status, 403);
    assert.equal((await cancel(ids[0], 'wrong')).status, 400);
    assert.equal((await cancel(ids[0], student, 99)).status, 409);
    const results = await Promise.all([cancel(ids[0], student), cancel(ids[0], student)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await request('courses', old)).status, 403);
    assert.equal(
      (
        await request('auth/login', null, 'POST', {
          account: student,
          password: 'Testpass12',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(`admin/users/${ids[0]}/status`, token, 'PATCH', {
          status: 'active',
          version: 1,
          reason: '尝试恢复',
        })
      ).status,
      409,
    );
    const list = await request(`admin/users?status=cancelled&q=${student}`, token);
    assert.equal(list.status, 200);
    assert.equal(list.data.items.length, 1);
    const [[row]] = await db.execute('SELECT status,status_version,email FROM users WHERE id=?', [
      ids[0],
    ]);
    assert.equal(row.status, 'cancelled');
    assert.equal(row.status_version, 1);
    assert.equal(row.email, null);
    const [[log]] = await db.execute(
      "SELECT COUNT(*) n FROM admin_action_logs WHERE actor_id=? AND action='user_cancel' AND result='success'",
      [ids[1]],
    );
    assert.equal(Number(log.n), 1);
  } finally {
    if (ids.length) {
      await db.query('DELETE FROM admin_action_logs WHERE actor_id IN (?) OR target_id IN (?)', [
        ids,
        ids.map(String),
      ]);
      await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
    }
    await db.end();
  }
});
