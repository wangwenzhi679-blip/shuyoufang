import 'dotenv/config';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { saveMaterials } from './material-import.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
try {
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'导入测试','test','disabled')",
    ['upload_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'导入事务测试')", [
    uid,
  ]);
  const files = [1, 2].map((i) => ({
    file: { filename: `qa-${i}.pdf`, mimetype: 'application/pdf', size: 12 },
    extractedText: '测试内容',
    previewName: null,
    originalName: `资料${i}.pdf`,
  }));
  const failingDb = {
    getConnection: async () => {
      const conn = await db.getConnection();
      let calls = 0;
      return {
        beginTransaction: () => conn.beginTransaction(),
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        release: () => conn.release(),
        execute: async (...args) => {
          if (++calls === 2) throw new Error('模拟第二份资料保存失败');
          return conn.execute(...args);
        },
      };
    },
  };
  await assert.rejects(saveMaterials(failingDb, c.insertId, files), /第二份资料/);
  const [[count]] = await db.execute('SELECT COUNT(*) n FROM course_materials WHERE course_id=?', [
    c.insertId,
  ]);
  assert.equal(Number(count.n), 0);
  const result = await saveMaterials(db, c.insertId, files);
  assert.equal(result.length, 2);
  const [[saved]] = await db.execute('SELECT COUNT(*) n FROM course_materials WHERE course_id=?', [
    c.insertId,
  ]);
  assert.equal(Number(saved.n), 2);
  console.log(
    'PASS materials: failed batch rolls back all rows; successful batch saves both records',
  );
} finally {
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
