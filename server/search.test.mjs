import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import assert from 'node:assert/strict';
import { registerSearch } from './search.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid, server;
try {
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'搜索测试','test','disabled-test-login')",
    [`search_${Date.now()}`],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'检索课程')", [uid]);
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'检索章节')",
    [c.insertId],
  );
  const [m] = await db.execute(
    "INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text) VALUES(?,'资料.pdf','search-test.pdf','application/pdf',1,'检索资料正文 % _ 专属关键词')",
    [c.insertId],
  );
  await db.execute('INSERT INTO chapter_notes(chapter_id,course_id,user_id,body) VALUES(?,?,?,?)', [
    ch.insertId,
    c.insertId,
    uid,
    '检索笔记正文',
  ]);
  const [p] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'练习')",
    [c.insertId, ch.insertId],
  );
  const [q] = await db.execute(
    "INSERT INTO practice_questions(practice_id,question_type,question_text,options_json,answer_text,analysis_text,sort_order) VALUES(?,'单选题','检索错题',?,'A','说明',0)",
    [p.insertId, JSON.stringify(['A. 对', 'B. 错'])],
  );
  await db.execute('INSERT INTO wrong_questions(question_id,last_answer) VALUES(?,?)', [
    q.insertId,
    JSON.stringify(['B']),
  ]);
  const app = express();
  registerSearch(
    app,
    db,
    (req, res, next) => {
      req.user = { sub: req.headers.foreign ? uid + 100000 : uid };
      next();
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  );
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}/api/search`;
  const call = async (params = {}, foreign = false) => {
    const r = await fetch(origin + '?' + new URLSearchParams(params), {
      headers: foreign ? { foreign: '1' } : {},
    });
    return { status: r.status, data: await r.json() };
  };
  let d = await call({ q: '检索' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.deepEqual(
    new Set(d.data.results.map((r) => r.type)),
    new Set(['course', 'chapter', 'material', 'note', 'wrong']),
  );
  assert.equal(d.data.total, 5);
  assert.ok(d.data.results.every((r) => r.courseId === c.insertId && !('body' in r)));
  assert.equal((await call({ q: '检索' }, true)).data.total, 0);
  assert.equal((await call({ q: '检索', courseId: c.insertId }, true)).status, 404);
  assert.equal((await call({ q: '检索', type: 'note' })).data.total, 1);
  assert.equal((await call({ q: '%' })).data.total, 1);
  assert.equal((await call({ q: '_' })).data.total, 1);
  assert.equal((await call({ q: '专属关键词' })).data.results[0].id, m.insertId);
  assert.equal((await call()).data.total, 0);
  assert.equal((await call({ q: '不存在' })).data.total, 0);
  assert.equal((await call({ q: '检索', page: '0' })).status, 400);
  for (let i = 0; i < 25; i++)
    await db.execute('INSERT INTO course_chapters(course_id,title) VALUES(?,?)', [
      c.insertId,
      `分页检索${i}`,
    ]);
  d = await call({ q: '分页检索' });
  assert.equal(d.data.total, 25);
  assert.equal(d.data.results.length, 20);
  const d2 = await call({ q: '分页检索', page: 2 });
  assert.equal(d2.data.results.length, 5);
  assert.ok(!d2.data.results.some((r) => d.data.results.some((a) => a.id === r.id)));
  await db.execute('DELETE FROM course_materials WHERE id=?', [m.insertId]);
  assert.equal((await call({ q: '专属关键词' })).data.total, 0);
  console.log(
    'PASS: search five types, ownership, filters, literal symbols, snippets, pagination and deleted content',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
