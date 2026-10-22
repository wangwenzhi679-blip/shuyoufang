import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { reviewerCredentials, createReviewer } from './review-account.mjs';

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) });
const output = fileURLToPath(new URL('../startup-logs/评审体验账号-公网.txt', import.meta.url));
let created = false,
  reserved = false;
let db;
const credentials = reviewerCredentials();
const instruction = (status) => `数有方教师评审测试说明（私密，请勿提交公开仓库）
网站：https://shuyoufang.asia/
账号：${credentials.account}
密码：${credentials.password}
验证状态：${status}

使用账号密码登录，无需邮箱验证码。该账号是普通学习账号，没有管理权限。
Windows 1.0.2 默认连接同一网站，使用同一账号密码即可。
新账号初始没有课程；旧本机测试课程尚未迁移，不应在交付中宣称已提供。
建议验收：导入资料、章节阅读、学习助手、练习、错题批注与学习心得。
不要向老师提供管理员账号。评审结束后可在管理端停用此账号。
`;

try {
  if (!process.env.MYSQL_USER || !process.env.MYSQL_DATABASE)
    throw new Error('请先配置 server/.env');
  await mkdir(fileURLToPath(new URL('../startup-logs/', import.meta.url)), { recursive: true });
  // 拒绝覆盖已有交付凭据；重复运行不会静默创建另一份账号。
  await writeFile(output, instruction('尚未创建，不能交付'), { flag: 'wx', mode: 0o600 });
  reserved = true;
  db = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  await createReviewer(db, credentials);
  created = true;
  await writeFile(output, instruction('已创建，登录验证待完成'), { mode: 0o600 });
  const port = Number(process.env.PORT || 8005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('后端端口不正确');
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  const data = await response.json();
  if (
    !response.ok ||
    data.user?.account !== credentials.account ||
    data.user?.role !== 'student' ||
    !data.token
  )
    throw new Error('登录验证未通过');
  await writeFile(
    output,
    instruction('已通过部署服务器上的账号密码登录验证；公网浏览器体验仍需验收'),
    { mode: 0o600 },
  );
  console.log('评审账号创建及登录验证成功。');
  console.log(`账号密码和测试说明已单独保存：${output}`);
  console.log('请勿将该文件上传公开仓库，也无需把密码发送到聊天。');
} catch (error) {
  if (reserved && !created) await unlink(output).catch(() => {});
  console.error(
    error.code === 'EEXIST'
      ? '已有公网评审账号说明，未创建或重置任何账号。请先检查 startup-logs/评审体验账号-公网.txt。'
      : created
        ? `账号已创建，登录验证未完成。请先检查网站服务；凭据保存在 ${output}，暂勿交付。`
        : `未创建账号，请检查数据库配置和权限（${error.code || 'INVALID_CONFIG'}）。`,
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
