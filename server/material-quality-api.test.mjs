import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
try {
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'公式检查','test','disabled-test-login')",
    ['formula_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'公式检查课程')", [
    uid,
  ]);
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章 矩阵')",
    [c.insertId],
  );
  const text =
    '第一章 矩阵\n' +
    '矩阵运算要求保持各行各列的顺序。'.repeat(10) +
    '\n解矩阵方程 □ − □ X = □ □\n';
  await db.execute(
    'INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text) VALUES(?,?,?,?,?,?)',
    [
      c.insertId,
      '矩阵.docx',
      'formula-test-no-file.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      1,
      text,
    ],
  );
  const token = jwt.sign({ sub: uid }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const base = `http://127.0.0.1:8005/api/courses/${c.insertId}/chapters/${ch.insertId}`;
  const call = async (suffix, body) => {
    const r = await fetch(base + suffix, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const reading = await call('/content');
  assert.equal(reading.status, 200);
  assert.equal(reading.data.sections[0].originalRequired, true);
  const summary = await call('/summary', {});
  assert.equal(summary.status, 422);
  assert.match(summary.data.message, /未识别的公式/);
  const [[saved]] = await db.execute(
    'SELECT COUNT(*) n FROM chapter_summaries WHERE chapter_id=?',
    [ch.insertId],
  );
  assert.equal(Number(saved.n), 0);
  console.log(
    'PASS live API: Word extraction marked for original reading; damaged formulas rejected without saving a summary',
  );
} finally {
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
