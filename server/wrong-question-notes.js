import { z } from 'zod';
import { recordStudyDay } from './study-activity.js';

const idSchema = z.coerce.number().int().positive().safe();
const noteSchema = z
  .object({
    reason: z.string().trim().max(2000).default(''),
    takeaway: z.string().trim().max(500).default(''),
    version: z.number().int().min(0).max(2147483646),
  })
  .refine((note) => note.reason || note.takeaway, '请至少填写错因批注或学习心得');
const fail = (message, status) => Object.assign(new Error(message), { status });
const source = `FROM wrong_questions w JOIN practice_questions q ON q.id=w.question_id
  JOIN chapter_practices p ON p.id=q.practice_id JOIN courses c ON c.id=p.course_id
  JOIN course_chapters ch ON ch.id=p.chapter_id`;
const owned = `SELECT w.id ${source} WHERE c.user_id=? AND q.id=?`;
const fields = `n.reason,n.takeaway,n.version,n.created_at,n.updated_at`;

export async function ensureWrongQuestionNotes(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS wrong_question_notes (
    wrong_question_id BIGINT UNSIGNED PRIMARY KEY,
    reason TEXT NOT NULL, takeaway TEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(wrong_question_id) REFERENCES wrong_questions(id) ON DELETE CASCADE
  )`);
}

export function registerWrongQuestionNotes(app, db, auth, asyncRoute) {
  app.get(
    '/api/wrong-question-notes',
    auth,
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          courseId: idSchema.optional(),
          q: z.string().trim().max(100).default(''),
        })
        .safeParse(req.query);
      if (!input.success) throw fail('筛选条件不正确', 400);
      const { page, courseId, q } = input.data;
      const clauses = ['c.user_id=?'],
        args = [req.user.sub];
      if (courseId) {
        clauses.push('p.course_id=?');
        args.push(courseId);
      }
      if (q) {
        clauses.push('(q.question_text LIKE ? OR n.reason LIKE ? OR n.takeaway LIKE ?)');
        args.push(...Array(3).fill(`%${q}%`));
      }
      const from = `${source} JOIN wrong_question_notes n ON n.wrong_question_id=w.id WHERE ${clauses.join(' AND ')}`;
      const [[count]] = await db.execute(`SELECT COUNT(*) AS total ${from}`, args);
      const [notes] = await db.execute(
        `SELECT ${fields},w.id AS wrong_question_id,q.id AS question_id,
      q.question_text,p.course_id,p.chapter_id,c.title AS course_title,ch.title AS chapter_title
      ${from} ORDER BY n.updated_at DESC,w.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
        args,
      );
      res.json({ notes, total: Number(count.total), page, pageSize: 20 });
    }),
  );

  app.get(
    '/api/wrong-question-notes/:questionId',
    auth,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.questionId);
      if (!id.success) throw fail('题目编号不正确', 400);
      const [rows] = await db.execute(owned, [req.user.sub, id.data]);
      if (!rows.length) throw fail('错题不存在或无权访问', 404);
      const [[note]] = await db.execute(
        `SELECT ${fields} FROM wrong_question_notes n WHERE n.wrong_question_id=?`,
        [rows[0].id],
      );
      res.json({ note: note || { reason: '', takeaway: '', version: 0 } });
    }),
  );

  app.put(
    '/api/wrong-question-notes/:questionId',
    auth,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.questionId),
        input = noteSchema.safeParse(req.body);
      if (!id.success) throw fail('题目编号不正确', 400);
      if (!input.success) throw fail('请填写批注或心得，错因最多2000字，心得最多500字', 400);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        // 锁定已归属当前用户的错题，创建和修改均不能越权或覆盖另一设备的新版本。
        const [[question]] = await connection.execute(owned + ' FOR UPDATE', [
          req.user.sub,
          id.data,
        ]);
        if (!question) throw fail('错题不存在或无权访问', 404);
        const [[current]] = await connection.execute(
          'SELECT version FROM wrong_question_notes WHERE wrong_question_id=?',
          [question.id],
        );
        if (Number(current?.version || 0) !== input.data.version)
          throw fail('批注已在其他页面更新，请先保留当前文字，再重新读取最新批注', 409);
        const { reason, takeaway } = input.data;
        if (current)
          await connection.execute(
            'UPDATE wrong_question_notes SET reason=?,takeaway=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE wrong_question_id=?',
            [reason, takeaway, question.id],
          );
        else
          await connection.execute(
            'INSERT INTO wrong_question_notes(wrong_question_id,reason,takeaway) VALUES(?,?,?)',
            [question.id, reason, takeaway],
          );
        await recordStudyDay(connection, req.user.sub);
        const [[note]] = await connection.execute(
          `SELECT ${fields} FROM wrong_question_notes n WHERE n.wrong_question_id=?`,
          [question.id],
        );
        await connection.commit();
        res.json({ note });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
  );
}
