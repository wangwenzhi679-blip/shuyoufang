import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createFirstAdmin } from './first-admin.mjs';

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) });

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('请在交互终端中运行 npm run init:admin');
  if (!process.env.MYSQL_DATABASE || !process.env.MYSQL_USER)
    throw new Error('请先填写 server/.env 中的数据库配置并导入 database/schema.sql');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  let prompt;
  let muted = false;
  try {
    const [admins] = await connection.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (admins.length) throw new Error('数据库已有管理员，本命令不会新增、覆盖或重置账号');
    console.log(`即将在数据库 ${process.env.MYSQL_DATABASE} 创建首位管理员。`);
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    prompt = createInterface({ input: process.stdin, output, terminal: true });
    const hiddenQuestion = async (label) => {
      const answer = prompt.question(label);
      muted = true;
      try {
        return await answer;
      } finally {
        muted = false;
        process.stdout.write('\n');
      }
    };
    const account = (await prompt.question('管理员账号：')).trim();
    const nickname = (await prompt.question('管理员昵称（回车使用“管理员”）：')).trim() || '管理员';
    const password = await hiddenQuestion('管理员密码（输入不显示）：');
    const confirmation = await hiddenQuestion('再次输入密码：');
    if (password !== confirmation) throw new Error('两次密码不一致，未创建账号');
    await createFirstAdmin(connection, { account, nickname, password });
    console.log('管理员创建成功，请启动网站后进入 /admin 登录。');
  } finally {
    muted = false;
    prompt?.close();
    await connection.end();
  }
}

main().catch((error) => {
  const known = [
    '请',
    '数据库已有',
    '其他初始化',
    '管理员账号',
    '管理员密码',
    '管理员昵称',
    '此账号',
    '两次密码',
    '即将',
  ].some((prefix) => error.message?.startsWith(prefix));
  console.error(
    known
      ? error.message
      : `初始化失败（${error.code || 'UNKNOWN'}），请检查数据库连接、表结构与权限。`,
  );
  process.exitCode = 1;
});
