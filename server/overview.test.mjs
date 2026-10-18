import { ensureStudyDays } from './study-activity.js';
import 'dotenv/config';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { getOverview, summarizeAttempts } from './overview.js';
const record = (type, correct) => ({ questionType: type, correct });
const rows = [
  { answers_json: JSON.stringify([record('单选题', true)]), total_count: 1 },
  {
    answers_json: [
      record('填空题', false),
      record('判断题', false),
      record('多选题', true),
      record('简答题', true),
    ],
    total_count: 4,
  },
  { answers_json: [{ correct: true }], total_count: 1 },
];
assert.deepEqual(summarizeAttempts(rows), {
  attemptCount: 3,
  objectiveCorrect: 2,
  objectiveTotal: 4,
  accuracy: 50,
  excludedAttempts: 1,
});
assert.equal(summarizeAttempts([]).accuracy, null);
assert.equal(summarizeAttempts([{ answers_json: 'bad', total_count: 1 }]).excludedAttempts, 1);
assert.equal(
  summarizeAttempts([{ answers_json: [record('简答题', true)], total_count: 1 }]).objectiveTotal,
  0,
);
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
try {
  await ensureStudyDays(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'概览测试','test','disabled')",
    ['overview_' + Date.now()],
  );
  uid = u.insertId;
  let o = await getOverview(db, uid);
  assert.equal(o.totalChapters, 0);
  assert.equal(o.activity.length, 0);
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'概览课程')", [uid]);
  const cid = c.insertId;
  const [ch] = await db.execute(
    "INSERT INTO course_chapters(course_id,title,completed_at) VALUES(?,'第一章',NOW())",
    [cid],
  );
  const id = ch.insertId;
  await db.execute('INSERT INTO learning_progress(user_id,course_id,chapter_id) VALUES(?,?,?)', [
    uid,
    cid,
    id,
  ]);
  await db.execute('INSERT INTO chapter_notes(chapter_id,course_id,user_id,body) VALUES(?,?,?,?)', [
    id,
    cid,
    uid,
    '测试笔记',
  ]);
  const [p] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'练习测试')",
    [cid, id],
  );
  for (const r of rows)
    await db.execute(
      'INSERT INTO practice_attempts(course_id,practice_id,answers_json,correct_count,total_count) VALUES(?,?,?,?,?)',
      [
        cid,
        p.insertId,
        JSON.stringify(
          typeof r.answers_json === 'string' ? JSON.parse(r.answers_json) : r.answers_json,
        ),
        0,
        r.total_count,
      ],
    );
  o = await getOverview(db, uid);
  assert.equal(o.completedChapters, 1);
  assert.equal(o.accuracy, 50);
  assert.equal(o.attemptCount, 3);
  assert.equal(o.courseCounts.find((c) => Number(c.id) === Number(cid)).practiceStats.accuracy, 50);
  const [otherCourse] = await db.execute(
    "INSERT INTO courses(user_id,title) VALUES(?,'另一门课程')",
    [uid],
  );
  const [otherChapter] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'另一章')",
    [otherCourse.insertId],
  );
  const [otherPractice] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'另一份练习')",
    [otherCourse.insertId, otherChapter.insertId],
  );
  await db.execute(
    'INSERT INTO practice_attempts(course_id,practice_id,answers_json,correct_count,total_count) VALUES(?,?,?,?,?)',
    [otherCourse.insertId, otherPractice.insertId, JSON.stringify([record('单选题', false)]), 0, 1],
  );
  const multi = await getOverview(db, uid);
  assert.equal(multi.attemptCount, 4);
  assert.equal(multi.accuracy, 40);
  assert.equal(multi.totalChapters, 2);
  assert.equal(
    multi.courseCounts.find((c) => Number(c.id) === Number(cid)).practiceStats.attemptCount,
    3,
  );
  assert.equal(
    multi.courseCounts.find((c) => Number(c.id) === Number(cid)).practiceStats.accuracy,
    50,
  );
  assert.equal(
    multi.courseCounts.find((c) => Number(c.id) === Number(otherCourse.insertId)).practiceStats
      .accuracy,
    0,
  );
  await db.execute('DELETE FROM courses WHERE id=?', [otherCourse.insertId]);
  assert.equal(o.activity.filter((a) => a.kind === 'note').length, 1);
  assert.equal(o.activity.filter((a) => a.kind === 'read').length, 1);
  assert.equal(Number(o.activity.find((a) => a.kind === 'attempt').practiceId), p.insertId);
  assert.equal((await getOverview(db, uid + 1000000)).attemptCount, 0);
  await db.execute('DELETE FROM courses WHERE id=?', [cid]);
  o = await getOverview(db, uid);
  assert.equal(o.attemptCount, 0);
  assert.equal(o.completedChapters, 0);
  assert.equal(o.activity.length, 0);
  console.log(
    'PASS overview: weighted accuracy, legacy exclusion, subjectives, empty data, actual MySQL queries, activity links, ownership and deletion',
  );
} finally {
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
