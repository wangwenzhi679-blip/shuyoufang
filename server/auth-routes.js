import {
  grades,
  emailSchema,
  accountSchema,
  passwordSchema,
  codeSchema,
} from './request-schemas.mjs';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerAuthRoutes(
  app,
  {
    asyncRoute,
    validationError,
    serviceSettings,
    db,
    sendCode,
    findUserByEmail,
    consumeCode,
    recordLearningLogin,
    issue,
    userView,
    auth,
  },
) {
  app.post(
    '/api/auth/register',
    asyncRoute(async (req, res) => {
      const schema = z.object({
        account: accountSchema,
        email: emailSchema,
        nickname: z.string().trim().min(2, '昵称为 2—16 位').max(16, '昵称为 2—16 位'),
        grade: z
          .union([z.enum(grades), z.literal('')])
          .optional()
          .default(''),
        password: passwordSchema,
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      if (!serviceSettings.configured('mail'))
        return res
          .status(503)
          .json({ message: '邮件服务尚未配置或已暂停，暂时不能注册需要验证的新账号' });
      const { account, email, nickname, grade, password } = parsed.data;
      try {
        const [result] = await db.execute(
          'INSERT INTO users(account,email,nickname,grade,password_hash) VALUES(?,?,?,?,?)',
          [account, email, nickname, grade, await bcrypt.hash(password, 12)],
        );
        const user = { id: result.insertId, email };
        await sendCode(user, 'verify_email');
        res.status(201).json({
          message: '验证码已发送到邮箱，请完成验证',
          account,
          email,
          verificationRequired: true,
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY')
          return res.status(409).json({ message: '账号或邮箱已被使用' });
        throw error;
      }
    }),
  );

  app.post(
    '/api/auth/verify-email',
    asyncRoute(async (req, res) => {
      const parsed = z.object({ email: emailSchema, code: codeSchema }).safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const user = await findUserByEmail(parsed.data.email);
      if (!user || !(await consumeCode(user.id, 'verify_email', parsed.data.code)))
        return res.status(400).json({ message: '验证码错误、已过期或已使用' });
      await db.execute('UPDATE users SET email_verified_at=NOW() WHERE id=?', [user.id]);
      res.json({ message: '邮箱验证成功，请登录' });
    }),
  );

  app.post(
    '/api/auth/resend-verification',
    asyncRoute(async (req, res) => {
      const parsed = z.object({ email: emailSchema }).safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const user = await findUserByEmail(parsed.data.email);
      if (!user) return res.json({ message: '如果邮箱已绑定账号，验证码会发送到该邮箱' });
      if (user.email_verified_at) return res.status(400).json({ message: '该邮箱已经验证' });
      await sendCode(user, 'verify_email');
      res.json({ message: '验证码已发送，请查看邮箱' });
    }),
  );

  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const parsed = z
        .object({ account: accountSchema, password: passwordSchema })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const [rows] = await db.execute('SELECT * FROM users WHERE account=? LIMIT 1', [
        parsed.data.account,
      ]);
      const user = rows[0];
      if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
        await recordLearningLogin(user, parsed.data.account, 'failed', '密码登录未通过');
        return res.status(401).json({ message: '账号或密码错误' });
      }
      if (user.status !== 'active') {
        await recordLearningLogin(user, user.account, 'failed', '账户已停用');
        return res.status(403).json({
          message: user.status === 'cancelled' ? '账号已注销' : '账号已停用，请联系管理员',
        });
      }
      if (user.email && !user.email_verified_at) {
        await recordLearningLogin(user, user.account, 'failed', '邮箱尚未验证');
        return res
          .status(403)
          .json({ message: '请先完成邮箱验证', needsEmailVerification: true, email: user.email });
      }
      await recordLearningLogin(user, user.account, 'success', '密码登录');
      res.json({ token: issue(user), user: userView(user) });
    }),
  );

  app.post(
    '/api/auth/send-login-code',
    asyncRoute(async (req, res) => {
      const parsed = z.object({ email: emailSchema }).safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const user = await findUserByEmail(parsed.data.email);
      if (!user || !user.email_verified_at)
        return res.status(400).json({ message: '该邮箱尚未完成验证或未绑定账号' });
      if (user.status !== 'active')
        return res.status(403).json({
          message: user.status === 'cancelled' ? '账号已注销' : '账号已停用，请联系管理员',
        });
      await sendCode(user, 'login');
      res.json({ message: '验证码已发送，请查看邮箱' });
    }),
  );

  app.post(
    '/api/auth/login-code',
    asyncRoute(async (req, res) => {
      const parsed = z.object({ email: emailSchema, code: codeSchema }).safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const user = await findUserByEmail(parsed.data.email);
      if (user && user.status !== 'active') {
        await recordLearningLogin(user, user.account, 'failed', '账户已停用');
        return res.status(403).json({
          message: user.status === 'cancelled' ? '账号已注销' : '账号已停用，请联系管理员',
        });
      }
      if (
        !user ||
        !user.email_verified_at ||
        !(await consumeCode(user.id, 'login', parsed.data.code))
      ) {
        await recordLearningLogin(user, user?.account, 'failed', '验证码登录未通过');
        return res.status(400).json({ message: '验证码错误、已过期或已使用' });
      }
      await recordLearningLogin(user, user.account, 'success', '验证码登录');
      res.json({ token: issue(user), user: userView(user) });
    }),
  );

  app.post(
    '/api/auth/forgot-password',
    asyncRoute(async (req, res) => {
      const parsed = z.object({ email: emailSchema }).safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const user = await findUserByEmail(parsed.data.email);
      if (user?.email_verified_at) await sendCode(user, 'reset_password');
      res.json({ message: '如果该邮箱已绑定并验证账号，验证码会发送到该邮箱' });
    }),
  );

  app.post(
    '/api/auth/reset-password',
    asyncRoute(async (req, res) => {
      const parsed = z
        .object({ email: emailSchema, code: codeSchema, password: passwordSchema })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const user = await findUserByEmail(parsed.data.email);
      if (!user || !(await consumeCode(user.id, 'reset_password', parsed.data.code)))
        return res.status(400).json({ message: '验证码错误、已过期或已使用' });
      await db.execute(
        'UPDATE users SET password_hash=?,status_version=status_version+1 WHERE id=?',
        [await bcrypt.hash(parsed.data.password, 12), user.id],
      );
      res.json({ message: '密码已重置，请使用新密码登录' });
    }),
  );

  app.get(
    '/api/auth/me',
    auth,
    asyncRoute(async (req, res) => {
      const [rows] = await db.execute(
        'SELECT id,account,email,email_verified_at,nickname,grade,role FROM users WHERE id=?',
        [req.user.sub],
      );
      if (!rows[0]) return res.status(404).json({ message: '用户不存在' });
      res.json(userView(rows[0]));
    }),
  );

  app.post('/api/auth/bind-email', auth, (req, res) =>
    res.status(400).json({ message: '请在个人资料中验证新邮箱后更换绑定' }),
  );
}
