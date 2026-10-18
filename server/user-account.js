import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { defaultPreferences, normalizePreferences } from '../shared/account-preferences.mjs';
import { imageModelOptions } from '../shared/image-models.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const preferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    interfaceSize: z.enum(['small', 'standard', 'large']),
    readingSize: z.union([
      z.literal(14),
      z.literal(16),
      z.literal(18),
      z.literal(20),
      z.literal(22),
    ]),
    startPage: z.enum(['home', 'last']),
    restoreReading: z.boolean(),
    defaultModel: z.enum(['configured', 'deepseek-flash', 'deepseek-v4-pro']),
    imageModel: z.string().min(1).max(100).default('configured'),
    answerStyle: z.enum(['concise', 'moderate', 'detailed']),
  })
  .strict();
export function checkAvatar(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 700000) throw fail('头像不能超过 500KB');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw fail('请选择 PNG、JPG 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  const valid =
    match[1] === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > 512000 || bytes.toString('base64') !== match[2])
    throw fail('头像图片无效或过大');
  return value;
}
export async function ensureUserAccount(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS user_preferences(user_id BIGINT UNSIGNED PRIMARY KEY,avatar MEDIUMTEXT NULL,settings_json JSON NOT NULL,version INT UNSIGNED NOT NULL DEFAULT 0,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS user_email_changes(user_id BIGINT UNSIGNED PRIMARY KEY,email VARCHAR(254) NOT NULL,code_hash VARCHAR(255) NOT NULL,attempts INT NOT NULL DEFAULT 0,expires_at DATETIME NOT NULL,created_at DATETIME NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  );
}
export async function readPreferences(db, userId) {
  const [[row]] = await db.execute(
    'SELECT settings_json,version FROM user_preferences WHERE user_id=?',
    [userId],
  );
  const value =
    typeof row?.settings_json === 'string' ? JSON.parse(row.settings_json) : row?.settings_json;
  return { preferences: normalizePreferences(value), version: row?.version || 0 };
}
export function registerUserAccount(
  app,
  db,
  auth,
  route,
  { userView, passwordSchema, emailSchema, services, models },
) {
  const readUser = async (id) => {
    const [[row]] = await db.execute(
      'SELECT u.*,p.avatar FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id WHERE u.id=?',
      [id],
    );
    if (!row) throw fail('用户不存在', 404);
    return { ...userView(row), avatar: row.avatar || null };
  };
  const ensureRow = async (id) =>
    db.execute('INSERT IGNORE INTO user_preferences(user_id,settings_json) VALUES(?,?)', [
      id,
      JSON.stringify(defaultPreferences),
    ]);
  const parse = (schema, body) => {
    const result = schema.safeParse(body);
    if (!result.success) throw fail(result.error.issues[0]?.message || '输入格式不正确');
    return result.data;
  };
  app.get(
    '/api/account',
    auth,
    route(async (req, res) =>
      res.json({
        user: await readUser(req.user.sub),
        ...(await readPreferences(db, req.user.sub)),
        models: models(),
        imageModel: services.chapterImages?.modelInfo() || null,
        imageModels: services.chapterImages?.modelOptions?.() || imageModelOptions(),
      }),
    ),
  );
  app.patch(
    '/api/account/profile',
    auth,
    route(async (req, res) => {
      const value = parse(
        z
          .object({
            nickname: z.string().trim().min(2, '昵称为 2—16 位').max(16, '昵称为 2—16 位'),
            avatar: z.string().nullable(),
          })
          .strict(),
        req.body,
      );
      checkAvatar(value.avatar);
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('UPDATE users SET nickname=? WHERE id=?', [
          value.nickname,
          req.user.sub,
        ]);
        await conn.execute(
          'INSERT INTO user_preferences(user_id,settings_json,avatar) VALUES(?,?,?) ON DUPLICATE KEY UPDATE avatar=VALUES(avatar)',
          [req.user.sub, JSON.stringify(defaultPreferences), value.avatar],
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      res.json({ user: await readUser(req.user.sub) });
    }),
  );
  app.put(
    '/api/account/preferences',
    auth,
    route(async (req, res) => {
      const value = parse(
        z
          .object({ preferences: preferencesSchema, version: z.number().int().nonnegative() })
          .strict(),
        req.body,
      );
      if (!models().some((model) => model.id === value.preferences.defaultModel))
        throw fail('该模型已停用，请选择可用模型');
      const imageModels = services.chapterImages?.modelOptions?.() || imageModelOptions();
      if (value.preferences.imageModel === 'configured')
        value.preferences.imageModel =
          services.chapterImages?.modelInfo()?.id || imageModels[0]?.id;
      if (!imageModels.some((model) => model.id === value.preferences.imageModel))
        throw fail('该生图模型不可用，请重新选择');
      await ensureRow(req.user.sub);
      const [result] = await db.execute(
        'UPDATE user_preferences SET settings_json=?,version=version+1 WHERE user_id=? AND version=?',
        [JSON.stringify(value.preferences), req.user.sub, value.version],
      );
      if (!result.affectedRows) throw fail('设置已在其他页面更新，请重新加载后再保存', 409);
      res.json(await readPreferences(db, req.user.sub));
    }),
  );
  app.post(
    '/api/account/password',
    auth,
    route(async (req, res) => {
      if (req.user.role === 'admin') throw fail('请在管理端修改管理员密码', 403);
      const value = parse(
        z
          .object({
            currentPassword: z.string().min(1).max(100),
            password: passwordSchema,
            confirmPassword: z.string(),
          })
          .strict(),
        req.body,
      );
      if (value.password !== value.confirmPassword) throw fail('两次输入的密码不一致');
      const [[user]] = await db.execute('SELECT password_hash FROM users WHERE id=?', [
        req.user.sub,
      ]);
      if (!user || !(await bcrypt.compare(value.currentPassword, user.password_hash)))
        throw fail('原密码不正确');
      const [result] = await db.execute(
        'UPDATE users SET password_hash=?,status_version=status_version+1 WHERE id=? AND password_hash=?',
        [await bcrypt.hash(value.password, 12), req.user.sub, user.password_hash],
      );
      if (!result.affectedRows) throw fail('账号信息已更新，请重新登录', 409);
      res.json({ message: '密码已修改，请重新登录' });
    }),
  );
  app.post(
    '/api/auth/logout',
    auth,
    route(async (req, res) => {
      await db.execute(
        'UPDATE users SET status_version=status_version+1 WHERE id=? AND status_version=?',
        [req.user.sub, Number(req.user.version || 0)],
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/account/email-code',
    auth,
    route(async (req, res) => {
      const value = parse(
        z.object({ email: emailSchema, currentPassword: z.string().min(1).max(100) }).strict(),
        req.body,
      );
      const [[user]] = await db.execute('SELECT password_hash,email FROM users WHERE id=?', [
        req.user.sub,
      ]);
      if (!user || !(await bcrypt.compare(value.currentPassword, user.password_hash)))
        throw fail('当前密码不正确');
      if (user.email?.toLowerCase() === value.email) throw fail('请输入新的邮箱地址');
      const [[occupied]] = await db.execute(
        'SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id<>?',
        [value.email, req.user.sub],
      );
      if (occupied) throw fail('该邮箱已绑定其他账号', 409);
      if (!services.configured('mail')) throw fail('邮件服务尚未配置或已暂停', 503);
      const code = String(randomInt(100000, 1000000)),
        hashed = await bcrypt.hash(code, 10);
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.sub]);
        const [[recent]] = await conn.execute(
          'SELECT user_id FROM user_email_changes WHERE user_id=? AND created_at>DATE_SUB(NOW(),INTERVAL 60 SECOND)',
          [req.user.sub],
        );
        if (recent) throw fail('验证码已发送，请 60 秒后再试', 429);
        await conn.execute(
          'INSERT INTO user_email_changes(user_id,email,code_hash,expires_at,created_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),NOW()) ON DUPLICATE KEY UPDATE email=VALUES(email),code_hash=VALUES(code_hash),attempts=0,expires_at=VALUES(expires_at),created_at=NOW()',
          [req.user.sub, value.email, hashed],
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      const config = services.snapshot('mail'),
        mailer = services.mailTransport(config);
      try {
        await mailer.sendMail({
          from: config.from,
          to: value.email,
          subject: '更换数有方绑定邮箱',
          text: `你的验证码是 ${code}，10 分钟内有效。请勿转发。`,
        });
      } catch {
        await db.execute('DELETE FROM user_email_changes WHERE user_id=? AND code_hash=?', [
          req.user.sub,
          hashed,
        ]);
        throw fail('邮件发送失败，请稍后重试', 502);
      } finally {
        mailer.close();
      }
      res.json({ message: '验证码已发送至新邮箱' });
    }),
  );
  app.put(
    '/api/account/email',
    auth,
    route(async (req, res) => {
      const value = parse(
        z
          .object({
            email: emailSchema,
            code: z.string().regex(/^\d{6}$/, '请输入 6 位验证码'),
            currentPassword: z.string().min(1).max(100),
          })
          .strict(),
        req.body,
      );
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const [[user]] = await conn.execute(
          'SELECT password_hash FROM users WHERE id=? FOR UPDATE',
          [req.user.sub],
        );
        if (!user || !(await bcrypt.compare(value.currentPassword, user.password_hash)))
          throw fail('当前密码不正确');
        const [[challenge]] = await conn.execute(
          'SELECT * FROM user_email_changes WHERE user_id=? AND email=? AND expires_at>NOW() FOR UPDATE',
          [req.user.sub, value.email],
        );
        if (!challenge || challenge.attempts >= 5) throw fail('验证码已失效，请重新发送');
        if (!(await bcrypt.compare(value.code, challenge.code_hash))) {
          await conn.execute('UPDATE user_email_changes SET attempts=attempts+1 WHERE user_id=?', [
            req.user.sub,
          ]);
          await conn.commit();
          throw fail('验证码不正确');
        }
        await conn.execute('UPDATE users SET email=?,email_verified_at=NOW() WHERE id=?', [
          value.email,
          req.user.sub,
        ]);
        await conn.execute('DELETE FROM user_email_changes WHERE user_id=?', [req.user.sub]);
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        if (e.code === 'ER_DUP_ENTRY') throw fail('该邮箱已被使用', 409);
        throw e;
      } finally {
        conn.release();
      }
      res.json({ user: await readUser(req.user.sub) });
    }),
  );
}
