import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { jobDiagnostic } from './admin-job-diagnostic.mjs';

test('任务诊断只返回归类信息，不回显密钥、正文或供应商原文', () => {
  const cases = [
    ['HTTP 401 api key sk-SECRET PRIVATE_TEXT', 'AUTH', 401],
    ['rate limit HTTP429', 'RATE_LIMIT', null],
    ['Timeout PRIVATE_TEXT', 'TIMEOUT', null],
    ['ENOSPC path C:/PRIVATE', 'STORAGE', null],
    ['invalid JSON PRIVATE_TEXT', 'RESPONSE', null],
    ['unknown PRIVATE_TEXT Bearer secret', 'UNKNOWN', null],
  ];
  for (const [error, code, status] of cases) {
    const result = jobDiagnostic({ status: 'failed', error_text: error });
    assert.equal(result.code, code);
    assert.equal(result.httpStatus, status);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|Bearer|C:\//);
  }
  assert.equal(jobDiagnostic({ status: 'done', error_text: '401' }), null);
  assert.equal(jobDiagnostic({ status: 'failed', error_text: null }).code, 'UNKNOWN');
});

test('管理详情与精确账户查询：分页、摘要限长、敏感字段过滤及角色隔离', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const prefix = `detail_${Date.now()}`,
    users = [],
    jobs = [],
    logs = [];
  const call = async (url, token) => {
    const res = await fetch(`http://127.0.0.1:8005/api/admin/${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, data: await res.json() };
  };
  try {
    for (const [role, ending] of [
      ['admin', 'manager'],
      ['student', 'a'],
      ['student', 'a0'],
    ]) {
      const [user] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash,role) VALUES(?,?,?,?,?)',
        [`${prefix}_${ending}`, prefix, '', 'disabled-test-login', role],
      );
      users.push(user.insertId);
    }
    const admin = jwt.sign({ sub: users[0] }, process.env.JWT_SECRET),
      student = jwt.sign({ sub: users[1] }, process.env.JWT_SECRET);
    const courses = [];
    for (const owner of users.slice(1)) {
      const [course] = await db.execute('INSERT INTO courses(user_id,title) VALUES(?,?)', [
        owner,
        `${prefix}_course`,
      ]);
      courses.push(course.insertId);
    }
    const chapters = [];
    for (let n = 1; n <= 21; n++) {
      const [chapter] = await db.execute(
        'INSERT INTO course_chapters(course_id,title,description,sort_order) VALUES(?,?,?,?)',
        [courses[0], `章 ${n}`, '章节说明', n],
      );
      chapters.push(chapter.insertId);
    }
    let materialId;
    for (const [index, cid] of courses.entries()) {
      const [material] = await db.execute(
        'INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text,preview_name) VALUES(?,?,?,?,?,?,?)',
        [
          cid,
          `${prefix}.pdf`,
          `${prefix}.pdf`,
          'application/pdf',
          100,
          '甲'.repeat(2001) + 'PRIVATE_TAIL',
          `${prefix}.preview.pdf`,
        ],
      );
      if (!index) materialId = material.insertId;
      const [job] = await db.execute(
        "INSERT INTO course_generation_jobs(user_id,course_id,kind,status,input_json,error_text) VALUES(?,?,'summary','failed',?,?)",
        [
          users[index + 1],
          cid,
          JSON.stringify({ private: 'PRIVATE_INPUT' }),
          'HTTP 401 token sk-SECRET PRIVATE_PROMPT',
        ],
      );
      jobs.push(job.insertId);
      const [log] = await db.execute(
        "INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,'student','user_login',?,'success',?)",
        [users[index + 1], `${prefix}_${index ? 'a0' : 'a'}`, String(users[index + 1]), prefix],
      );
      logs.push(log.insertId);
    }
    const [managed] = await db.execute(
      "INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,'admin','user_disable',?,'success',?)",
      [users[0], prefix, String(users[1]), prefix],
    );
    logs.push(managed.insertId);
    const detail = await call(`content/course/${courses[0]}`, admin);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.owner.id, users[1]);
    assert.equal(detail.data.chapters.total, 21);
    assert.equal(detail.data.chapters.items.length, 20);
    assert.equal(detail.data.chapters.items[0].id, chapters[0]);
    const second = await call(`content/course/${courses[0]}?chapterPage=2`, admin);
    assert.deepEqual(
      second.data.chapters.items.map((c) => c.id),
      [chapters[20]],
    );
    assert.doesNotMatch(
      JSON.stringify(detail.data),
      /stored_name|preview_name|extracted_text|PRIVATE_TAIL|password_hash/,
    );
    const material = await call(`content/material/${materialId}`, admin);
    assert.equal(material.status, 200);
    assert.equal(material.data.material.original_exists, false);
    assert.equal(material.data.material.preview_status, 'missing');
    assert.equal(material.data.material.text_excerpt, '甲'.repeat(2000));
    assert.equal(material.data.material.text_length, 2013);
    assert.doesNotMatch(
      JSON.stringify(material.data),
      /PRIVATE_TAIL|stored_name|preview_name|password_hash/,
    );
    for (const page of ['courses', 'materials', 'jobs']) {
      const result = await call(`${page}?owner=${users[1]}`, admin);
      assert.equal(result.status, 200);
      assert.equal(result.data.total, 1);
      assert.equal(result.data.items[0].account, `${prefix}_a`);
      assert.equal(result.data.owner_scope.account, `${prefix}_a`);
      const empty = await call(`${page}?owner=${users[1]}&q=unmatched_${prefix}`, admin);
      assert.equal(empty.data.total, 0);
      assert.equal((await call(`${page}?owner=abc`, admin)).status, 400);
    }
    const scoped = await call(`logs?owner=${users[1]}`, admin);
    assert.ok(scoped.data.items.some((l) => l.id === managed.insertId));
    assert.ok(scoped.data.items.some((l) => l.id === logs[0]));
    assert.ok(!scoped.data.items.some((l) => l.id === logs[1]));
    const task = await call(`jobs/course/${jobs[0]}`, admin);
    assert.equal(task.status, 200);
    assert.equal(task.data.job.diagnostic.code, 'AUTH');
    assert.doesNotMatch(
      JSON.stringify(task.data),
      /PRIVATE_INPUT|PRIVATE_PROMPT|sk-SECRET|error_text/,
    );
    for (const url of [
      `content/course/${courses[0]}`,
      `content/material/${materialId}`,
      `jobs/course/${jobs[0]}`,
    ]) {
      assert.equal((await call(url, student)).status, 403);
      assert.equal((await call(url, null)).status, 401);
    }
    assert.equal((await call('content/course/not-an-id', admin)).status, 400);
    assert.equal((await call(`content/course/${courses[0]}?chapterPage=0`, admin)).status, 400);
    assert.equal((await call('content/course/999999999999', admin)).status, 404);
    assert.equal((await call('content/material/999999999999', admin)).status, 404);
    const [[unchanged]] = await db.execute(
      'SELECT CHAR_LENGTH(extracted_text) AS size FROM course_materials WHERE id=?',
      [materialId],
    );
    assert.equal(unchanged.size, 2013);
  } finally {
    if (logs.length) await db.query('DELETE FROM admin_action_logs WHERE id IN (?)', [logs]);
    if (users.length) await db.query('DELETE FROM users WHERE id IN (?)', [users]);
    await db.end();
  }
});
