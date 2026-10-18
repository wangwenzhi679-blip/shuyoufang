import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('资料异常筛选跨批次保持总数、排序和分页，开发代理透传管理员身份', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const prefix = 'material_page_' + Date.now(),
    users = [],
    ids = [];
  let admin;
  const get = async (url, origin = 'http://127.0.0.1:8005') => {
    const r = await fetch(`${origin}/api/admin/${url}`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    for (const role of ['admin', 'student']) {
      const [row] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [prefix + role, '分页测试', '', 'disabled-test-login', role],
      );
      users.push(row.insertId);
    }
    admin = jwt.sign({ sub: users[0] }, process.env.JWT_SECRET);
    const [course] = await db.execute('INSERT INTO courses(user_id,title) VALUES(?,?)', [
      users[1],
      prefix,
    ]);
    for (let i = 0; i < 132; i++) {
      const [row] = await db.execute(
        "INSERT INTO course_materials(course_id,original_name,stored_name,size_bytes,extracted_text,preview_name,admin_status,created_at) VALUES(?,?,?,?,?,?,'paused','2026-10-18 10:00:00')",
        [
          course.insertId,
          prefix + '_' + i + '.pdf',
          prefix + '_' + i + '.pdf',
          10,
          '',
          prefix + '_' + i + '.preview.pdf',
        ],
      );
      ids.push(row.insertId);
    }
    for (const issue of ['original_missing', 'preview_missing', 'empty_text']) {
      const url =
        'materials?' +
        new URLSearchParams({ owner: String(users[1]), status: 'paused', issue, page: '7' });
      const result = await get(url);
      assert.equal(result.status, 200);
      assert.equal(result.data.total, 132);
      assert.equal(result.data.items.length, 12);
      assert.deepEqual(
        result.data.items.map((x) => x.id),
        ids.slice(0, 12).reverse(),
      );
      assert.equal(result.data.owner_scope.account, prefix + 'student');
      assert.doesNotMatch(JSON.stringify(result.data), /cursor_time|stored_name|preview_name/);
    }
    const proxy = await get('me', 'http://127.0.0.1:5173');
    assert.equal(proxy.status, 200);
    assert.equal(proxy.data.user.id, users[0]);
    const blocked = await fetch('http://127.0.0.1:8005/api/account/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(blocked.status, 403);
  } finally {
    if (users.length) await db.query('DELETE FROM users WHERE id IN (?)', [users]);
    await db.end();
  }
});
