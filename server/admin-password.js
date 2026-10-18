import bcrypt from 'bcryptjs';
import { z } from 'zod';
export function registerAdminPassword(route, db, audit) {
  const attempts = new Map();
  route('post', '/password', async (req, res) => {
    const parsed = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(8).max(64),
        confirmPassword: z.string().min(8).max(64),
      })
      .refine((v) => v.newPassword === v.confirmPassword)
      .refine((v) => v.newPassword !== v.currentPassword)
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: '新密码须为 8—64 位，两次输入一致，并与当前密码不同' });
    const now = Date.now();
    for (const [id, item] of attempts) if (item.until <= now) attempts.delete(id);
    const old = attempts.get(req.user.sub);
    if (old?.count >= 8)
      return res.status(429).json({ message: '验证次数过多，请在 15 分钟后重试' });
    const attempt = { count: (old?.count || 0) + 1, until: old?.until || now + 900000 };
    attempts.set(req.user.sub, attempt);
    const [[user]] = await db.execute(
      "SELECT password_hash,status_version FROM users WHERE id=? AND role='admin' AND status='active'",
      [req.user.sub],
    );
    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.password_hash))) {
      await audit(db, req.user, 'password_change', req.user.sub, 'failed', '当前密码验证未通过');
      return res.status(400).json({ message: '当前密码不正确' });
    }
    const hash = await bcrypt.hash(parsed.data.newPassword, 12);
    const con = await db.getConnection();
    try {
      await con.beginTransaction();
      const [changed] = await con.execute(
        "UPDATE users SET password_hash=?,status_version=status_version+1 WHERE id=? AND status_version=? AND password_hash=? AND role='admin' AND status='active'",
        [hash, req.user.sub, user.status_version, user.password_hash],
      );
      if (!changed.affectedRows)
        throw Object.assign(new Error('账号已变化，请重新登录后操作'), { status: 409 });
      await audit(
        con,
        req.user,
        'password_change',
        req.user.sub,
        'success',
        '已修改密码并撤销旧登录',
      );
      await con.commit();
    } catch (e) {
      await con.rollback();
      throw e;
    } finally {
      con.release();
    }
    if (attempts.get(req.user.sub) === attempt) attempts.delete(req.user.sub);
    res.json({ message: '密码已修改，请重新登录' });
  });
}
