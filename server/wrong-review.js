import { ensureStudyDays, recordStudyDay } from './study-activity.js';
import { answerLetters, selectionLetters } from '../shared/question-types.mjs';
import { ensureWrongQuestionNotes, registerWrongQuestionNotes } from './wrong-question-notes.js';
export const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

export function gradeAnswer(question, answer) {
  const options = parseJson(question.options_json) || [];
  const answered = Array.isArray(answer)
    ? answer.length > 0
    : String(answer || '').trim().length > 0;
  const expected = [
    ...new Set(answerLetters(question.answer_text, options, question.question_type)),
  ].sort();
  const selected = [...new Set(selectionLetters(answer, options, question.question_type))].sort();
  const correct =
    answered &&
    (options.length
      ? expected.length > 0 && JSON.stringify(selected) === JSON.stringify(expected)
      : String(answer).trim().toLowerCase() === String(question.answer_text).trim().toLowerCase());
  return { answered, correct };
}

export async function ensureWrongReview(db) {
  await ensureStudyDays(db);
  await db.query(`CREATE TABLE IF NOT EXISTS wrong_questions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    question_id BIGINT UNSIGNED NOT NULL UNIQUE,
    last_answer JSON NOT NULL,
    wrong_count INT UNSIGNED NOT NULL DEFAULT 1,
    mastered BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES practice_questions(id) ON DELETE CASCADE
  )`);
  await ensureWrongQuestionNotes(db);
}

export async function collectWrong(db, questionId, answer) {
  await db.execute(
    `INSERT INTO wrong_questions(question_id,last_answer) VALUES(?,?)
    ON DUPLICATE KEY UPDATE last_answer=VALUES(last_answer),wrong_count=wrong_count+1,mastered=FALSE,updated_at=CURRENT_TIMESTAMP`,
    [questionId, JSON.stringify(answer)],
  );
}

export function registerWrongReview(app, db, auth, asyncRoute) {
  registerWrongQuestionNotes(app, db, auth, asyncRoute);
  const ownedQuery = `SELECT w.*,q.question_type,q.question_text,q.options_json,q.answer_text,q.analysis_text,p.course_id,p.chapter_id,c.title AS course_title,ch.title AS chapter_title
    FROM wrong_questions w JOIN practice_questions q ON q.id=w.question_id
    JOIN chapter_practices p ON p.id=q.practice_id JOIN courses c ON c.id=p.course_id
    JOIN course_chapters ch ON ch.id=p.chapter_id WHERE c.user_id=?`;
  app.get(
    '/api/wrong-questions',
    auth,
    asyncRoute(async (req, res) => {
      const [rows] = await db.execute(ownedQuery + ' ORDER BY w.updated_at DESC,w.id DESC', [
        req.user.sub,
      ]);
      res.json({
        questions: rows.map((row) => ({
          ...row,
          mastered: Boolean(row.mastered),
          options: parseJson(row.options_json),
          last_answer: parseJson(row.last_answer),
        })),
      });
    }),
  );
  app.patch(
    '/api/wrong-questions/:id',
    auth,
    asyncRoute(async (req, res) => {
      if (typeof req.body.mastered !== 'boolean')
        return res.status(400).json({ message: '请选择掌握状态' });
      const [rows] = await db.execute(ownedQuery + ' AND w.id=?', [req.user.sub, req.params.id]);
      if (!rows.length) return res.status(404).json({ message: '错题不存在' });
      await db.execute('UPDATE wrong_questions SET mastered=? WHERE id=?', [
        req.body.mastered,
        req.params.id,
      ]);
      res.json({ success: true });
    }),
  );
  app.post(
    '/api/wrong-questions/:id/review',
    auth,
    asyncRoute(async (req, res) => {
      const answer = req.body.answer;
      if (
        !(typeof answer === 'string' && answer.length <= 2000) &&
        !(
          Array.isArray(answer) &&
          answer.length <= 8 &&
          answer.every((item) => typeof item === 'string' && item.length <= 20)
        )
      )
        return res.status(400).json({ message: '答案格式不正确' });
      const [rows] = await db.execute(ownedQuery + ' AND w.id=?', [req.user.sub, req.params.id]);
      if (!rows.length) return res.status(404).json({ message: '错题不存在' });
      const result = gradeAnswer(rows[0], answer);
      if (!result.answered) return res.status(400).json({ message: '请先作答' });
      if (result.correct)
        await db.execute('UPDATE wrong_questions SET last_answer=? WHERE id=?', [
          JSON.stringify(answer),
          req.params.id,
        ]);
      else await collectWrong(db, rows[0].question_id, answer);
      await recordStudyDay(db, req.user.sub);
      res.json({ correct: result.correct });
    }),
  );
}
