import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

test('公告完整生命周期、并发保护、公开范围、筛选与异常脱敏', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const prefix = `admin_ext_${Date.now()}`,
    ids = [],
    announcements = [];
  const api = async (path, token, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:8005/api/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    for (const role of ['admin', 'student']) {
      const [r] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [`${prefix}_${role}`, '管理扩展测试', '', 'disabled-test-login', role],
      );
      ids.push(r.insertId);
    }
    const admin = jwt.sign({ sub: ids[0] }, process.env.JWT_SECRET),
      student = jwt.sign({ sub: ids[1] }, process.env.JWT_SECRET);
    const content = {
      title: prefix,
      body: '第一行\n第二行 <script>alert(1)</script>',
      placement: 'login',
      endsAt: null,
    };
    const create = (body) => api('admin/announcements', admin, 'POST', body);
    assert.equal((await api('admin/announcements', student, 'POST', content)).status, 403);
    assert.equal((await create({ ...content, endsAt: '2000-01-01T00:00:00Z' })).status, 400);
    const created = await create(content);
    assert.equal(created.status, 201);
    const id = created.data.id;
    announcements.push(id);
    const publicItems = async (placement) =>
      (await api(`announcements?placement=${placement}`)).data.items;
    assert.ok(!(await publicItems('login')).some((item) => item.id === id));
    const action = (action, version) =>
      api(`admin/announcements/${id}/action`, admin, 'POST', { action, version });
    assert.equal((await action('publish', 1)).status, 200);
    assert.equal((await action('publish', 1)).status, 409);
    assert.ok((await publicItems('login')).some((item) => item.id === id));
    assert.ok(!(await publicItems('home')).some((item) => item.id === id));
    assert.equal(
      (
        await api(`admin/announcements/${id}`, admin, 'PATCH', {
          ...content,
          version: 2,
          title: prefix + ' edited',
        })
      ).status,
      200,
    );
    assert.ok(
      !(await publicItems('login')).some((item) => item.id === id),
      'editing published content returns to draft',
    );
    const races = await Promise.all([action('publish', 3), action('publish', 3)]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await action('withdraw', 4)).status, 200);
    assert.ok(!(await publicItems('login')).some((item) => item.id === id));
    assert.equal((await action('delete', 5)).status, 200);
    const deleted = await api(`admin/announcements?status=deleted&q=${prefix}`, admin);
    assert.equal(deleted.data.total, 1);
    assert.equal((await action('restore', 6)).status, 200);
    assert.ok(!(await publicItems('login')).some((item) => item.id === id));
    assert.equal((await action('publish', 7)).status, 200);
    await db.execute(
      'UPDATE platform_announcements SET ends_at=NOW()-INTERVAL 1 SECOND WHERE id=?',
      [id],
    );
    assert.ok(
      !(await publicItems('login')).some((item) => item.id === id),
      'expired announcements hidden',
    );
    assert.equal((await api('announcements?placement=other')).status, 400);
    assert.equal((await api('admin/users?from=2026-99-99', admin)).status, 400);
    assert.equal((await api('admin/users?from=2026-02-30', admin)).status, 400);
    assert.equal((await api('admin/users?from=2026-10-09&to=2026-10-01', admin)).status, 400);
    assert.equal((await api(`admin/users?q=${prefix}&role=student`, admin)).data.total, 1);
    assert.equal((await api(`admin/users?q=${prefix}&role=admin`, admin)).data.total, 1);
    assert.equal(
      (await api(`admin/users?q=${prefix}&from=2000-01-01&to=2000-01-01`, admin)).data.total,
      0,
    );
    const [c] = await db.execute('INSERT INTO courses(user_id,title) VALUES(?,?)', [
      ids[1],
      prefix,
    ]);
    await db.execute(
      'INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text,preview_name) VALUES(?,?,?,?,?,?,?)',
      [
        c.insertId,
        prefix + '.pdf',
        prefix + '.pdf',
        'application/pdf',
        10,
        '',
        prefix + '.preview.pdf',
      ],
    );
    for (const issue of ['original_missing', 'preview_missing', 'empty_text'])
      assert.equal((await api(`admin/materials?q=${prefix}&issue=${issue}`, admin)).data.total, 1);
    await db.execute(
      "INSERT INTO course_generation_jobs(user_id,course_id,kind,status,input_json,error_text) VALUES(?,?,'summary','failed',?,?)",
      [
        ids[1],
        c.insertId,
        JSON.stringify({ private: 'secret prompt' }),
        'Authentication 401 api key sk-testsecret01234567890123456789',
      ],
    );
    const jobs = await api(`admin/jobs?q=${prefix}&status=failed`, admin);
    assert.equal(jobs.status, 200);
    assert.equal(jobs.data.items[0].error_summary, 'AI 服务鉴权失败');
    assert.doesNotMatch(JSON.stringify(jobs.data), /sk-test|secret prompt|error_text|input_json/);
    const overview = await api('admin/overview', admin);
    assert.ok(overview.data.recentFailures.some((item) => item.account === `${prefix}_student`));
    assert.doesNotMatch(JSON.stringify(overview.data), /sk-test|error_text/);
    const logs = await api(
      `admin/logs?q=${prefix}&action=announcement_publish&result=success`,
      admin,
    );
    assert.equal(logs.data.total, 3);
  } finally {
    if (announcements.length)
      await db.query('DELETE FROM platform_announcements WHERE id IN (?)', [announcements]);
    if (ids.length) {
      await db.query('DELETE FROM admin_action_logs WHERE actor_id IN (?)', [ids]);
      await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
    }
    await db.end();
  }
});
