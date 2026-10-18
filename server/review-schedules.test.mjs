import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import { today } from './learning-plans.js';
const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
let adminForeignId;
try {
  const [adminForeign] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'隔离验证','test','disabled-test-login')",
    ['foreign_review-schedules_' + Date.now()],
  );
  adminForeignId = adminForeign.insertId;
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'安排测试','test','disabled')",
    [`schedule_${Date.now()}`],
  );
  uid = u.insertId;
  const token = jwt.sign({ sub: uid }, process.env.JWT_SECRET),
    foreign = jwt.sign({ sub: adminForeignId }, process.env.JWT_SECRET);
  const call = async (path, body, method = 'POST', access = token) => {
    const r = await fetch(`http://127.0.0.1:8005/api/${path}`, {
      method: body ? method : 'GET',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const root = 'review-schedules',
    day = today(),
    next = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'课程')", [uid]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'章节')", [
    c.insertId,
  ]);
  const [p] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'练习')",
    [c.insertId, ch.insertId],
  );
  const ids = [],
    qids = [];
  for (let i = 0; i < 4; i++) {
    const [q] = await db.execute(
      "INSERT INTO practice_questions(practice_id,question_type,question_text,options_json,answer_text,analysis_text,sort_order) VALUES(?,'单选题',?,?,'A','解析',?)",
      [p.insertId, `第${i + 1}题`, JSON.stringify(['A. 正确', 'B. 错误']), i],
    );
    qids.push(q.insertId);
    const [w] = await db.execute(
      'INSERT INTO wrong_questions(question_id,last_answer) VALUES(?,?)',
      [q.insertId, JSON.stringify(['B'])],
    );
    ids.push(w.insertId);
  }
  assert.equal(
    (await call(root, { wrongQuestionIds: ids.slice(0, 2), date: day })).data.created,
    2,
  );
  assert.equal((await call('learning-plans')).data.plans.length, 0);
  assert.equal(
    (await call(root, { wrongQuestionIds: ids.slice(0, 2), date: day })).data.existing,
    2,
  );
  let ts = (await call(root)).data.tasks;
  assert.equal(ts.length, 2);
  const t = ts[0],
    t2 = ts[1];
  assert.equal((await call(root, undefined, 'GET', foreign)).data.tasks.length, 0);
  assert.equal((await call(`${root}/${t.id}`, undefined, 'GET', foreign)).status, 404);
  assert.equal(
    (await call(root, { wrongQuestionIds: [ids[0]], date: day }, 'POST', foreign)).status,
    404,
  );
  const result = await call(`${root}/${t.id}/submit`, { answer: ['A'], version: t.version });
  assert.equal(result.status, 200);
  assert.equal(result.data.correct, true);
  const saved = (await call(`${root}/${t.id}`)).data;
  assert.equal(saved.task.status, 'completed');
  assert.deepEqual(saved.task.answer, ['A']);
  assert.equal(saved.question.options.length, 2);
  assert.equal(
    (await call('wrong-questions')).data.questions.find((q) => q.id === t.wrongQuestionId).mastered,
    false,
  );
  assert.deepEqual(
    (await call(`${root}/${t.id}/submit`, { answer: ['B'], version: 1 })).data.task.answer,
    ['A'],
  );
  assert.equal((await call(`${root}/${t.id}`, { version: 2 }, 'DELETE')).status, 409);
  assert.equal((await call(`${root}/${t2.id}`, { version: 1, date: next }, 'PATCH')).status, 200);
  assert.equal((await call(`${root}/${t2.id}`, { version: 1, date: next }, 'PATCH')).status, 409);
  assert.equal((await call(`${root}/${t2.id}`, { version: 2 }, 'DELETE')).status, 200);
  assert.equal(
    (await call(root, { wrongQuestionIds: [t2.wrongQuestionId], date: next })).data.created,
    1,
  );
  assert.equal((await call(root, { wrongQuestionIds: [ids[2]], date: '2026-02-30' })).status, 400);
  assert.equal((await call(root, { wrongQuestionIds: [ids[2], 99999999], date: day })).status, 404);
  assert.equal((await call(root)).data.tasks.length, 2);
  const races = await Promise.all([
    call(root, { wrongQuestionIds: [ids[2]], date: day }),
    call(root, { wrongQuestionIds: [ids[2]], date: day }),
  ]);
  assert.deepEqual(races.map((r) => r.data.created).sort(), [0, 1]);
  const t3 = (await call(root)).data.tasks.find((t) => t.wrongQuestionId === ids[2]);
  assert.equal(
    (await call(`${root}/${t3.id}/submit`, { answer: ['B'], version: 1 })).data.correct,
    false,
  );
  await call(root, { wrongQuestionIds: [ids[3]], date: day });
  const t4 = (await call(root)).data.tasks.find((t) => t.wrongQuestionId === ids[3]);
  await db.execute('DELETE FROM practice_questions WHERE id=?', [qids[3]]);
  assert.equal((await call(`${root}/${t4.id}`)).data.question, null);
  assert.equal((await call(`${root}/${t4.id}/submit`, { answer: ['A'], version: 1 })).status, 410);
  assert.equal((await call(`${root}/${t4.id}`, { version: 1 }, 'DELETE')).status, 200);
  await db.execute('DELETE FROM practice_questions WHERE id=?', [qids[0]]);
  assert.equal((await call(`${root}/${t.id}`)).data.question.question_text, '第1题');
  const settings = {
    targetDate: next,
    minutes: 30,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    requirements: '',
  };
  assert.equal(
    (
      await call(
        'learning-plans',
        {
          courseId: c.insertId,
          version: 0,
          settings,
          tasks: [{ chapterId: ch.insertId, kind: 'read', date: day, minutes: 10, title: '阅读' }],
        },
        'PUT',
      )
    ).status,
    200,
  );
  let plan = (await call('learning-plans')).data.plans[0];
  await call(
    'learning-plans',
    {
      courseId: c.insertId,
      version: plan.version,
      settings,
      tasks: [{ chapterId: ch.insertId, kind: 'notes', date: next, minutes: 10, title: '笔记' }],
    },
    'PUT',
  );
  plan = (await call('learning-plans')).data.plans[0];
  await call(`learning-plans/${plan.id}`, { version: plan.version }, 'DELETE');
  assert.equal((await call(root)).data.tasks.length, 3);
  console.log(
    'PASS: scheduled reviews, batch and duplicates, races, saved answers, manual mastery, date/cancel, account isolation, deleted source history and independent plans',
  );
} finally {
  if (adminForeignId) await db.execute('DELETE FROM users WHERE id=?', [adminForeignId]);
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
