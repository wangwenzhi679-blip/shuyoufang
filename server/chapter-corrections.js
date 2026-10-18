import { assertReadableContext } from './material-quality.js';
const conflict = () =>
  Object.assign(new Error('内容已在其他页面更新，请关闭后重新打开'), { status: 409 });
export async function ensureChapterCorrections(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS chapter_source_corrections(course_id BIGINT UNSIGNED NOT NULL,chapter_id BIGINT UNSIGNED NOT NULL,material_id BIGINT UNSIGNED NOT NULL,content MEDIUMTEXT NOT NULL,version INT NOT NULL DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,PRIMARY KEY(chapter_id,material_id),FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,FOREIGN KEY(material_id) REFERENCES course_materials(id) ON DELETE CASCADE)`,
  );
  const [columns] = await db.query('SHOW COLUMNS FROM chapter_source_corrections');
  for (const [name, type] of [
    ['enabled', 'BOOLEAN NOT NULL DEFAULT TRUE'],
    ['previous_content', 'MEDIUMTEXT NULL'],
    ['previous_enabled', 'BOOLEAN NULL'],
  ])
    if (!columns.some((c) => c.Field === name))
      await db.query(`ALTER TABLE chapter_source_corrections ADD COLUMN ${name} ${type}`);
}
export async function applyChapterCorrections(db, courseId, chapterId, sections) {
  const [rows] = await db.execute(
    'SELECT c.material_id,c.content,m.original_name FROM chapter_source_corrections c JOIN course_materials m ON m.id=c.material_id AND m.course_id=c.course_id WHERE c.course_id=? AND c.chapter_id=? AND c.enabled=TRUE',
    [courseId, chapterId],
  );
  const result = sections.map((s) => ({ ...s }));
  for (const row of rows) {
    let section = result.find((s) => Number(s.materialId) === Number(row.material_id));
    if (!section) {
      section = {
        materialId: row.material_id,
        name: row.original_name,
        materialName: row.original_name,
      };
      result.push(section);
    }
    Object.assign(section, {
      content: row.content,
      corrected: true,
      originalRequired: false,
      originalPages: [],
    });
    for (let i = result.length - 1; i >= 0; i--)
      if (result[i] !== section && Number(result[i].materialId) === Number(row.material_id))
        result.splice(i, 1);
  }
  return result;
}
export function registerChapterCorrections(app, db, auth, wrap, loadSource) {
  const route = '/api/courses/:courseId/chapters/:chapterId/materials/:materialId/correction';
  const owned = async (req) => {
    const ids = [req.params.courseId, req.params.chapterId, req.params.materialId].map(Number);
    if (ids.some((n) => !Number.isSafeInteger(n) || n < 1)) return false;
    const [rows] = await db.execute(
      'SELECT m.id FROM course_materials m JOIN courses c ON c.id=m.course_id JOIN course_chapters ch ON ch.course_id=c.id WHERE c.user_id=? AND c.id=? AND ch.id=? AND m.id=?',
      [req.user.sub, ...ids],
    );
    return rows.length > 0;
  };
  const current = async (req) => {
    const [rows] = await db.execute(
      'SELECT content,version,enabled,previous_content,previous_enabled FROM chapter_source_corrections WHERE chapter_id=? AND material_id=?',
      [req.params.chapterId, req.params.materialId],
    );
    return rows[0];
  };
  const update = async (req, row, content, enabled) => {
    const [changed] = await db.execute(
      'UPDATE chapter_source_corrections SET content=?,enabled=?,previous_content=?,previous_enabled=?,version=version+1 WHERE chapter_id=? AND material_id=? AND version=?',
      [
        content,
        enabled,
        row.content,
        row.enabled,
        req.params.chapterId,
        req.params.materialId,
        row.version,
      ],
    );
    if (!changed.affectedRows) throw conflict();
  };
  app.get(
    route,
    auth,
    wrap(async (req, res) => {
      if (!(await owned(req))) return res.status(404).json({ message: '章节或资料不存在' });
      const row = await current(req);
      res.json({
        content: row?.enabled ? row.content : await loadSource(req),
        version: row?.version || 0,
        corrected: Boolean(row?.enabled),
        hasPrevious: row?.previous_enabled != null,
      });
    }),
  );
  app.put(
    route,
    auth,
    wrap(async (req, res) => {
      if (!(await owned(req))) return res.status(404).json({ message: '章节或资料不存在' });
      const { content, version } = req.body || {};
      if (
        typeof content !== 'string' ||
        !content.trim() ||
        content.length > 100000 ||
        !Number.isSafeInteger(version) ||
        version < 0
      )
        return res.status(400).json({ message: '请输入本章完整内容，最多十万字' });
      assertReadableContext(content);
      if (version === 0) {
        try {
          await db.execute(
            'INSERT INTO chapter_source_corrections(course_id,chapter_id,material_id,content,previous_enabled) VALUES(?,?,?,?,FALSE)',
            [req.params.courseId, req.params.chapterId, req.params.materialId, content.trim()],
          );
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') throw conflict();
          throw e;
        }
      } else {
        const row = await current(req);
        if (!row || row.version !== version) throw conflict();
        await update(req, row, content.trim(), true);
      }
      res.json({ version: version + 1 });
    }),
  );
  for (const action of ['restore', 'undo'])
    app.post(
      `${route}/${action}`,
      auth,
      wrap(async (req, res) => {
        if (!(await owned(req))) return res.status(404).json({ message: '章节或资料不存在' });
        const version = req.body?.version;
        if (!Number.isSafeInteger(version) || version < 1)
          return res.status(400).json({ message: '资料版本无效' });
        const row = await current(req);
        if (!row || row.version !== version) throw conflict();
        if (action === 'restore') {
          if (!row.enabled) return res.status(409).json({ message: '当前已是原始提取内容' });
          await update(req, row, row.content, false);
        } else {
          if (row.previous_enabled == null)
            return res.status(409).json({ message: '没有可恢复的上一版内容' });
          await update(req, row, row.previous_content || '', row.previous_enabled);
        }
        res.json({ version: version + 1 });
      }),
    );
}
