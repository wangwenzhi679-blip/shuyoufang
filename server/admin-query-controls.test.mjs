import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { ChapterImages, imageUsageDay } from './chapter-images.js';

test('管理筛选：状态与日期组合、日志目标/说明搜索和处理中状态', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const prefix = `admin_query_${Date.now()}`;
  const users = [];
  const logIds = [];
  let admin;
  async function get(url, token = admin) {
    const response = await fetch(`http://127.0.0.1:8005/api/admin/${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    for (const role of ['admin', 'student']) {
      const [user] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [`${prefix}_${role}`, prefix, '', 'disabled-test-login', role],
      );
      users.push(user.insertId);
    }
    admin = jwt.sign({ sub: users[0] }, process.env.JWT_SECRET);
    const student = jwt.sign({ sub: users[1] }, process.env.JWT_SECRET);
    const courses = [];
    const materials = [];
    for (const [index, status, date] of [
      [0, 'active', '2026-10-17 10:00:00'],
      [1, 'paused', '2026-10-18 10:00:00'],
    ]) {
      const [course] = await db.execute(
        'INSERT INTO courses(user_id,title,admin_status,created_at) VALUES(?,?,?,?)',
        [users[1], `${prefix}_course_${index}`, status, date],
      );
      courses.push(course.insertId);
      const [material] = await db.execute(
        'INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text,preview_name,admin_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          course.insertId,
          `${prefix}_${index}.pdf`,
          `${prefix}_${index}.pdf`,
          'application/pdf',
          10,
          '',
          `${prefix}_${index}.preview.pdf`,
          status,
          date,
        ],
      );
      materials.push(material.insertId);
    }
    const query = async (view, extra) =>
      get(`${view}?${new URLSearchParams({ q: prefix, ...extra })}`);
    assert.equal((await query('courses', {})).data.total, 2);
    assert.deepEqual(
      (
        await query('courses', { status: 'paused', from: '2026-10-18', to: '2026-10-18' })
      ).data.items.map((x) => x.id),
      [courses[1]],
    );
    assert.equal((await query('courses', { status: 'active', from: '2026-10-18' })).data.total, 0);
    assert.equal((await query('courses', { to: '2026-10-17' })).data.total, 1);
    assert.equal((await query('courses', { status: 'invalid' })).status, 400);
    assert.equal((await query('courses', { from: '2026-02-30' })).status, 400);
    assert.equal((await query('courses', { from: '2026-10-18', to: '2026-10-17' })).status, 400);
    for (const issue of ['', 'original_missing', 'preview_missing', 'empty_text']) {
      const result = await query('materials', {
        status: 'paused',
        issue,
        from: '2026-10-18',
        to: '2026-10-18',
      });
      assert.equal(result.status, 200);
      assert.equal(result.data.total, 1);
      assert.equal(result.data.items[0].id, materials[1]);
      assert.equal(result.data.items[0].stored_name, undefined);
      assert.equal(result.data.items[0].extracted_text, undefined);
    }
    assert.equal((await query('materials', { status: 'invalid' })).status, 400);
    async function log(action, target, result, detail = '') {
      const [row] = await db.execute(
        'INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,?,?,?,?,?)',
        [users[0], `${prefix}_operator`, 'admin', action, String(target), result, detail],
      );
      logIds.push(row.insertId);
    }
    await log('user_disable', users[1], 'success');
    await log('course_pause', courses[1], 'success');
    await log('material_pause', materials[1], 'success');
    await log('service_check', 'chapter_images', 'running', `${prefix}_reason`);
    await log('backup_create', `${prefix}_backup`, 'accepted');
    async function hasLog(q, id, result) {
      const r = await get('logs?' + new URLSearchParams({ q, ...(result ? { result } : {}) }));
      assert.equal(r.status, 200);
      assert.ok(
        r.data.items.some((x) => x.id === id),
        `${q}: log ${id}`,
      );
      return r;
    }
    await hasLog(`${prefix}_student`, logIds[0]);
    await hasLog(`${prefix}_course_1`, logIds[1]);
    await hasLog(`${prefix}_1.pdf`, logIds[2]);
    await hasLog(String(courses[1]), logIds[1]);
    assert.equal(
      (await hasLog(`${prefix}_reason`, logIds[3], 'running')).data.items[0].result,
      'running',
    );
    assert.equal(
      (await hasLog(`${prefix}_backup`, logIds[4], 'accepted')).data.items[0].result,
      'accepted',
    );
    assert.equal((await get('logs?result=unknown')).status, 400);
    for (const view of ['courses', 'materials', 'logs']) {
      assert.equal((await get(`${view}?q=${prefix}`, student)).status, 403);
      assert.equal((await get(`${view}?q=${prefix}`, null)).status, 401);
    }
  } finally {
    if (logIds.length) await db.query('DELETE FROM admin_action_logs WHERE id IN (?)', [logIds]);
    if (users.length) await db.query('DELETE FROM users WHERE id IN (?)', [users]);
    await db.end();
  }
});

test('配图当日用量与限额使用同一香港日期，累计量独立保留', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const table = `image_usage_test_${Date.now()}`;
  const isolated = {
    execute: (sql, args) => db.execute(sql.replaceAll('chapter_image_usage', table), args),
  };
  const manager = new ChapterImages(isolated, {}, {});
  try {
    await db.query(
      `CREATE TABLE ${table}(day_key CHAR(10) PRIMARY KEY,requests INT UNSIGNED NOT NULL DEFAULT 0)`,
    );
    manager.config.dailyLimit = 5;
    assert.equal(
      imageUsageDay(),
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()),
    );
    assert.deepEqual(await manager.usage('2026-10-18'), {
      totalRequests: 0,
      todayRequests: 0,
      usageDate: '2026-10-18',
      remainingRequests: 5,
    });
    await db.query(`INSERT INTO ${table} VALUES('2026-10-17',20),('2026-10-18',3)`);
    assert.deepEqual(await manager.usage('2026-10-18'), {
      totalRequests: 23,
      todayRequests: 3,
      usageDate: '2026-10-18',
      remainingRequests: 2,
    });
    const reservations = await Promise.all(
      Array.from({ length: 8 }, () => manager.reserve(5, '2026-10-18')),
    );
    assert.equal(reservations.filter(Boolean).length, 2);
    assert.equal((await manager.usage('2026-10-18')).remainingRequests, 0);
    assert.equal((await manager.usage('2026-10-19')).todayRequests, 0);
    manager.config.dailyLimit = 2;
    assert.equal((await manager.usage('2026-10-18')).remainingRequests, 0);
  } finally {
    await db.query(`DROP TABLE IF EXISTS ${table}`);
    await db.end();
  }
});
