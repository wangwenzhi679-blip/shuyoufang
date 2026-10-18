import { buildReviewDates, addReviewDays } from '../shared/review-rhythm.mjs';
import { ensureStudyDays, recordStudyDay } from './study-activity.js';
import { z } from 'zod';
import { gradeAnswer, parseJson, collectWrong } from './wrong-review.js';
import { today } from './learning-plans.js';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const scheduleDate = (input) => {
  const d = date.safeParse(input);
  if (!d.success || d.data < today() || d.data > addReviewDays(today(), 366))
    throw fail('复习日期应在今天至未来一年以内');
  return d.data;
};
const ownedQuestion = `SELECT w.*,q.question_type,q.question_text,q.options_json,q.answer_text,q.analysis_text,p.course_id,p.chapter_id,c.title AS course_title,ch.title AS chapter_title FROM wrong_questions w JOIN practice_questions q ON q.id=w.question_id JOIN chapter_practices p ON p.id=q.practice_id JOIN courses c ON c.id=p.course_id JOIN course_chapters ch ON ch.id=p.chapter_id WHERE c.user_id=? AND w.id=?`;
const question = (row) =>
  row
    ? {
        ...row,
        options: parseJson(row.options_json) || [],
        last_answer: row.last_answer ? parseJson(row.last_answer) : null,
        mastered: Boolean(row.mastered),
      }
    : null;
export async function ensureReviewSchedules(db) {
  await ensureStudyDays(db);
  await db.query(
    `CREATE TABLE IF NOT EXISTS review_schedules(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,source_id BIGINT UNSIGNED NOT NULL,wrong_question_id BIGINT UNSIGNED NULL,review_date DATE NOT NULL,title VARCHAR(180) NOT NULL,course_title VARCHAR(255) NOT NULL,chapter_title VARCHAR(255) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'pending',version INT NOT NULL DEFAULT 1,answer_json JSON NULL,correct BOOLEAN NULL,question_snapshot JSON NULL,completed_at DATETIME(3) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY scheduled_question_day(user_id,source_id,review_date),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(wrong_question_id) REFERENCES wrong_questions(id) ON DELETE SET NULL)`,
  );
}
export function registerReviewSchedules(app, db, auth, wrap) {
  const task = async (con, id, userId, lock = false) => {
    const [rows] = await con.execute(
      `SELECT *,DATE_FORMAT(review_date,'%Y-%m-%d') AS date,DATE_FORMAT(completed_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS completed_iso FROM review_schedules WHERE id=? AND user_id=?${lock ? ' FOR UPDATE' : ''}`,
      [id, userId],
    );
    if (!rows.length) throw fail('复习安排不存在', 404);
    return rows[0];
  };
  const dto = (row) => ({
    id: row.id,
    wrongQuestionId: row.wrong_question_id,
    date: row.date,
    title: row.title,
    courseTitle: row.course_title,
    chapterTitle: row.chapter_title,
    status: row.status,
    version: row.version,
    available: Boolean(row.wrong_question_id),
    completedAt: row.completed_iso,
    answer: row.answer_json ? parseJson(row.answer_json) : null,
    correct: row.correct === null ? null : Boolean(row.correct),
  });
  app.get(
    '/api/review-schedules',
    auth,
    wrap(async (req, res) => {
      const [rows] = await db.execute(
        "SELECT *,DATE_FORMAT(review_date,'%Y-%m-%d') AS date,DATE_FORMAT(completed_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS completed_iso FROM review_schedules WHERE user_id=? AND status<>'cancelled' ORDER BY review_date,id",
        [req.user.sub],
      );
      res.json({ today: today(), tasks: rows.map(dto) });
    }),
  );
  app.get(
    '/api/review-schedules/:id',
    auth,
    wrap(async (req, res) => {
      const row = await task(db, req.params.id, req.user.sub);
      if (row.status === 'cancelled') throw fail('此复习安排已取消', 410);
      let q;
      if (row.question_snapshot) q = parseJson(row.question_snapshot);
      else if (row.wrong_question_id) {
        const [rows] = await db.execute(ownedQuestion, [req.user.sub, row.wrong_question_id]);
        q = question(rows[0]);
      }
      res.json({ task: dto(row), question: q || null });
    }),
  );
  app.post(
    '/api/review-schedules',
    auth,
    wrap(async (req, res) => {
      const ids = z
        .array(z.number().int().positive())
        .min(1)
        .max(100)
        .safeParse(req.body.wrongQuestionIds);
      if (!ids.success) throw fail('请选择 1 至 100 道错题');
      const strategy = z.enum(['single', 'spaced']).default('single').safeParse(req.body.strategy);
      if (!strategy.success) throw fail('请选择间隔复习或单次复习');
      const day = scheduleDate(req.body.date);
      const dates = buildReviewDates(day, strategy.data);
      dates.forEach(scheduleDate);
      const con = await db.getConnection();
      let created = 0,
        existing = 0;
      try {
        await con.beginTransaction();
        await con.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.sub]);
        const questions = [];
        for (const id of new Set(ids.data)) {
          const [rows] = await con.execute(ownedQuestion, [req.user.sub, id]);
          if (!rows.length) throw fail('部分错题已删除或无权访问', 404);
          if (rows[0].mastered) throw fail('请从尚未掌握的错题中安排复习');
          questions.push(rows[0]);
        }
        for (const q of questions) {
          for (const day of dates) {
            const [rows] = await con.execute(
              'SELECT id,status FROM review_schedules WHERE user_id=? AND source_id=? AND review_date=? FOR UPDATE',
              [req.user.sub, q.id, day],
            );
            if (rows.length) {
              if (rows[0].status === 'cancelled') {
                await con.execute(
                  "UPDATE review_schedules SET status='pending',version=version+1 WHERE id=?",
                  [rows[0].id],
                );
                created++;
              } else existing++;
            } else {
              await con.execute(
                'INSERT INTO review_schedules(user_id,source_id,wrong_question_id,review_date,title,course_title,chapter_title) VALUES(?,?,?,?,?,?,?)',
                [
                  req.user.sub,
                  q.id,
                  q.id,
                  day,
                  q.question_text.slice(0, 180),
                  q.course_title,
                  q.chapter_title,
                ],
              );
              created++;
            }
          }
        }
        await con.commit();
        res.json({
          created,
          existing,
          dates,
          strategy: strategy.data,
          message:
            strategy.data === 'spaced'
              ? `已安排 ${created} 次复习${existing ? `，另有 ${existing} 次已有安排` : ''}，分 ${dates.length} 轮回看。`
              : `已安排 ${created} 道；${existing ? `${existing} 道在该日期已有安排` : '没有重复安排'}`,
        });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    }),
  );
  const change = (cancel) =>
    wrap(async (req, res) => {
      const version = z.number().int().positive().safeParse(req.body.version);
      if (!version.success) throw fail('请刷新复习安排后重试');
      const day = cancel ? null : scheduleDate(req.body.date);
      const con = await db.getConnection();
      try {
        await con.beginTransaction();
        await con.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.sub]);
        const row = await task(con, req.params.id, req.user.sub, true);
        if (row.version !== version.data) throw fail('安排已在其他页面更新，请刷新后再操作', 409);
        if (row.status !== 'pending')
          throw fail('此安排已完成或取消，不能修改；答题历史会保留', 409);
        if (!cancel && !row.wrong_question_id) throw fail('原错题已删除，请取消此失效安排', 410);
        if (cancel)
          await con.execute(
            "UPDATE review_schedules SET status='cancelled',version=version+1 WHERE id=?",
            [row.id],
          );
        else {
          const [duplicates] = await con.execute(
            'SELECT id FROM review_schedules WHERE user_id=? AND source_id=? AND review_date=? AND id<>?',
            [req.user.sub, row.source_id, day, row.id],
          );
          if (duplicates.length) throw fail('该题在此日期已有安排，请选择其他日期', 409);
          await con.execute(
            'UPDATE review_schedules SET review_date=?,version=version+1 WHERE id=?',
            [day, row.id],
          );
        }
        await con.commit();
        res.json({ ok: true });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    });
  app.patch('/api/review-schedules/:id', auth, change(false));
  app.delete('/api/review-schedules/:id', auth, change(true));
  app.post(
    '/api/review-schedules/:id/submit',
    auth,
    wrap(async (req, res) => {
      const answer = z
        .union([z.string().max(2000), z.array(z.string().max(20)).max(8)])
        .safeParse(req.body.answer);
      if (!answer.success) throw fail('答案格式不正确');
      const con = await db.getConnection();
      try {
        await con.beginTransaction();
        await con.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.sub]);
        const row = await task(con, req.params.id, req.user.sub, true);
        if (row.status === 'completed') {
          await con.commit();
          return res.json({ task: dto(row), correct: Boolean(row.correct) });
        }
        if (row.status !== 'pending') throw fail('复习安排已取消', 410);
        if (row.version !== req.body.version) throw fail('复习安排已更新，请刷新后继续作答', 409);
        if (!row.wrong_question_id) throw fail('原错题已删除，此安排无法作答', 410);
        const [rows] = await con.execute(ownedQuestion + ' FOR UPDATE', [
          req.user.sub,
          row.wrong_question_id,
        ]);
        if (!rows.length) throw fail('原错题已删除', 410);
        const q = rows[0],
          result = gradeAnswer(q, answer.data);
        if (!result.answered) throw fail('请先选择或填写答案');
        if (result.correct)
          await con.execute('UPDATE wrong_questions SET last_answer=? WHERE id=?', [
            JSON.stringify(answer.data),
            q.id,
          ]);
        else await collectWrong(con, q.question_id, answer.data);
        await con.execute(
          "UPDATE review_schedules SET status='completed',answer_json=?,correct=?,question_snapshot=?,completed_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=?",
          [JSON.stringify(answer.data), result.correct, JSON.stringify(question(q)), row.id],
        );
        await recordStudyDay(con, req.user.sub);
        await con.commit();
        const saved = await task(db, row.id, req.user.sub);
        res.json({ task: dto(saved), correct: result.correct });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    }),
  );
}
