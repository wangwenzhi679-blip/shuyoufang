import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export function reviewerCredentials() {
  return {
    account: `review_${randomBytes(4).toString('hex')}`,
    password: randomBytes(10).toString('base64url').slice(0, 14),
  };
}

export async function createReviewer(db, credentials) {
  if (
    !/^review_[a-f0-9]{8}$/.test(credentials.account) ||
    typeof credentials.password !== 'string' ||
    credentials.password.length !== 14
  )
    throw new Error('评审账号参数不正确');
  // 只创建独立普通学习账号；不覆盖已有账户、权限、课程或历史记录。
  const [result] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash,role,status) VALUES(?,'教师评审体验','高一',?,'student','active')",
    [credentials.account, await bcrypt.hash(credentials.password, 12)],
  );
  return result.insertId;
}
