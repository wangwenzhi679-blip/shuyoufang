import { courseSchema } from './request-schemas.mjs';
import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { registerChapterCorrections } from './chapter-corrections.js';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerCourseQueryRoutes(
  app,
  {
    auth,
    asyncRoute,
    db,
    validationError,
    getOwnedCourse,
    parseId,
    getCoursePracticeData,
    getCourseChapterSummaries,
    getCourseMaterials,
  },
) {
  app.get(
    '/api/courses',
    auth,
    asyncRoute(async (req, res) => {
      const [rows] = await db.execute(
        `SELECT c.id,c.title,c.description,c.admin_status,c.admin_reason,c.admin_changed_at,c.created_at,c.updated_at,COUNT(ch.id) AS chapter_count,SUM(ch.completed_at IS NOT NULL) AS completed_count,
    (SELECT COUNT(*) FROM course_materials m WHERE m.course_id=c.id) AS material_count,
    (SELECT COUNT(*) FROM chapter_notes n WHERE n.course_id=c.id AND n.user_id=c.user_id AND CHAR_LENGTH(TRIM(n.body))>0) AS note_count,
    (SELECT COUNT(*) FROM chapter_practices p WHERE p.course_id=c.id) AS practice_count,
    (SELECT MAX(r.updated_at) FROM (SELECT user_id,course_id,updated_at FROM reading_positions UNION ALL SELECT user_id,course_id,updated_at FROM learning_progress) r WHERE r.course_id=c.id AND r.user_id=c.user_id) AS last_studied_at
    FROM courses c LEFT JOIN course_chapters ch ON ch.course_id=c.id
    WHERE c.user_id=? GROUP BY c.id ORDER BY c.updated_at DESC,c.id DESC`,
        [req.user.sub],
      );
      res.json({
        courses: rows.map((course) => ({
          ...course,
          chapter_count: Number(course.chapter_count),
          completed_count: Number(course.completed_count || 0),
          material_count: Number(course.material_count || 0),
          note_count: Number(course.note_count || 0),
          practice_count: Number(course.practice_count || 0),
        })),
      });
    }),
  );

  app.post(
    '/api/courses',
    auth,
    asyncRoute(async (req, res) => {
      const parsed = courseSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const [result] = await db.execute(
        'INSERT INTO courses(user_id,title,description) VALUES(?,?,?)',
        [req.user.sub, parsed.data.title, parsed.data.description],
      );
      const course = await getOwnedCourse(req.user.sub, result.insertId);
      res.status(201).json({ course: { ...course, chapter_count: 0 } });
    }),
  );

  app.get(
    '/api/courses/:courseId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [chapters] = await db.execute(
        'SELECT id,course_id,title,description,sort_order,created_at,updated_at,completed_at FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
        [course.id],
      );
      const [chapterDrafts] = await db.execute(
        'SELECT id,title,description,sort_order,created_at FROM course_chapter_drafts WHERE course_id=? ORDER BY sort_order,id',
        [course.id],
      );
      const practiceData = await getCoursePracticeData(course.id);
      res.json({
        course,
        chapters,
        chapterDrafts,
        chapterSummaries: await getCourseChapterSummaries(course.id),
        materials: await getCourseMaterials(course.id),
        ...practiceData,
      });
    }),
  );

  registerChapterCorrections(app, db, auth, asyncRoute, async (req) => {
    const [chapters] = await db.execute(
      'SELECT id,title FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
      [req.params.courseId],
    );
    const index = chapters.findIndex((c) => Number(c.id) === Number(req.params.chapterId));
    const [materials] = await db.execute(
      'SELECT id,original_name,extracted_text FROM course_materials WHERE id=? AND course_id=?',
      [req.params.materialId, req.params.courseId],
    );
    return (
      sliceChapterText(
        materials[0].extracted_text || '',
        chapters[index],
        chapters.slice(index + 1),
      ) ||
      selectChapterQuestions(materials, chapters[index])
        .map((s) => s.content)
        .join('\n\n')
    );
  });
}
