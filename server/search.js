export function registerSearch(app, db, auth, wrap) {
  const parts = {
    course: `SELECT 'course' AS type,c.id,c.id AS courseId,NULL AS chapterId,c.title,c.title AS courseTitle,'' AS chapterTitle,COALESCE(c.description,'') AS body FROM courses c WHERE c.user_id=? AND c.admin_status='active'`,
    chapter: `SELECT 'chapter',ch.id,c.id,ch.id,ch.title,c.title,ch.title,COALESCE(ch.description,'') FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE c.user_id=? AND c.admin_status='active'`,
    material: `SELECT 'material',m.id,c.id,NULL,m.original_name,c.title,'',COALESCE(m.extracted_text,'') FROM course_materials m JOIN courses c ON c.id=m.course_id WHERE c.user_id=? AND c.admin_status='active' AND m.admin_status='active'`,
    note: `SELECT 'note',ch.id,c.id,ch.id,ch.title,c.title,ch.title,n.body FROM chapter_notes n JOIN courses c ON c.id=n.course_id JOIN course_chapters ch ON ch.id=n.chapter_id WHERE c.user_id=? AND c.admin_status='active' AND n.user_id=c.user_id AND TRIM(n.body)<>''`,
    wrong: `SELECT 'wrong',w.id,c.id,ch.id,q.question_text,c.title,ch.title,q.question_text FROM wrong_questions w JOIN practice_questions q ON q.id=w.question_id JOIN chapter_practices p ON p.id=q.practice_id JOIN courses c ON c.id=p.course_id JOIN course_chapters ch ON ch.id=p.chapter_id WHERE c.user_id=? AND c.admin_status='active'`,
  };
  app.get(
    '/api/search',
    auth,
    wrap(async (req, res) => {
      const q = String(req.query.q || '').trim(),
        type = String(req.query.type || 'all'),
        page = Number(req.query.page || 1),
        courseId = req.query.courseId ? Number(req.query.courseId) : null;
      if (
        q.length > 100 ||
        !['all', ...Object.keys(parts)].includes(type) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 10000 ||
        (courseId !== null && (!Number.isSafeInteger(courseId) || courseId < 1))
      )
        return res.status(400).json({ message: '搜索条件不正确' });
      if (!q) return res.json({ results: [], total: 0, page, pageSize: 20 });
      if (courseId) {
        const [owned] = await db.execute('SELECT id FROM courses WHERE id=? AND user_id=?', [
          courseId,
          req.user.sub,
        ]);
        if (!owned.length) return res.status(404).json({ message: '课程不存在' });
      }
      const keys = type === 'all' ? Object.keys(parts) : [type],
        base = parts.course + ' AND 1=0 UNION ALL ' + keys.map((k) => parts[k]).join(' UNION ALL '),
        args = [req.user.sub, ...keys.map(() => req.user.sub)];
      const where = `(INSTR(LOWER(title),LOWER(?))>0 OR INSTR(LOWER(body),LOWER(?))>0)${courseId ? ' AND courseId=?' : ''}`;
      const filters = [q, q, ...(courseId ? [courseId] : [])];
      const [[count]] = await db.execute(
        `SELECT COUNT(*) AS total FROM (${base}) s WHERE ${where}`,
        [...args, ...filters],
      );
      const [results] = await db.execute(
        `SELECT type,id,courseId,chapterId,LEFT(title,180) AS title,courseTitle,chapterTitle,SUBSTRING(body,GREATEST(1,INSTR(LOWER(body),LOWER(?))-45),180) AS snippet FROM (${base}) s WHERE ${where} ORDER BY (INSTR(LOWER(title),LOWER(?))>0) DESC,type,courseId,id LIMIT 20 OFFSET ${20 * (page - 1)}`,
        [q, ...args, ...filters, q],
      );
      res.json({ results, total: count.total, page, pageSize: 20 });
    }),
  );
}
