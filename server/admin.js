import { registerAdminUserActions } from './admin-user-actions.js';
import { jobErrorSummary as safeJobError } from './admin-job-diagnostic.mjs';
import { StorageAudit } from './storage-audit.mjs';
import { registerAdminContentDetails } from './admin-content-details.js';
import { ensureAdminTasks, registerAdminTasks } from './admin-task-actions.js';
import jwt from 'jsonwebtoken';
import { ensureAdminContent, registerAdminContent } from './admin-content.js';
import { registerAdminPassword } from './admin-password.js';
import { registerServices } from './service-settings.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { announcementSchemaSql, registerAnnouncements } from './admin-announcements.js';

export async function ensureAdmin(db) {
  await db.query(announcementSchemaSql);
  await ensureAdminTasks(db);
  await ensureAdminContent(db);
  const [columns] = await db.query('SHOW COLUMNS FROM users');
  for (const [name, type] of [
    ['status', "VARCHAR(16) NOT NULL DEFAULT 'active'"],
    ['status_reason', "VARCHAR(300) NOT NULL DEFAULT ''"],
    ['status_version', 'INT UNSIGNED NOT NULL DEFAULT 0'],
  ]) {
    if (!columns.some((column) => column.Field === name))
      await db.query(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
  await db.query(`CREATE TABLE IF NOT EXISTS admin_action_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id BIGINT UNSIGNED NULL,
    actor_account VARCHAR(64) NOT NULL, action VARCHAR(40) NOT NULL, target_id VARCHAR(64) NOT NULL DEFAULT '',
    result VARCHAR(16) NOT NULL, detail VARCHAR(500) NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admin_log_date (created_at), FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL)`);
  const [logColumns] = await db.query('SHOW COLUMNS FROM admin_action_logs');
  if (!logColumns.some((column) => column.Field === 'actor_role'))
    await db.query(
      "ALTER TABLE admin_action_logs ADD COLUMN actor_role VARCHAR(16) NOT NULL DEFAULT 'admin'",
    );
}

// 每次请求读取当前账号状态，避免有效期内的旧令牌绕过停用、注销或角色变更。
export function sessionAuth(db, secret) {
  return async (req, res, next) => {
    let claims;
    try {
      claims = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), secret);
    } catch {
      return res.status(401).json({ message: '请先登录' });
    }
    if (!Number.isSafeInteger(Number(claims.sub)) || Number(claims.sub) <= 0)
      return res.status(401).json({ message: '请先登录' });
    try {
      const [[user]] = await db.execute(
        'SELECT id,account,role,status,status_version FROM users WHERE id=?',
        [claims.sub],
      );
      if (!user) return res.status(401).json({ message: '请先登录' });
      if (user.status !== 'active')
        return res.status(403).json({
          message: user.status === 'cancelled' ? '账号已注销' : '账号已停用，请联系管理员',
        });
      // 改密或退出后递增版本号，使此前签发但尚未过期的令牌立即失效。
      if (Number(claims.version || 0) !== Number(user.status_version))
        return res.status(401).json({ message: '请先登录' });
      req.user = {
        ...claims,
        sub: user.id,
        role: user.role,
        account: user.account,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

const safeText = (value) =>
  String(value || '')
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, 500);
const filterDate = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value),
    '日期不正确',
  )
  .default('');
const paging = z
  .object({
    owner: z
      .string()
      .regex(/^(?:|[1-9]\d{0,14})$/)
      .default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    q: z.string().trim().max(80).default(''),
    status: z.string().max(20).default(''),
    kind: z.string().max(20).default(''),
    role: z.enum(['', 'student', 'admin']).default(''),
    from: filterDate,
    to: filterDate,
    issue: z.enum(['', 'original_missing', 'preview_missing', 'empty_text']).default(''),
    action: z.string().max(40).default(''),
    result: z.enum(['', 'success', 'failed', 'running', 'accepted']).default(''),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, '开始日期应早于结束日期');
const jobsSql = `SELECT id,user_id,course_id,chapter_id,kind,status,created_at,updated_at,error_text,progress_text,'course' AS source FROM course_generation_jobs
  UNION ALL SELECT id,user_id,course_id,chapter_id,'notes',status,created_at,NULL,error_text,progress_text,'note' FROM note_ai_jobs
  UNION ALL SELECT id,user_id,course_id,NULL,'plan',status,created_at,NULL,error_text,NULL,'plan' FROM learning_plan_jobs`;
function dateWhere(filter, column, params) {
  let sql = '';
  if (filter.from) {
    sql += ` AND ${column}>=?`;
    params.push(filter.from);
  }
  if (filter.to) {
    sql += ` AND ${column}<DATE_ADD(?,INTERVAL 1 DAY)`;
    params.push(filter.to);
  }
  return sql;
}

export function registerAdmin(
  app,
  db,
  auth,
  wrap,
  { secret, uploadRoot, previewRoot, imageRoot, services, repairPreview, runtime, backups },
) {
  const audit = (connection, actor, action, target, result, detail = '') =>
    connection.execute(
      'INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,?,?,?,?,?)',
      [
        actor?.sub || null,
        String(actor?.account || '未知').slice(0, 64),
        actor?.role || 'admin',
        action,
        String(target || '').slice(0, 64),
        result,
        safeText(detail),
      ],
    );
  const guard = (req, res, next) =>
    req.user.role === 'admin' ? next() : res.status(403).json({ message: '仅管理员可以访问' });
  const route = (method, url, handler) =>
    app[method]('/api/admin' + url, auth, guard, wrap(handler));
  registerAnnouncements(app, db, wrap, route, audit);
  registerAdminPassword(route, db, audit);
  const limit = new Map();
  app.post(
    '/api/admin/login',
    wrap(async (req, res) => {
      const parsed = z
        .object({
          account: z.string().trim().min(1).max(64),
          password: z.string().min(1).max(128),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: '请输入账号和密码' });
      const key = `${req.ip}:${parsed.data.account.toLowerCase()}`,
        now = Date.now();
      for (const [key, item] of limit) if (item.until <= now) limit.delete(key);
      const previous = limit.get(key);
      if (previous?.count >= 8)
        return res.status(429).json({ message: '尝试次数过多，请在 15 分钟后重试' });
      if (!previous && limit.size >= 2000)
        return res.status(429).json({ message: '登录请求过多，请稍后再试' });
      // Reserve the attempt before asynchronous password verification, including in-flight requests.
      const attempt = {
        count: (previous?.count || 0) + 1,
        until: previous?.until || now + 900000,
      };
      limit.set(key, attempt);
      const [[user]] = await db.execute('SELECT * FROM users WHERE account=?', [
        parsed.data.account,
      ]);
      if (
        !user ||
        user.role !== 'admin' ||
        user.status !== 'active' ||
        !(await bcrypt.compare(parsed.data.password, user.password_hash))
      ) {
        await audit(db, null, 'login', parsed.data.account, 'failed', '管理员登录未通过');
        return res.status(401).json({ message: '管理员账号或密码错误' });
      }
      if (limit.get(key) === attempt) limit.delete(key);
      await audit(db, { sub: user.id, account: user.account }, 'login', user.id, 'success');
      res.json({
        token: jwt.sign({ sub: user.id, role: user.role, version: user.status_version }, secret, {
          expiresIn: '12h',
        }),
        user: { id: user.id, account: user.account, nickname: user.nickname },
      });
    }),
  );
  route('get', '/me', async (req, res) =>
    res.json({ user: { id: req.user.sub, account: req.user.account } }),
  );
  route('post', '/logout', async (req, res) => {
    await audit(db, req.user, 'logout', req.user.sub, 'success');
    res.json({ ok: true });
  });
  const fileState = async (root, name) => {
    if (!name || path.basename(name) !== name) return { exists: false, bytes: 0 };
    try {
      const stat = await fs.stat(path.join(root, name));
      return { exists: stat.isFile(), bytes: stat.isFile() ? stat.size : 0 };
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, bytes: 0 };
      throw error;
    }
  };
  const storageAudit = new StorageAudit(db, { uploadRoot, imageRoot });
  route('post', '/storage/check', async (req, res) => res.json(await storageAudit.read(true)));
  route('get', '/overview', async (req, res) => {
    const [[counts]] = await db.query(`SELECT (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE status='active') AS activeUsers, (SELECT COUNT(*) FROM users WHERE status='disabled') AS disabledUsers,
      (SELECT COUNT(*) FROM courses) AS courses, (SELECT COUNT(*) FROM course_chapters) AS chapters, (SELECT COUNT(*) FROM course_materials) AS materials`);
    const [states] = await db.query(
      `SELECT status,COUNT(*) AS count FROM (${jobsSql}) j GROUP BY status`,
    );
    const storage = await storageAudit.read();
    const [recent] = await db.query(
      `SELECT j.id,j.source,j.kind,j.status,j.error_text,j.created_at,u.account,c.title AS course_title FROM (${jobsSql}) j JOIN users u ON u.id=j.user_id LEFT JOIN courses c ON c.id=j.course_id WHERE j.status='failed' ORDER BY j.created_at DESC,j.id DESC LIMIT 5`,
    );
    const recentFailures = recent.map(({ error_text, ...item }) => ({
      ...item,
      error_summary: safeJobError(item.status, error_text || ''),
    }));
    res.json({
      counts,
      jobs: states,
      recentFailures,
      storage,
      checkedAt: new Date().toISOString(),
    });
  });
  const userSelect = `SELECT u.id,u.account,u.nickname,u.role,u.status,u.status_reason,u.status_version,u.created_at,
    (u.email_verified_at IS NOT NULL) AS email_verified,
    (SELECT COUNT(*) FROM courses c WHERE c.user_id=u.id) AS course_count,
    (SELECT COALESCE(SUM(m.size_bytes),0) FROM course_materials m JOIN courses c ON c.id=m.course_id WHERE c.user_id=u.id) AS material_bytes FROM users u`;
  const pageResult = async (req, res, from, select, where, params) => {
    const parsed = paging.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: '查询条件不正确' });
    const { page, owner } = parsed.data;
    let ownerScope = null;
    if (owner) {
      const [[account]] = await db.execute('SELECT id,account,nickname FROM users WHERE id=?', [
        owner,
      ]);
      ownerScope = account || { account: '账户已删除' };
    }
    const [[{ total }]] = await db.execute(
      `SELECT COUNT(*) AS total FROM ${from} ${where}`,
      params,
    );
    const [items] = await db.execute(
      `${select} ${where} ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
      params,
    );
    return {
      items,
      total: Number(total),
      page,
      pageSize: 20,
      ...(ownerScope ? { owner_scope: ownerScope } : {}),
    };
  };
  const query = (req) => {
    const parsed = paging.safeParse(req.query);
    if (!parsed.success) throw Object.assign(new Error('查询条件不正确'), { status: 400 });
    return parsed.data;
  };
  route('get', '/users', async (req, res) => {
    const filter = query(req),
      { q, status, role } = filter;
    if (status && !['active', 'disabled', 'cancelled'].includes(status))
      return res.status(400).json({ message: '账户状态不正确' });
    const params = [`%${q}%`, `%${q}%`];
    let where = `WHERE (u.account LIKE ? OR u.nickname LIKE ?)${status ? ' AND u.status=?' : ''}`;
    if (status) params.push(status);
    if (role) {
      where += ' AND u.role=?';
      params.push(role);
    }
    where += dateWhere(filter, 'u.created_at', params);
    res.json(await pageResult(req, res, 'users u', userSelect, where, params));
  });
  route('get', '/users/:id', async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: '用户编号不正确' });
    const [[user]] = await db.execute(userSelect + ' WHERE u.id=?', [id.data]);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    const [[counts]] = await db.execute(
      `SELECT (SELECT COUNT(*) FROM chapter_notes WHERE user_id=?) AS notes,
      (SELECT COUNT(*) FROM chapter_practices p JOIN courses c ON c.id=p.course_id WHERE c.user_id=?) AS practices`,
      [id.data, id.data],
    );
    res.json({ user: { ...user, ...counts } });
  });
  registerAdminUserActions(route, db, audit);
  route('get', '/courses', async (req, res) => {
    const filter = query(req),
      { q, status } = filter,
      params = [`%${q}%`, `%${q}%`];
    if (status && !['active', 'paused'].includes(status))
      return res.status(400).json({ message: '课程状态不正确' });
    let where = 'WHERE (c.title LIKE ? OR u.account LIKE ?)';
    if (status) {
      where += ' AND c.admin_status=?';
      params.push(status);
    }
    if (filter.owner) {
      where += ' AND c.user_id=?';
      params.push(filter.owner);
    }
    where += dateWhere(filter, 'c.created_at', params);
    const from = 'courses c JOIN users u ON u.id=c.user_id';
    const select = `SELECT c.id,c.title,c.admin_status,c.admin_reason,c.admin_changed_at,c.admin_version,u.account,c.created_at,(SELECT COUNT(*) FROM course_chapters ch WHERE ch.course_id=c.id) AS chapters,
      (SELECT COUNT(*) FROM course_materials m WHERE m.course_id=c.id) AS materials FROM ${from}`;
    res.json(await pageResult(req, res, from, select, where, params));
  });
  route('get', '/materials', async (req, res) => {
    const filter = query(req),
      { q, issue, page, status } = filter,
      params = [`%${q}%`, `%${q}%`];
    const from =
      'course_materials m JOIN courses c ON c.id=m.course_id JOIN users u ON u.id=c.user_id';
    const select = `SELECT m.id,m.admin_status,m.admin_reason,m.admin_changed_at,m.admin_version,m.original_name,m.stored_name,m.preview_name,m.size_bytes,m.created_at,c.title AS course_title,u.account,CHAR_LENGTH(m.extracted_text) AS text_length FROM ${from}`;
    if (status && !['active', 'paused'].includes(status))
      return res.status(400).json({ message: '资料状态不正确' });
    let where = 'WHERE (m.original_name LIKE ? OR u.account LIKE ?)';
    if (status) {
      where += ' AND m.admin_status=?';
      params.push(status);
    }
    if (filter.owner) {
      where += ' AND c.user_id=?';
      params.push(filter.owner);
    }
    where += dateWhere(filter, 'm.created_at', params);
    const inspect = async (item) => {
      const [original, preview] = await Promise.all([
        fileState(uploadRoot, item.stored_name),
        fileState(previewRoot, item.preview_name),
      ]);
      const { stored_name, preview_name, cursor_time, ...safe } = item;
      return {
        ...safe,
        original_exists: original.exists,
        preview_status: preview_name ? (preview.exists ? 'ready' : 'missing') : 'not_generated',
      };
    };
    let data;
    if (!issue || issue === 'empty_text') {
      if (issue === 'empty_text') where += " AND CHAR_LENGTH(COALESCE(m.extracted_text,''))=0";
      data = await pageResult(req, res, from, select, where, params);
      data.items = await Promise.all(data.items.map(inspect));
    } else {
      data = { items: [], total: 0, page, pageSize: 20 };
      let cursor = null;
      while (true) {
        const cursorWhere = cursor ? ' AND (m.created_at<? OR (m.created_at=? AND m.id<?))' : '';
        const cursorArgs = cursor ? [cursor.time, cursor.time, cursor.id] : [];
        const pagedSelect = select.replace(
          'SELECT m.id',
          "SELECT DATE_FORMAT(m.created_at,'%Y-%m-%d %H:%i:%s.%f') AS cursor_time,m.id",
        );
        const [rows] = await db.execute(
          pagedSelect +
            ' ' +
            where +
            cursorWhere +
            ' ORDER BY m.created_at DESC,m.id DESC LIMIT 128',
          [...params, ...cursorArgs],
        );
        if (!rows.length) break;
        for (let offset = 0; offset < rows.length; offset += 32) {
          const checked = await Promise.all(rows.slice(offset, offset + 32).map(inspect));
          for (const item of checked) {
            if (
              issue === 'original_missing'
                ? !item.original_exists
                : item.preview_status === 'missing'
            ) {
              if (data.total >= (page - 1) * 20 && data.total < page * 20) data.items.push(item);
              data.total++;
            }
          }
        }
        const last = rows.at(-1);
        cursor = { time: last.cursor_time, id: last.id };
      }
      if (filter.owner) {
        const [[account]] = await db.execute('SELECT id,account,nickname FROM users WHERE id=?', [
          filter.owner,
        ]);
        data.owner_scope = account || { account: '账户已删除' };
      }
    }
    res.json(data);
  });
  route('get', '/jobs', async (req, res) => {
    const filter = query(req),
      { q, status, kind } = filter;
    if (status && !['running', 'saving', 'done', 'failed', 'cancelled', 'adopted'].includes(status))
      return res.status(400).json({ message: '任务状态不正确' });
    if (kind && !['chapters', 'summary', 'practice', 'notes', 'plan'].includes(kind))
      return res.status(400).json({ message: '任务类型不正确' });
    const from = `(${jobsSql}) j JOIN users u ON u.id=j.user_id LEFT JOIN courses c ON c.id=j.course_id`;
    let where = `WHERE (u.account LIKE ? OR c.title LIKE ?)${status ? ' AND j.status=?' : ''}${kind ? ' AND j.kind=?' : ''}`;
    const params = [`%${q}%`, `%${q}%`, ...(status ? [status] : []), ...(kind ? [kind] : [])];
    if (filter.owner) {
      where += ' AND j.user_id=?';
      params.push(filter.owner);
    }
    where += dateWhere(filter, 'j.created_at', params);
    const data = await pageResult(
      req,
      res,
      from,
      `SELECT j.id,j.source,j.kind,j.status,j.created_at,j.updated_at,j.error_text,u.account,c.title AS course_title FROM ${from}`,
      where,
      params,
    );
    res.json({
      ...data,
      items: data.items.map(({ error_text, ...item }) => ({
        ...item,
        error_summary: safeJobError(item.status, error_text || ''),
      })),
    });
  });
  route('get', '/logs', async (req, res) => {
    const filter = query(req),
      { q, action, result, role } = filter;
    const fields = [
      'l.actor_account',
      'l.action',
      'l.target_id',
      'l.detail',
      'target_user.account',
      'target_announcement.title',
      'target_course.title',
      'target_material.original_name',
    ];
    if (services) fields.push("JSON_UNQUOTE(JSON_EXTRACT(target_service.config_json,'$.name'))");
    const params = fields.map(() => `%${q}%`);
    let where = 'WHERE (' + fields.map((field) => `${field} LIKE ?`).join(' OR ') + ')';
    if (action) {
      where += ' AND l.action=?';
      params.push(action);
    }
    if (result) {
      where += ' AND l.result=?';
      params.push(result);
    }
    if (role) {
      where += ' AND l.actor_role=?';
      params.push(role);
    }
    if (filter.owner) {
      where +=
        " AND (l.actor_id=? OR (l.action IN ('user_disable','user_restore','user_status','user_cancel') AND l.target_id=?))";
      params.push(filter.owner, filter.owner);
    }
    where += dateWhere(filter, 'l.created_at', params);
    const from = `admin_action_logs l LEFT JOIN courses target_course ON l.action IN ('course_pause','course_restore') AND CAST(target_course.id AS CHAR)=l.target_id LEFT JOIN course_materials target_material ON l.action IN ('material_pause','material_restore','preview_repair') AND CAST(target_material.id AS CHAR)=l.target_id LEFT JOIN users target_user ON l.action IN ('user_disable','user_restore','user_status','user_cancel') AND target_user.id=l.target_id LEFT JOIN platform_announcements target_announcement ON l.action LIKE 'announcement_%' AND target_announcement.id=l.target_id${services ? " LEFT JOIN platform_service_settings target_service ON l.action IN ('service_config','service_check','service_delete') AND target_service.kind=l.target_id" : ''}`;
    res.json(
      await pageResult(
        req,
        res,
        from,
        `SELECT l.id,l.actor_account,l.actor_role,l.action,l.target_id,l.result,l.detail,l.created_at,COALESCE(target_user.account,target_announcement.title,target_course.title,target_material.original_name,${services ? "JSON_UNQUOTE(JSON_EXTRACT(target_service.config_json,'$.name'))," : ''}'') AS target_name FROM ${from}`,
        where,
        params,
      ),
    );
  });
  registerAdminContentDetails(route, db, { uploadRoot, previewRoot });
  registerAdminTasks(route, app, db, audit, safeJobError);
  registerAdminContent(route, app, db, audit, {
    uploadRoot,
    previewRoot,
    repairPreview,
  });
  if (backups) backups.register(route, audit);
  if (runtime) runtime.register(route, audit);
  if (services) {
    registerServices(route, services, audit);
    services.chapterImages?.registerAdmin(route, audit);
  } else
    route('get', '/services', async (req, res) => {
      await db.query('SELECT 1');
      res.json({
        checkedAt: new Date().toISOString(),
        database: 'connected',
        backend: 'running',
        aiConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        mailConfigured: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].every(
          (key) => Boolean(process.env[key]),
        ),
        models: [
          { id: 'deepseek-flash', label: 'DeepSeek Flash' },
          { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        ],
        externalConnectionsVerified: false,
      });
    });
}
