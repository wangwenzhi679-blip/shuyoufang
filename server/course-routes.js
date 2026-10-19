import { z } from 'zod';
import { courseSchema, chapterSchema, idSchema } from './request-schemas.mjs';

// 在入口既有的鉴权及内容控制中间件之后注册，保持课程权限检查顺序。
export function registerCourseRoutes(
  app,
  {
    db,
    auth,
    asyncRoute,
    parseId,
    validationError,
    getOwnedCourse,
    courseCovers,
    removeMaterialFiles,
  },
) {
  app.put(
    '/api/courses/:courseId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const parsed = courseSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      await db.execute('UPDATE courses SET title=?,description=? WHERE id=?', [
        parsed.data.title,
        parsed.data.description,
        courseId,
      ]);
      res.json({ course: await getOwnedCourse(req.user.sub, courseId) });
    }),
  );

  app.delete(
    '/api/courses/:courseId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const [materials] = await db.execute(
        'SELECT id,stored_name,preview_name FROM course_materials WHERE course_id=?',
        [courseId],
      );
      const result = await courseCovers.removeCourse(courseId, req.user.sub);
      if (!result.affectedRows) return res.status(404).json({ message: '课程不存在或无权访问' });
      const cleanupFailed = removeMaterialFiles(materials) || result.cleanupFailed;
      res.json({ deleted: true, cleanupFailed });
    }),
  );

  app.post(
    '/api/courses/:courseId/chapters',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const parsed = chapterSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [positions] = await db.execute(
        'SELECT COALESCE(MAX(sort_order),0)+1 AS next_order FROM course_chapters WHERE course_id=?',
        [courseId],
      );
      const [result] = await db.execute(
        'INSERT INTO course_chapters(course_id,title,description,sort_order) VALUES(?,?,?,?)',
        [courseId, parsed.data.title, parsed.data.description, positions[0].next_order],
      );
      const [rows] = await db.execute(
        'SELECT id,course_id,title,description,sort_order,created_at,updated_at,completed_at FROM course_chapters WHERE id=?',
        [result.insertId],
      );
      res.status(201).json({ chapter: rows[0] });
    }),
  );

  app.put(
    '/api/courses/:courseId/chapters/order',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const parsed = z
        .object({ chapterIds: z.array(idSchema).min(1, '请提供章节顺序') })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [chapters] = await db.execute('SELECT id FROM course_chapters WHERE course_id=?', [
        courseId,
      ]);
      const currentIds = chapters.map((chapter) => Number(chapter.id)).sort((a, b) => a - b);
      const nextIds = [...parsed.data.chapterIds].sort((a, b) => a - b);
      if (
        currentIds.length !== nextIds.length ||
        currentIds.some((id, index) => id !== nextIds[index])
      )
        return res.status(400).json({ message: '章节顺序不完整' });
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        for (const [index, chapterId] of parsed.data.chapterIds.entries())
          await connection.execute(
            'UPDATE course_chapters SET sort_order=? WHERE id=? AND course_id=?',
            [index + 1, chapterId, courseId],
          );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      res.status(204).end();
    }),
  );

  app.put(
    '/api/courses/:courseId/chapters/:chapterId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const chapterId = parseId(res, req.params.chapterId);
      if (!courseId || !chapterId) return;
      const parsed = chapterSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [result] = await db.execute(
        'UPDATE course_chapters SET title=?,description=? WHERE id=? AND course_id=?',
        [parsed.data.title, parsed.data.description, chapterId, courseId],
      );
      if (!result.affectedRows) return res.status(404).json({ message: '章节不存在' });
      const [rows] = await db.execute(
        'SELECT id,course_id,title,description,sort_order,created_at,updated_at,completed_at FROM course_chapters WHERE id=?',
        [chapterId],
      );
      res.json({ chapter: rows[0] });
    }),
  );

  app.delete(
    '/api/courses/:courseId/chapters/:chapterId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const chapterId = parseId(res, req.params.chapterId);
      if (!courseId || !chapterId) return;
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [result] = await db.execute('DELETE FROM course_chapters WHERE id=? AND course_id=?', [
        chapterId,
        courseId,
      ]);
      if (!result.affectedRows) return res.status(404).json({ message: '章节不存在' });
      res.status(204).end();
    }),
  );
}
