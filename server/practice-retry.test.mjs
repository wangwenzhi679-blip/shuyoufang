import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
try {
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'再次练习测试','test','disabled')",
    ['retry_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'再次练习测试')", [
    uid,
  ]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'章节')", [
    c.insertId,
  ]);
  const token = jwt.sign({ sub: uid }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:8005/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(r.ok, `接口状态 ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  const { practice } = await call(
    `courses/${c.insertId}/chapters/${ch.insertId}/practices`,
    'POST',
    {
      title: '再次练习',
      questions: [
        {
          type: '单选题',
          question: '选择甲',
          options: ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'],
          answer: 'A',
          analysis: '甲正确',
        },
        { type: '填空题', question: '填写甲', options: [], answer: '甲', analysis: '甲' },
      ],
    },
  );
  const base = `courses/${c.insertId}/practices/${practice.id}`;
  const first = await call(`${base}/attempts`, 'POST', {
    requestId: randomUUID(),
    answers: [
      { questionIndex: 0, answer: ['A'], correct: true },
      { questionIndex: 1, answer: '甲', correct: true },
    ],
    correctCount: 2,
    totalCount: 2,
  });
  const fresh = { 0: [], 1: '' };
  await call(`${base}/progress`, 'PUT', { answers: fresh });
  let data = await call(`courses/${c.insertId}`);
  let restored = data.practices.find((p) => p.id === practice.id);
  assert.deepEqual(restored.in_progress.answers, fresh);
  assert.equal(restored.latest_attempt.id, first.attempt.id);
  await call(`${base}/progress`, 'PUT', { answers: { ...fresh, 0: ['B'] } });
  data = await call(`courses/${c.insertId}`);
  restored = data.practices.find((p) => p.id === practice.id);
  assert.deepEqual(restored.in_progress.answers, { 0: ['B'], 1: '' });
  assert.equal(restored.latest_attempt.correct_count, 2);
  const second = await call(`${base}/attempts`, 'POST', {
    requestId: randomUUID(),
    answers: [
      { questionIndex: 0, answer: ['B'], correct: false },
      { questionIndex: 1, answer: '', correct: false },
    ],
    correctCount: 0,
    totalCount: 2,
  });
  assert.notEqual(first.attempt.id, second.attempt.id);
  data = await call(`courses/${c.insertId}`);
  restored = data.practices.find((p) => p.id === practice.id);
  assert.equal(restored.in_progress, null);
  assert.equal(restored.attempt_count, 2);
  const history = await call(`learning-home/attempts/${first.attempt.id}`);
  assert.equal(history.attempt.correct_count, 2);
  console.log('PASS 新一轮空答案与修改恢复、旧交卷保留、再次交卷独立保存');
} finally {
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
