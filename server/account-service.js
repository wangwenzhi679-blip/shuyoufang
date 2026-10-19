import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function createAccountService({ secret, db, serviceSettings }) {
  const issue = (user) =>
    jwt.sign({ sub: user.id, role: user.role, version: user.status_version || 0 }, secret, {
      expiresIn: '7d',
    });

  const userView = (user) => ({
    id: user.id,
    account: user.account,
    nickname: user.nickname,
    grade: user.grade,
    role: user.role,
    email: user.email || null,
    emailVerified: Boolean(user.email_verified_at),
  });

  async function findUserByEmail(email) {
    const [rows] = await db.execute('SELECT * FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1', [
      email,
    ]);
    return rows[0] || null;
  }

  async function sendCode(user, purpose) {
    const mailConfig = serviceSettings.snapshot('mail');
    const mailer = serviceSettings.configured('mail')
      ? serviceSettings.mailTransport(mailConfig)
      : null;
    if (!mailer) {
      const error = new Error('邮件服务尚未配置，暂时无法发送验证码');
      error.status = 503;
      throw error;
    }
    const [recent] = await db.execute(
      'SELECT id FROM email_verification_codes WHERE user_id=? AND purpose=? AND created_at>DATE_SUB(NOW(),INTERVAL 60 SECOND) ORDER BY id DESC LIMIT 1',
      [user.id, purpose],
    );
    if (recent.length) {
      const error = new Error('验证码已发送，请 60 秒后再试');
      error.status = 429;
      throw error;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const [result] = await db.execute(
      'INSERT INTO email_verification_codes(user_id,purpose,code_hash,expires_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))',
      [user.id, purpose, await bcrypt.hash(code, 10)],
    );
    const subjects = {
      verify_email: '验证你的数有方邮箱',
      login: '数有方验证码登录',
      reset_password: '重置数有方密码',
    };
    try {
      await mailer.sendMail({
        from: mailConfig.from,
        to: user.email,
        subject: subjects[purpose],
        text: `你的验证码是 ${code}，10 分钟内有效。请勿将验证码告诉他人。`,
      });
    } catch (cause) {
      await db.execute('DELETE FROM email_verification_codes WHERE id=?', [result.insertId]);
      const error = new Error('邮件发送失败，请检查邮箱或稍后重试');
      error.status = 502;
      throw error;
    } finally {
      mailer.close();
    }
  }

  async function consumeCode(userId, purpose, code) {
    const [rows] = await db.execute(
      'SELECT * FROM email_verification_codes WHERE user_id=? AND purpose=? AND used_at IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1',
      [userId, purpose],
    );
    const record = rows[0];
    if (!record || !(await bcrypt.compare(code, record.code_hash))) return false;
    const [result] = await db.execute(
      'UPDATE email_verification_codes SET used_at=NOW() WHERE id=? AND used_at IS NULL AND expires_at>NOW()',
      [record.id],
    );
    return result.affectedRows === 1;
  }

  async function recordLearningLogin(user, account, result, detail) {
    await db.execute(
      'INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,?,?,?,?,?)',
      [
        user?.id || null,
        String(account || '未知').slice(0, 64),
        user?.role || 'student',
        'user_login',
        String(user?.id || ''),
        result,
        detail,
      ],
    );
  }
  return { issue, userView, findUserByEmail, sendCode, consumeCode, recordLearningLogin };
}
