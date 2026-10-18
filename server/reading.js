import { ensureStudyDays, recordStudyDay } from './study-activity.js';
import { z } from 'zod';
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
export async function ensureReading(db) {
  await ensureStudyDays(db);
  await db.query(
    `CREATE TABLE IF NOT EXISTS reading_positions(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,course_id BIGINT UNSIGNED NOT NULL,chapter_id BIGINT UNSIGNED NOT NULL,material_id BIGINT UNSIGNED NOT NULL DEFAULT 0,position_json JSON NOT NULL,version INT NOT NULL DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY reading_scope(user_id,chapter_id,material_id),FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  );
  const [columns] = await db.query(
    "SELECT DATETIME_PRECISION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reading_positions' AND COLUMN_NAME='updated_at'",
  );
  if (Number(columns[0]?.DATETIME_PRECISION) < 3)
    await db.query(
      'ALTER TABLE reading_positions MODIFY updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
    );
  await db.query(
    `CREATE TABLE IF NOT EXISTS reading_bookmarks(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,course_id BIGINT UNSIGNED NOT NULL,chapter_id BIGINT UNSIGNED NOT NULL,material_id BIGINT UNSIGNED NOT NULL DEFAULT 0,name VARCHAR(120) NOT NULL,position_json JSON NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  );
}
const position = z.object({
  anchor: z.string().max(100).default(''),
  index: z.number().int().min(0).max(100000).default(0),
  offset: z.number().min(0).max(1).default(0),
  progress: z.number().int().min(0).max(99).optional(),
  page: z.number().int().min(1).max(2000).optional(),
});
export function registerReading(app, db, auth, wrap, pdfInfo, pdfPage) {
  const owned = async (req) => {
    const [rows] = await db.execute(
      'SELECT ch.id FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=? AND c.id=? AND c.user_id=?',
      [req.params.chapterId, req.params.courseId, req.user.sub],
    );
    return rows.length > 0;
  };
  const scope = (req) => [
    req.user.sub,
    Number(req.params.chapterId),
    Number(req.query.materialId || 0),
  ];
  const validScope = async (req) => {
    if (!(await owned(req))) return false;
    const id = Number(req.query.materialId || 0);
    if (!Number.isSafeInteger(id) || id < 0) return false;
    if (!id) return true;
    const [rows] = await db.execute('SELECT id FROM course_materials WHERE id=? AND course_id=?', [
      id,
      req.params.courseId,
    ]);
    return rows.length > 0;
  };
  const route = '/api/courses/:courseId/chapters/:chapterId/reading';
  app.get(
    route,
    auth,
    wrap(async (req, res) => {
      if (!(await validScope(req))) return res.status(404).json({ message: '章节或资料不存在' });
      const [positions] = await db.execute(
        'SELECT position_json,version FROM reading_positions WHERE user_id=? AND chapter_id=? AND material_id=?',
        scope(req),
      );
      const [bookmarks] = await db.execute(
        'SELECT b.id,b.name,b.position_json,b.material_id,m.original_name FROM reading_bookmarks b LEFT JOIN course_materials m ON m.id=b.material_id WHERE b.user_id=? AND b.chapter_id=? AND (?=0 OR b.material_id=?) ORDER BY b.id DESC',
        [...scope(req), Number(req.query.materialId || 0)],
      );
      const [latest] = await db.execute(
        'SELECT material_id FROM reading_positions WHERE user_id=? AND chapter_id=? ORDER BY updated_at DESC,id DESC LIMIT 1',
        scope(req).slice(0, 2),
      );
      res.json({
        latestMaterialId: latest[0]?.material_id || 0,
        position: positions[0] ? parse(positions[0].position_json) : null,
        version: positions[0]?.version || 0,
        bookmarks: bookmarks.map((b) => ({
          ...b,
          position: parse(b.position_json),
          unavailable: Boolean(b.material_id && !b.original_name),
        })),
      });
    }),
  );
  app.put(
    route,
    auth,
    wrap(async (req, res) => {
      if (!(await validScope(req))) return res.status(404).json({ message: '章节或资料不存在' });
      const data = z
        .object({ position, version: z.number().int().nonnegative() })
        .safeParse(req.body);
      if (!data.success) return res.status(400).json({ message: '阅读位置不正确' });
      const con = await db.getConnection();
      try {
        await con.beginTransaction();
        await con.execute('SELECT id FROM course_chapters WHERE id=? FOR UPDATE', [
          req.params.chapterId,
        ]);
        const [rows] = await con.execute(
          'SELECT id,version FROM reading_positions WHERE user_id=? AND chapter_id=? AND material_id=? FOR UPDATE',
          scope(req),
        );
        if ((rows[0]?.version || 0) !== data.data.version) {
          await con.rollback();
          return res.status(409).json({ message: '阅读位置已在其他页面更新，请重新加载后继续' });
        }
        await con.execute(
          'INSERT INTO reading_positions(user_id,course_id,chapter_id,material_id,position_json) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE position_json=VALUES(position_json),version=version+1',
          [
            req.user.sub,
            req.params.courseId,
            req.params.chapterId,
            req.query.materialId || 0,
            JSON.stringify(data.data.position),
          ],
        );
        await recordStudyDay(con, req.user.sub);
        await con.commit();
        res.json({ version: data.data.version + 1 });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    }),
  );
  app.post(
    route + '/bookmarks',
    auth,
    wrap(async (req, res) => {
      if (!(await validScope(req))) return res.status(404).json({ message: '章节或资料不存在' });
      const data = z
        .object({ name: z.string().trim().min(1).max(120), position })
        .safeParse(req.body);
      if (!data.success) return res.status(400).json({ message: '请输入书签名称及有效位置' });
      const [r] = await db.execute(
        'INSERT INTO reading_bookmarks(user_id,course_id,chapter_id,material_id,name,position_json) VALUES(?,?,?,?,?,?)',
        [
          req.user.sub,
          req.params.courseId,
          req.params.chapterId,
          req.query.materialId || 0,
          data.data.name,
          JSON.stringify(data.data.position),
        ],
      );
      res.json({ id: r.insertId });
    }),
  );
  app.put(
    '/api/reading-bookmarks/:id',
    auth,
    wrap(async (req, res) => {
      const name = z.string().trim().min(1).max(120).safeParse(req.body.name);
      if (!name.success) return res.status(400).json({ message: '书签名称不能为空或超过120字' });
      const [r] = await db.execute('UPDATE reading_bookmarks SET name=? WHERE id=? AND user_id=?', [
        name.data,
        req.params.id,
        req.user.sub,
      ]);
      if (!r.affectedRows) return res.status(404).json({ message: '书签不存在' });
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/reading-bookmarks/:id',
    auth,
    wrap(async (req, res) => {
      const [r] = await db.execute('DELETE FROM reading_bookmarks WHERE id=? AND user_id=?', [
        req.params.id,
        req.user.sub,
      ]);
      if (!r.affectedRows) return res.status(404).json({ message: '书签不存在' });
      res.json({ ok: true });
    }),
  );
  app.get(
    '/api/courses/:courseId/materials/:materialId/reading-info',
    auth,
    wrap(async (req, res) => res.json(await pdfInfo(req))),
  );
  app.get(
    '/api/courses/:courseId/materials/:materialId/reading-page/:page',
    auth,
    wrap(async (req, res) => {
      const file = await pdfPage(req);
      res.sendFile(file);
    }),
  );
}
