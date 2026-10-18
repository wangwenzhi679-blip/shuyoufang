import { ensureStudyDays, recordStudyDay } from './study-activity.js';
export async function ensureProgress(db) {
  await ensureStudyDays(db);
  const [cols] = await db.query("SHOW COLUMNS FROM course_chapters LIKE 'completed_at'");
  if (!cols.length)
    await db.query('ALTER TABLE course_chapters ADD COLUMN completed_at DATETIME(3) NULL');
}
export function registerProgress(app, db, auth, wrap) {
  app.patch(
    '/api/courses/:courseId/chapters/:chapterId/progress',
    auth,
    wrap(async (req, res) => {
      const courseId = Number(req.params.courseId),
        chapterId = Number(req.params.chapterId);
      if (
        !Number.isSafeInteger(courseId) ||
        courseId < 1 ||
        !Number.isSafeInteger(chapterId) ||
        chapterId < 1 ||
        typeof req.body.completed !== 'boolean'
      )
        return res.status(400).json({ message: '完成状态不正确' });
      const con = await db.getConnection();
      try {
        await con.beginTransaction();
        const [courses] = await con.execute(
          'SELECT id FROM courses WHERE id=? AND user_id=? FOR UPDATE',
          [courseId, req.user.sub],
        );
        if (!courses.length) {
          await con.rollback();
          return res.status(404).json({ message: '课程不存在' });
        }
        const [chapters] = await con.execute(
          'SELECT id,completed_at FROM course_chapters WHERE id=? AND course_id=? FOR UPDATE',
          [chapterId, courseId],
        );
        if (!chapters.length) {
          await con.rollback();
          return res.status(404).json({ message: '章节不存在' });
        }
        await con.execute(
          'UPDATE course_chapters SET completed_at=IF(?,COALESCE(completed_at,UTC_TIMESTAMP(3)),NULL) WHERE id=?',
          [req.body.completed, chapterId],
        );
        const [plans] = await con.execute(
          'SELECT id,tasks_json FROM learning_plans WHERE user_id=? AND course_id=? FOR UPDATE',
          [req.user.sub, courseId],
        );
        for (const plan of plans) {
          const tasks =
            typeof plan.tasks_json === 'string' ? JSON.parse(plan.tasks_json) : plan.tasks_json;
          let changed = false;
          for (const t of tasks) {
            if (Number(t.chapterId) !== chapterId || t.kind !== 'read') continue;
            if (req.body.completed && !t.completedAt) {
              t.completedAt = new Date().toISOString();
              t.completionSource = 'chapter';
              changed = true;
            } else if (!req.body.completed && t.completionSource === 'chapter') {
              t.completedAt = null;
              t.completionSource = null;
              changed = true;
            }
          }
          if (changed)
            await con.execute(
              'UPDATE learning_plans SET tasks_json=?,version=version+1 WHERE id=?',
              [JSON.stringify(tasks), plan.id],
            );
        }
        if (req.body.completed && !chapters[0].completed_at)
          await recordStudyDay(con, req.user.sub);
        await con.commit();
        res.json({ ok: true });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    }),
  );
}
