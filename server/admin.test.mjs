import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('管理端权限、查询、账户停用恢复及旧登录失效', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const suffix = Date.now().toString().slice(-8),
    account = `ua${suffix}`,
    admin = `ma${suffix}`,
    ids = [];
  const request = async (path, token, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:8005/api/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    for (const [name, role] of [
      [account, 'student'],
      [admin, 'admin'],
    ]) {
      const [result] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [name, '管理验证', '', await bcrypt.hash('Testpass12', 4), role],
      );
      ids.push(result.insertId);
    }
    const forged = jwt.sign({ sub: ids[0], role: 'admin' }, process.env.JWT_SECRET);
    assert.equal((await request('admin/users', forged)).status, 403);
    assert.equal((await request('admin/overview')).status, 401);
    const login = await request('admin/login', null, 'POST', {
      account: admin,
      password: 'Testpass12',
    });
    assert.equal(login.status, 200);
    const token = login.data.token;
    for (const page of [
      'overview',
      'users',
      'courses',
      'materials',
      'jobs',
      'services',
      'logs',
      'me',
    ]) {
      const result = await request(`admin/${page}`, token);
      assert.equal(result.status, 200, `${page}: ${JSON.stringify(result.data)}`);
      assert.doesNotMatch(
        JSON.stringify(result.data),
        /password_hash|extracted_text|input_json|result_json|stored_name|preview_name|sk-[a-z0-9]{20}/i,
      );
    }
    assert.equal((await request('admin/users?page=0', token)).status, 400);
    assert.equal(
      (
        await request(`admin/users/${ids[1]}/status`, token, 'PATCH', {
          status: 'disabled',
          version: 0,
          reason: '权限测试',
        })
      ).status,
      403,
    );
    const old = jwt.sign({ sub: ids[0] }, process.env.JWT_SECRET);
    assert.equal((await request('courses', old)).status, 200);
    const change = (status, version) =>
      request(`admin/users/${ids[0]}/status`, token, 'PATCH', {
        status,
        version,
        reason: '自动验证账户状态',
      });
    assert.equal((await change('disabled', 0)).status, 200);
    assert.equal((await request('courses', old)).status, 403);
    assert.equal(
      (await request('auth/login', null, 'POST', { account, password: 'Testpass12' })).status,
      403,
    );
    assert.equal((await change('active', 0)).status, 409);
    assert.equal((await change('active', 1)).status, 200);
    assert.equal((await request('courses', old)).status, 401);
    const fresh = await request('auth/login', null, 'POST', { account, password: 'Testpass12' });
    assert.equal(fresh.status, 200);
    assert.equal((await request('courses', fresh.data.token)).status, 200);
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => change('disabled', 2)));
    assert.equal(concurrent.filter((result) => result.status === 200).length, 1);
    assert.equal(concurrent.filter((result) => result.status === 409).length, 3);
    const [[log]] = await db.execute(
      "SELECT COUNT(*) n FROM admin_action_logs WHERE actor_id=? AND action='user_disable' AND result='success'",
      [ids[1]],
    );
    assert.equal(Number(log.n), 2);
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
