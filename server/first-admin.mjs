import bcrypt from 'bcryptjs';

export async function createFirstAdmin(connection, { account, password, nickname = '管理员' }) {
  if (typeof account !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(account))
    throw new Error('管理员账号须为 3—64 位字母、数字或下划线');
  if (typeof password !== 'string' || password.length < 8 || password.length > 64)
    throw new Error('管理员密码须为 8—64 位');
  if (typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 32)
    throw new Error('管理员昵称须为 1—32 个字');

  // 同一数据库的初始化进程串行执行，避免同时创建多个首位管理员。
  const lockName = 'shuyoufang:first-admin';
  const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
  if (Number(lock.acquired) !== 1) throw new Error('其他初始化正在运行，请稍后重试');
  let transaction = false;
  try {
    await connection.beginTransaction();
    transaction = true;
    const [admins] = await connection.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (admins.length) throw new Error('数据库已有管理员，本命令不会新增、覆盖或重置账号');
    const [accounts] = await connection.execute('SELECT id FROM users WHERE account=? LIMIT 1', [
      account,
    ]);
    if (accounts.length) throw new Error('此账号已被使用，请选择其他账号');
    const [result] = await connection.execute(
      "INSERT INTO users(account,nickname,grade,password_hash,role,status) VALUES(?,?,'',?,'admin','active')",
      [account, nickname.trim(), await bcrypt.hash(password, 12)],
    );
    await connection.commit();
    transaction = false;
    return result.insertId;
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}
