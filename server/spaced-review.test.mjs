import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import { today } from './learning-plans.js';
import { addReviewDays, buildReviewDates } from '../shared/review-rhythm.mjs';
const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
const userIds = [];
try {
  for (let i = 0; i < 2; i++) {
    const [u] = await db.execute(
      "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'间隔复习测试','test','disabled-test-login')",
      [`spaced_review_${Date.now()}_${i}`],
    );
    userIds.push(u.insertId);
  }
  const token = jwt.sign({ sub: userIds[0] }, process.env.JWT_SECRET),
    foreign = jwt.sign({ sub: userIds[1] }, process.env.JWT_SECRET);
  const call = async (path = '', body, method = 'POST', access = token) => {
    const r = await fetch(`http://127.0.0.1:8005/api/review-schedules${path}`, {
      method: body ? method : 'GET',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'间隔验证课程')", [
    userIds[0],
  ]);
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'间隔验证章节')",
    [c.insertId],
  );
  const [practice] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'间隔验证练习')",
    [c.insertId, ch.insertId],
  );
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const [q] = await db.execute(
      "INSERT INTO practice_questions(practice_id,question_type,question_text,options_json,answer_text,analysis_text,sort_order) VALUES(?,'单选题',?,?,'A','解析',?)",
      [practice.insertId, `间隔题${i}`, JSON.stringify(['A. 正确', 'B. 错误']), i],
    );
    const [w] = await db.execute(
      'INSERT INTO wrong_questions(question_id,last_answer) VALUES(?,?)',
      [q.insertId, JSON.stringify(['B'])],
    );
    ids.push(w.insertId);
  }
  const first = addReviewDays(today(), 1),
    dates = buildReviewDates(first, 'spaced');
  const request = { wrongQuestionIds: [ids[0], ids[0]], date: first, strategy: 'spaced' };
  let r = await call('', request);
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 5);
  assert.deepEqual(r.data.dates, dates);
  assert.equal((await call('', request)).data.existing, 5);
  let list = (await call()).data.tasks;
  assert.deepEqual(
    list.map((t) => t.date),
    dates,
  );
  assert.equal((await call('', request, 'POST', foreign)).status, 404);
  assert.equal((await call('', undefined, 'GET', foreign)).data.tasks.length, 0);
  const cancelled = list[1];
  assert.equal(
    (await call(`/${cancelled.id}`, { version: cancelled.version }, 'DELETE')).status,
    200,
  );
  r = await call('', request);
  assert.equal(r.data.created, 1);
  assert.equal(r.data.existing, 4);
  list = (await call()).data.tasks;
  const completed = list[0];
  assert.equal(
    (await call(`/${completed.id}/submit`, { version: completed.version, answer: ['A'] })).data
      .correct,
    true,
  );
  assert.equal((await call('', request)).data.existing, 5);
  assert.deepEqual((await call(`/${completed.id}`)).data.task.answer, ['A']);
  const races = await Promise.all([
    call('', { wrongQuestionIds: [ids[1]], date: first, strategy: 'spaced' }),
    call('', { wrongQuestionIds: [ids[1]], date: first, strategy: 'spaced' }),
  ]);
  assert.deepEqual(
    races.map((r) => r.data.created).sort((a, b) => a - b),
    [0, 5],
  );
  await call('', { wrongQuestionIds: [ids[2]], date: dates[2] });
  r = await call('', { wrongQuestionIds: [ids[2]], date: first, strategy: 'spaced' });
  assert.equal(r.data.created, 4);
  assert.equal(r.data.existing, 1);
  const before = (await call()).data.tasks.length;
  assert.equal(
    (
      await call('', {
        wrongQuestionIds: [ids[3]],
        date: addReviewDays(today(), 350),
        strategy: 'spaced',
      })
    ).status,
    400,
  );
  assert.equal(
    (await call('', { wrongQuestionIds: [ids[3]], date: '2026-02-30', strategy: 'spaced' })).status,
    400,
  );
  assert.equal(
    (await call('', { wrongQuestionIds: [ids[3]], date: first, strategy: 'unknown' })).status,
    400,
  );
  assert.equal(
    (await call('', { wrongQuestionIds: [ids[3], 99999999], date: first, strategy: 'spaced' }))
      .status,
    404,
  );
  assert.equal((await call()).data.tasks.length, before);
  await db.execute('UPDATE wrong_questions SET mastered=TRUE WHERE id=?', [ids[4]]);
  assert.equal(
    (await call('', { wrongQuestionIds: [ids[4]], date: first, strategy: 'spaced' })).status,
    400,
  );
  assert.equal((await call()).data.tasks.length, before);
  console.log(
    'PASS: five-round dates, deduplicated IDs, repeats, races, account isolation, cancellation revival, completed history, manual overlap and atomic invalid requests',
  );
} finally {
  for (const uid of userIds) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
