import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import assert from 'node:assert/strict';
import { ensureReading, registerReading } from './reading.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let userId, server;
try {
  await ensureReading(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'阅读测试','test','disabled-test-login')",
    [`read_${Date.now()}`],
  );
  userId = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'阅读测试课程')", [
    userId,
  ]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')", [
    c.insertId,
  ]);
  const [ch2] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'第二章')",
    [c.insertId],
  );
  const app = express();
  app.use(express.json());
  registerReading(
    app,
    db,
    (req, res, next) => {
      req.user = { sub: req.headers.foreign ? userId + 100000 : userId };
      next();
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    async () => ({ pages: 2 }),
    async () => '',
  );
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}/api/`;
  const call = async (path, body, method = 'POST', foreign = false) => {
    const r = await fetch(origin + path, {
      method: body ? method : 'GET',
      headers: { 'Content-Type': 'application/json', ...(foreign ? { foreign: '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const path = `courses/${c.insertId}/chapters/${ch.insertId}/reading`,
    pos = { anchor: 'a1', index: 2, offset: 0.4, progress: 42 };
  assert.equal((await call(path)).data.version, 0);
  const saved = await call(path, { position: pos, version: 0 }, 'PUT');
  assert.equal(saved.status, 200);
  assert.equal((await call(path)).data.position.offset, 0.4);
  assert.equal((await call(path)).data.position.progress, 42);
  assert.equal(
    (await call(path, { position: { ...pos, progress: 100 }, version: 1 }, 'PUT')).status,
    400,
  );
  assert.equal((await call(path, { position: pos, version: 0 }, 'PUT')).status, 409);
  assert.equal((await call(path, undefined, 'GET', true)).status, 404);
  assert.equal(
    (await call(`courses/${c.insertId}/chapters/${ch2.insertId}/reading`)).data.version,
    0,
  );
  assert.equal((await call(path + '?materialId=999999')).status, 404);
  const bookmark = await call(path + '/bookmarks', { name: '重点', position: pos });
  assert.equal(bookmark.status, 200);
  assert.equal(
    (await call(`reading-bookmarks/${bookmark.data.id}`, { name: '已改名' }, 'PUT')).status,
    200,
  );
  assert.equal((await call(path)).data.bookmarks[0].name, '已改名');
  assert.equal(
    (await call(`reading-bookmarks/${bookmark.data.id}`, {}, 'DELETE', true)).status,
    404,
  );
  assert.equal((await call(`reading-bookmarks/${bookmark.data.id}`, {}, 'DELETE')).status, 200);
  assert.equal((await call(path)).data.bookmarks.length, 0);
  const race = await Promise.all([
    call(path, { position: { ...pos, index: 3 }, version: 1 }, 'PUT'),
    call(path, { position: { ...pos, index: 4 }, version: 1 }, 'PUT'),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await call(path, { position: { ...pos, offset: 2 }, version: 2 }, 'PUT')).status,
    400,
  );
  const [m] = await db.execute(
    "INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text) VALUES(?,'测试.pdf','test-no-file.pdf','application/pdf',1,'测试')",
    [c.insertId],
  );
  const mp = path + `?materialId=${m.insertId}`;
  const pp = { page: 2, offset: 0, index: 0, anchor: '' };
  assert.equal((await call(mp, { position: pp, version: 0 }, 'PUT')).status, 200);
  assert.equal((await call(mp)).data.position.page, 2);
  assert.equal((await call(path)).data.latestMaterialId, m.insertId);
  const mb = await call(path + `/bookmarks?materialId=${m.insertId}`, {
    name: 'PDF书签',
    position: pp,
  });
  assert.equal((await call(path)).data.bookmarks[0].unavailable, false);
  await db.execute('DELETE FROM course_materials WHERE id=?', [m.insertId]);
  assert.equal((await call(mp)).status, 404);
  assert.equal((await call(path)).data.bookmarks[0].unavailable, true);
  assert.equal((await call(`reading-bookmarks/${mb.data.id}`, {}, 'DELETE')).status, 200);
  console.log(
    'PASS: reading persistence, chapter isolation, account ownership, invalid material, bookmark rename/delete, stale and concurrent updates, position validation',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  await db.end();
}
