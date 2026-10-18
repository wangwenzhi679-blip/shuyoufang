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
let otherUserId;
try {
  const unique = Date.now();
  const [created] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'Home test','test','disabled-test-login')",
    [`home_test_${unique}`],
  );
  userId = created.insertId;
  const [other] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'Other test','test','disabled-test-login')",
    [`home_other_${unique}`],
  );
  otherUserId = other.insertId;
  const token = jwt.sign({ sub: userId, role: 'student' }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });
  const otherToken = jwt.sign({ sub: otherUserId, role: 'student' }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });
  const api = async (path, method = 'GET', body, accessToken = token) => {
    const response = await fetch(`http://127.0.0.1:8005/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  const [course] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'Home course')", [
    userId,
  ]);
  const [chapter] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'Home chapter')",
    [course.insertId],
  );
  const [practice] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'Home practice')",
    [course.insertId, chapter.insertId],
  );
  await db.execute(
    "INSERT INTO practice_questions(practice_id,question_type,question_text,options_json,answer_text,analysis_text,sort_order) VALUES(?,'choice','Question',?,'A','Explanation',0)",
    [practice.insertId, JSON.stringify(['A. Right', 'B. Wrong'])],
  );
  const base = `courses/${course.insertId}/practices/${practice.insertId}`;
  let result = await api('learning-home');
  assert.equal(result.status, 200);
  assert.equal(result.data.unfinished[0].practice_id, practice.insertId);
  assert.equal(
    result.data.recent.course_id,
    course.insertId,
    'a course without a saved chapter is still resumable',
  );
  result = await api('learning-progress', 'POST', {
    courseId: course.insertId,
    chapterId: chapter.insertId,
  });
  assert.equal(result.status, 200);
  result = await api(`${base}/progress`, 'PUT', { answers: { 0: ['B'] } });
  assert.equal(result.status, 200);
  result = await api('learning-home');
  assert.equal(result.data.recent.chapter_id, chapter.insertId);
  assert.equal(result.data.unfinished[0].has_progress, true);
  result = await api(`courses/${course.insertId}`);
  assert.deepEqual(result.data.practices[0].in_progress.answers, { 0: ['B'] });
  result = await api('learning-home', 'GET', undefined, otherToken);
  assert.equal(result.data.unfinished.length, 0);
  assert.equal(result.data.recent, null);
  result = await api(`${base}/progress`, 'PUT', { answers: { 0: ['A'] } }, otherToken);
  assert.equal(result.status, 404);
  result = await api(`${base}/attempts`, 'POST', {
    answers: [{ questionIndex: 0, answer: ['B'], correct: false }],
    correctCount: 0,
    totalCount: 1,
  });
  assert.equal(result.status, 201);
  const attemptId = result.data.attempt.id;
  result = await api('learning-home');
  assert.equal(result.data.unfinished.length, 0);
  assert.equal(result.data.history[0].attempt_id, attemptId);
  result = await api(`learning-home/attempts/${attemptId}`);
  assert.deepEqual(result.data.attempt.answers[0].answer, ['B']);
  result = await api(`learning-home/attempts/${attemptId}`, 'GET', undefined, otherToken);
  assert.equal(result.status, 404);
  console.log(
    'PASS: learning home, answer draft, submission cleanup, exact history and account isolation',
  );
} finally {
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  if (otherUserId) await db.execute('DELETE FROM users WHERE id=?', [otherUserId]);
  await db.end();
}
