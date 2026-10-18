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
    ['foreign_wrong-review_' + Date.now()],
  );
  adminForeignId = adminForeign.insertId;
  const [user] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'Review test','test','disabled-test-login')",
    [`review_test_${Date.now()}`],
  );
  userId = user.insertId;
  const token = jwt.sign({ sub: userId, role: 'student' }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });
  async function api(path, method = 'GET', body, accessToken = token) {
    const response = await fetch(`http://127.0.0.1:8005/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data));
    return data;
  }
  const [course] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'Review test')", [
    userId,
  ]);
  const [chapter] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'Chapter')",
    [course.insertId],
  );
  const [practice] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'Practice')",
    [course.insertId, chapter.insertId],
  );
  for (let i = 0; i < 3; i++)
    await db.execute(
      "INSERT INTO practice_questions(practice_id,question_type,question_text,options_json,answer_text,analysis_text,sort_order) VALUES(?,'choice',? ,?,'A','Explanation',?)",
      [practice.insertId, `Question ${i}`, JSON.stringify(['A. Right', 'B. Wrong']), i],
    );
  const submit = () =>
    api(`courses/${course.insertId}/practices/${practice.insertId}/attempts`, 'POST', {
      answers: [
        { questionIndex: 0, answer: ['B'], correct: true },
        { questionIndex: 1, answer: [], correct: false },
        { questionIndex: 2, answer: ['A'], correct: false },
      ],
      correctCount: 3,
      totalCount: 3,
    });
  const firstAttempt = (await submit()).attempt;
  assert.equal(firstAttempt.correct_count, 1, 'server must grade answers');
  let items = (await api('wrong-questions')).questions;
  assert.equal(items.length, 0, 'submitting a paper must not automatically add wrong questions');
  await api(
    `courses/${course.insertId}/practices/${practice.insertId}/attempts/${firstAttempt.id}/wrong-questions/0`,
    'POST',
  );
  items = (await api('wrong-questions')).questions;
  assert.equal(items.length, 1, 'an answered wrong question can be added manually');
  const id = items[0].id;
  const secondAttempt = (await submit()).attempt;
  await api(
    `courses/${course.insertId}/practices/${practice.insertId}/attempts/${secondAttempt.id}/wrong-questions/0`,
    'POST',
  );
  items = (await api('wrong-questions')).questions;
  assert.equal(items.length, 1);
  assert.equal(items[0].wrong_count, 1, 'adding the same question is idempotent');
  assert.equal(
    (await api(`wrong-questions/${id}/review`, 'POST', { answer: ['A'] })).correct,
    true,
  );
  assert.equal(
    (await api('wrong-questions')).questions[0].mastered,
    false,
    'correct answer must not automatically master',
  );
  await api(`wrong-questions/${id}`, 'PATCH', { mastered: true });
  assert.equal((await api('wrong-questions')).questions[0].mastered, true);
  await api(`wrong-questions/${id}/review`, 'POST', { answer: ['B'] });
  items = (await api('wrong-questions')).questions;
  assert.equal(items[0].mastered, false);
  assert.equal(items[0].wrong_count, 2);
  const otherToken = jwt.sign({ sub: adminForeignId }, process.env.JWT_SECRET);
  assert.equal((await api('wrong-questions', 'GET', undefined, otherToken)).questions.length, 0);
  const denied = await fetch(`http://127.0.0.1:8005/api/wrong-questions/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mastered: true }),
  });
  assert.equal(denied.status, 404);
  console.log(
    'PASS: manual collection, server grading, deduplication, review, mastery, persistence and account isolation',
  );
} finally {
  if (adminForeignId) await db.execute('DELETE FROM users WHERE id=?', [adminForeignId]);
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  await db.end();
}
