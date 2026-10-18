import { ensureStudyDays, recordStudyDay } from './study-activity.js';
import { z } from 'zod';
import { registerNoteEnhancements, ensureNoteEnhancements } from './note-enhancements.js';

export async function ensureLearningNotes(db) {
  await ensureStudyDays(db);
  await db.query(`CREATE TABLE IF NOT EXISTS chapter_notes (
    chapter_id BIGINT UNSIGNED PRIMARY KEY, course_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL, body MEDIUMTEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await ensureNoteEnhancements(db);
}

export function registerLearningNotes(app, db, auth, asyncRoute, askAi, chapterSource) {
  registerNoteEnhancements(app, db, auth, asyncRoute, askAi, chapterSource);
  const route = '/api/courses/:courseId/chapters/:chapterId/note';
  async function owned(req) {
    const [rows] = await db.execute(
      'SELECT ch.id FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=? AND c.id=? AND c.user_id=?',
      [req.params.chapterId, req.params.courseId, req.user.sub],
    );
    return rows.length > 0;
  }
  app.get(
    route,
    auth,
    asyncRoute(async (req, res) => {
      if (!(await owned(req))) return res.status(404).json({ message: '章节不存在' });
      const [rows] = await db.execute(
        'SELECT body,version,updated_at FROM chapter_notes WHERE chapter_id=? AND user_id=?',
        [req.params.chapterId, req.user.sub],
      );
      res.json({ note: rows[0] || { body: '', version: 0 } });
    }),
  );
  app.put(
    route,
    auth,
    asyncRoute(async (req, res) => {
      const parsed = z
        .object({
          body: z.string().max(100000, '笔记最多十万字'),
          version: z.number().int().nonnegative(),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: '笔记格式不正确或内容过长' });
      if (!(await owned(req))) return res.status(404).json({ message: '章节不存在' });
      await db.execute(
        "INSERT IGNORE INTO chapter_notes(chapter_id,course_id,user_id,body) VALUES(?,?,?,'')",
        [req.params.chapterId, req.params.courseId, req.user.sub],
      );
      const [result] = await db.execute(
        'UPDATE chapter_notes SET body=?,version=version+1 WHERE chapter_id=? AND user_id=? AND version=?',
        [parsed.data.body, req.params.chapterId, req.user.sub, parsed.data.version],
      );
      if (!result.affectedRows)
        return res.status(409).json({ message: '笔记已在其他窗口更新，请重新加载后再保存' });
      if (
        parsed.data.body
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim() ||
        /<img\b/i.test(parsed.data.body)
      )
        await recordStudyDay(db, req.user.sub);
      res.json({ note: { body: parsed.data.body, version: parsed.data.version + 1 } });
    }),
  );
}
