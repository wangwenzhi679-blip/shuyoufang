import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let userId;
let adminForeignId;
try {
  const [adminForeign] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'隔离验证','test','disabled-test-login')",
    ['foreign_learning-notes_' + Date.now()],
  );
  adminForeignId = adminForeign.insertId;
  const [user] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'Notes test','test','disabled-test-login')",
    [`notes_test_${Date.now()}`],
  );
  userId = user.insertId;
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const [course] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'笔记测试课程')", [
    userId,
  ]);
  const [chapter] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'笔记测试章节')",
    [course.insertId],
  );
  const url = `http://127.0.0.1:8005/api/courses/${course.insertId}/chapters/${chapter.insertId}/note`;
  const call = async (body, access = token) => {
    const response = await fetch(url, {
      method: body ? 'PUT' : 'GET',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call()).data.note.body, '');
  assert.equal((await call({ body: '第一段\n\n第二段', version: 0 })).status, 200);
  assert.equal((await call()).data.note.body, '第一段\n\n第二段');
  const races = await Promise.all([
    call({ body: '窗口一', version: 1 }),
    call({ body: '窗口二', version: 1 }),
  ]);
  assert.deepEqual(races.map((item) => item.status).sort(), [200, 409]);
  assert.equal(
    (await call(undefined, jwt.sign({ sub: adminForeignId }, process.env.JWT_SECRET))).status,
    404,
  );
  assert.equal((await call(undefined, '')).status, 401);
  assert.equal((await call({ body: '', version: 2 })).status, 200);
  assert.equal((await call()).data.note.body, '');
  await db.execute('DELETE FROM course_chapters WHERE id=?', [chapter.insertId]);
  const [remaining] = await db.execute('SELECT chapter_id FROM chapter_notes WHERE chapter_id=?', [
    chapter.insertId,
  ]);
  assert.equal(remaining.length, 0);
  console.log(
    'PASS: notes persistence, paragraph preservation, concurrent conflict, account isolation, clear and cascade deletion',
  );
} finally {
  if (adminForeignId) await db.execute('DELETE FROM users WHERE id=?', [adminForeignId]);
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  await db.end();
}
