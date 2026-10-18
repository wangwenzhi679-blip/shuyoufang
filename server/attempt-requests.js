import { ensureStudyDays, recordStudyDay } from './study-activity.js';
import { createHash } from 'node:crypto';
export async function ensureAttemptRequests(db) {
  await ensureStudyDays(db);
  const [cols] = await db.query('SHOW COLUMNS FROM practice_attempts');
  if (!cols.some((c) => c.Field === 'request_id'))
    await db.query(
      'ALTER TABLE practice_attempts ADD request_id VARCHAR(36) NULL, ADD request_hash CHAR(64) NULL, ADD UNIQUE KEY unique_practice_request(practice_id,request_id)',
    );
}
export function attemptFingerprint(answers) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        answers
          .map((a) => ({
            questionIndex: a.questionIndex,
            answer: Array.isArray(a.answer) ? [...a.answer].sort() : a.answer,
          }))
          .sort((a, b) => a.questionIndex - b.questionIndex),
      ),
    )
    .digest('hex');
}
export async function saveAttempt(
  db,
  { userId, courseId, practiceId, requestId, answers, records, totalCount },
) {
  const con = await db.getConnection();
  const hash = attemptFingerprint(answers);
  try {
    await con.beginTransaction();
    const [owned] = await con.execute(
      'SELECT p.id FROM chapter_practices p JOIN courses c ON c.id=p.course_id WHERE p.id=? AND c.id=? AND c.user_id=? FOR UPDATE',
      [practiceId, courseId, userId],
    );
    if (!owned.length) {
      const e = new Error('练习不存在或已删除');
      e.status = 404;
      throw e;
    }
    const [saved] = await con.execute(
      'SELECT * FROM practice_attempts WHERE practice_id=? AND request_id=?',
      [practiceId, requestId],
    );
    if (saved.length) {
      if (saved[0].request_hash !== hash) {
        const e = new Error('这次提交的答案已变化，请重新打开练习');
        e.status = 409;
        throw e;
      }
      await con.commit();
      return {
        replayed: true,
        attempt: {
          id: Number(saved[0].id),
          answers:
            typeof saved[0].answers_json === 'string'
              ? JSON.parse(saved[0].answers_json)
              : saved[0].answers_json,
          correct_count: saved[0].correct_count,
          total_count: saved[0].total_count,
          created_at: saved[0].created_at,
        },
      };
    }
    const correct = records.filter((a) => a.correct).length;
    const [created] = await con.execute(
      'INSERT INTO practice_attempts(course_id,practice_id,answers_json,correct_count,total_count,request_id,request_hash) VALUES(?,?,?,?,?,?,?)',
      [courseId, practiceId, JSON.stringify(records), correct, totalCount, requestId, hash],
    );
    await con.execute('DELETE FROM practice_in_progress WHERE user_id=? AND practice_id=?', [
      userId,
      practiceId,
    ]);
    if (records.some((row) => row.answered || row.correct)) await recordStudyDay(con, userId);
    await con.commit();
    return {
      replayed: false,
      attempt: {
        id: Number(created.insertId),
        answers: records,
        correct_count: correct,
        total_count: totalCount,
        created_at: new Date().toISOString(),
      },
    };
  } catch (e) {
    await con.rollback();
    throw e;
  } finally {
    con.release();
  }
}
