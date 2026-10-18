import 'dotenv/config';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureAttemptRequests, saveAttempt } from './attempt-requests.js';
import { pendingAttempt } from '../client/src/attempt-request.mjs';
const map = new Map(),
  storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
const answers = [{ questionIndex: 0, answer: ['A'], correct: true }];
const key = pendingAttempt(storage, 'scope', answers, randomUUID);
assert.equal(pendingAttempt(storage, 'scope', answers, randomUUID), key);
assert.notEqual(pendingAttempt(storage, 'other', answers, randomUUID), key);
assert.notEqual(
  pendingAttempt(storage, 'scope', [{ questionIndex: 0, answer: ['B'] }], randomUUID),
  key,
);
map.delete('scope');
assert.notEqual(pendingAttempt(storage, 'scope', answers, randomUUID), key);
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
try {
  await ensureAttemptRequests(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'去重测试','test','disabled')",
    ['dedup_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'去重测试')", [uid]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'章节')", [
    c.insertId,
  ]);
  const [p] = await db.execute(
    "INSERT INTO chapter_practices(course_id,chapter_id,title) VALUES(?,?,'练习')",
    [c.insertId, ch.insertId],
  );
  const input = {
    userId: uid,
    courseId: c.insertId,
    practiceId: p.insertId,
    requestId: randomUUID(),
    answers,
    records: [{ ...answers[0], questionType: '单选题' }],
    totalCount: 1,
  };
  const [a, b] = await Promise.all([saveAttempt(db, input), saveAttempt(db, input)]);
  assert.equal(a.attempt.id, b.attempt.id);
  assert.notEqual(a.replayed, b.replayed);
  const retry = await saveAttempt(db, input);
  assert.equal(retry.attempt.id, a.attempt.id);
  assert.equal(retry.replayed, true);
  await assert.rejects(
    saveAttempt(db, { ...input, answers: [{ questionIndex: 0, answer: ['B'] }] }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    saveAttempt(db, { ...input, userId: uid + 1000000 }),
    (e) => e.status === 404,
  );
  await saveAttempt(db, { ...input, requestId: randomUUID() });
  const [[count]] = await db.execute(
    'SELECT COUNT(*) total FROM practice_attempts WHERE practice_id=?',
    [p.insertId],
  );
  assert.equal(Number(count.total), 2);
  console.log(
    'PASS attempt dedup: concurrent/repeated requests, changed answers conflict, ownership, new round, client retry storage',
  );
} finally {
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
