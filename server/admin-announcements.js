import { z } from 'zod';

export const announcementSchemaSql = `CREATE TABLE IF NOT EXISTS platform_announcements (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL, body TEXT NOT NULL,
 placement VARCHAR(16) NOT NULL DEFAULT 'home', status VARCHAR(16) NOT NULL DEFAULT 'draft',
 version INT UNSIGNED NOT NULL DEFAULT 1, published_at DATETIME NULL, ends_at DATETIME NULL,
 deleted_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_announcement_public(status,placement,deleted_at,ends_at))`;
const idSchema = z.coerce.number().int().positive();
const endSchema = z.string().datetime({ offset: true }).nullable().default(null);
const contentSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(5000),
  placement: z.enum(['home', 'login']),
  endsAt: endSchema,
});
const conflict = () => Object.assign(new Error('公告已被修改，请刷新后重试'), { status: 409 });

export function registerAnnouncements(app, db, wrap, route, audit) {
  app.get(
    '/api/announcements',
    wrap(async (req, res) => {
      const placement = z.enum(['home', 'login']).safeParse(req.query.placement);
      if (!placement.success) return res.status(400).json({ message: '公告位置不正确' });
      const [items] = await db.execute(
        "SELECT id,title,body,published_at,version FROM platform_announcements WHERE placement=? AND status='published' AND deleted_at IS NULL AND (ends_at IS NULL OR ends_at>NOW()) ORDER BY published_at DESC,id DESC LIMIT 20",
        [placement.data],
      );
      res.set('Cache-Control', 'no-store');
      res.json({ items });
    }),
  );
  route('get', '/announcements', async (req, res) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        q: z.string().trim().max(80).default(''),
        status: z.enum(['', 'draft', 'published', 'withdrawn', 'deleted']).default(''),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: '公告查询条件不正确' });
    const { q, status, page } = parsed.data,
      params = [`%${q}%`];
    const where = `WHERE title LIKE ? AND deleted_at IS ${status === 'deleted' ? 'NOT ' : ''}NULL${status && status !== 'deleted' ? ' AND status=?' : ''}`;
    if (status && status !== 'deleted') params.push(status);
    const [[{ total }]] = await db.execute(
      `SELECT COUNT(*) total FROM platform_announcements ${where}`,
      params,
    );
    const [items] = await db.execute(
      `SELECT id,title,body,placement,status,version,published_at,ends_at,deleted_at,created_at FROM platform_announcements ${where} ORDER BY id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
      params,
    );
    res.json({ items, page, pageSize: 20, total: Number(total) });
  });
  route('post', '/announcements', async (req, res) => {
    const parsed = contentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '请填写标题和正文，检查结束时间' });
    const { title, body, placement, endsAt } = parsed.data;
    if (endsAt && Date.parse(endsAt) <= Date.now())
      return res.status(400).json({ message: '结束时间应晚于现在' });
    const con = await db.getConnection();
    try {
      await con.beginTransaction();
      const [result] = await con.execute(
        'INSERT INTO platform_announcements(title,body,placement,ends_at) VALUES(?,?,?,?)',
        [title, body, placement, endsAt ? new Date(endsAt) : null],
      );
      await audit(con, req.user, 'announcement_create', result.insertId, 'success', title);
      await con.commit();
      res.status(201).json({ id: result.insertId });
    } catch (error) {
      await con.rollback();
      throw error;
    } finally {
      con.release();
    }
  });
  route('patch', '/announcements/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id),
      parsed = contentSchema.extend({ version: z.number().int().positive() }).safeParse(req.body);
    if (!id.success || !parsed.success)
      return res.status(400).json({ message: '公告内容或编号不正确' });
    const { title, body, placement, endsAt, version } = parsed.data;
    if (endsAt && Date.parse(endsAt) <= Date.now())
      return res.status(400).json({ message: '结束时间应晚于现在' });
    await mutate(
      req,
      id.data,
      version,
      async (con, item) => {
        if (item.deleted_at) throw Object.assign(new Error('请先恢复公告'), { status: 409 });
        await con.execute(
          "UPDATE platform_announcements SET title=?,body=?,placement=?,ends_at=?,status='draft',published_at=NULL,version=version+1 WHERE id=?",
          [title, body, placement, endsAt ? new Date(endsAt) : null, id.data],
        );
      },
      'announcement_edit',
      title,
    );
    res.json({ ok: true });
  });
  route('post', '/announcements/:id/action', async (req, res) => {
    const id = idSchema.safeParse(req.params.id),
      parsed = z
        .object({
          version: z.number().int().positive(),
          action: z.enum(['publish', 'withdraw', 'delete', 'restore']),
        })
        .safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ message: '公告操作不正确' });
    const { version, action } = parsed.data;
    await mutate(
      req,
      id.data,
      version,
      async (con, item) => {
        if (action === 'restore') {
          if (!item.deleted_at) throw conflict();
          await con.execute(
            "UPDATE platform_announcements SET deleted_at=NULL,status='draft',published_at=NULL,version=version+1 WHERE id=?",
            [id.data],
          );
        } else {
          if (item.deleted_at) throw conflict();
          if (action === 'publish') {
            if (item.status === 'published') throw conflict();
            if (item.ends_at && new Date(item.ends_at).getTime() <= Date.now())
              throw Object.assign(new Error('公告已过期，请先编辑结束时间'), { status: 400 });
            await con.execute(
              "UPDATE platform_announcements SET status='published',published_at=NOW(),version=version+1 WHERE id=?",
              [id.data],
            );
          } else if (action === 'withdraw') {
            if (item.status !== 'published') throw conflict();
            await con.execute(
              "UPDATE platform_announcements SET status='withdrawn',version=version+1 WHERE id=?",
              [id.data],
            );
          } else
            await con.execute(
              'UPDATE platform_announcements SET deleted_at=NOW(),version=version+1 WHERE id=?',
              [id.data],
            );
        }
      },
      `announcement_${action}`,
    );
    res.json({ ok: true });
  });
  async function mutate(req, id, version, change, action, detail = '') {
    const con = await db.getConnection();
    try {
      await con.beginTransaction();
      const [[item]] = await con.execute(
        'SELECT * FROM platform_announcements WHERE id=? FOR UPDATE',
        [id],
      );
      if (!item) throw Object.assign(new Error('公告不存在'), { status: 404 });
      if (item.version !== version) throw conflict();
      await change(con, item);
      await audit(con, req.user, action, id, 'success', detail || item.title);
      await con.commit();
    } catch (error) {
      await con.rollback();
      await audit(con, req.user, action, id, 'failed', '操作未完成');
      throw error;
    } finally {
      con.release();
    }
  }
}
