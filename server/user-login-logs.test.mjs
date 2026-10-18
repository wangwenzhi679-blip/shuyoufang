import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('学习用户登录记录、角色筛选及日志脱敏', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const prefix = `ll${String(Date.now()).slice(-6)}`,
    ids = [];
  const api = async (url, body, token) => {
    const response = await fetch(`http://127.0.0.1:8005/api/${url}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    for (const role of ['student', 'admin']) {
      const [r] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [prefix + '_' + role, '日志验证', '', await bcrypt.hash('testPassword123', 4), role],
      );
      ids.push(r.insertId);
    }
    const admin = jwt.sign({ sub: ids[1] }, process.env.JWT_SECRET);
    assert.equal(
      (await api('auth/login', { account: prefix + '_student', password: 'wrongPassword123' }))
        .status,
      401,
    );
    const login = await api('auth/login', {
      account: prefix + '_student',
      password: 'testPassword123',
    });
    assert.equal(login.status, 200);
    const logs = await api(`admin/logs?q=${prefix}&role=student&action=user_login`, null, admin);
    assert.equal(logs.status, 200);
    assert.equal(logs.data.total, 2);
    assert.ok(logs.data.items.every((item) => item.actor_role === 'student'));
    assert.deepEqual(logs.data.items.map((item) => item.result).sort(), ['failed', 'success']);
    assert.doesNotMatch(
      JSON.stringify(logs.data),
      /testPassword|wrongPassword|password_hash|Bearer/,
    );
    assert.equal(
      (await api(`admin/logs?q=${prefix}&role=admin&action=user_login`, null, admin)).data.total,
      0,
    );
    assert.equal((await api('admin/logs', null, login.data.token)).status, 403);
  } finally {
    if (ids.length) {
      await db.query('DELETE FROM admin_action_logs WHERE actor_id IN (?)', [ids]);
      await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
    }
    await db.end();
  }
});
