import 'dotenv/config';
import mysql from 'mysql2/promise';
import express from 'express';
import assert from 'node:assert/strict';
import {
  ensureChapterCorrections,
  registerChapterCorrections,
  applyChapterCorrections,
} from './chapter-corrections.js';
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid, server;
try {
  await ensureChapterCorrections(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'修正测试','test','disabled-test-login')",
    ['correction_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'测试')", [uid]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')", [
    c.insertId,
  ]);
  const [ch2] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'第二章')",
    [c.insertId],
  );
  const [m] = await db.execute(
    "INSERT INTO course_materials(course_id,original_name,stored_name,mime_type,size_bytes,extracted_text) VALUES(?,'原资料.pdf','correction-no-file.pdf','application/pdf',1,'原始文本')",
    [c.insertId],
  );
  const app = express();
  app.use(express.json());
  registerChapterCorrections(
    app,
    db,
    (req, res, next) => {
      req.user = { sub: req.headers.foreign ? uid + 100000 : uid };
      next();
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
    async () => '矩阵 □ − □ X = □ □',
  );
  app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/courses/${c.insertId}/chapters/${ch.insertId}/materials/${m.insertId}/correction`;
  const call = async (body, foreign = false, action = '') => {
    const r = await fetch(base + (action ? '/' + action : ''), {
      method: action ? 'POST' : body ? 'PUT' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(foreign ? { foreign: '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await call()).data.version, 0);
  assert.equal((await call(null, true)).status, 404);
  assert.equal((await call({ content: '矩阵 □ − □ X = □ □', version: 0 })).status, 422);
  assert.equal((await call({ content: '矩阵 [[1,2],[3,4]]', version: 0 }, true)).status, 404);
  assert.equal((await call({ content: '矩阵 [[1,2],[3,4]]', version: 0 })).status, 200);
  assert.equal((await call()).data.content, '矩阵 [[1,2],[3,4]]');
  assert.equal((await call({ content: '覆盖旧版本', version: 0 })).status, 409);
  const raw = [
    { materialId: m.insertId, name: '原资料.pdf', content: '破损一' },
    { materialId: m.insertId, name: '原资料.pdf', content: '破损二' },
  ];
  const corrected = await applyChapterCorrections(db, c.insertId, ch.insertId, raw);
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].content, '矩阵 [[1,2],[3,4]]');
  assert.equal(corrected[0].corrected, true);
  assert.equal(raw[0].content, '破损一');
  assert.deepEqual(await applyChapterCorrections(db, c.insertId, ch2.insertId, raw), raw);
  assert.equal((await applyChapterCorrections(db, c.insertId, ch.insertId, [])).length, 1);
  const race = await Promise.all([
    call({ content: '修正一', version: 1 }),
    call({ content: '修正二', version: 1 }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const winner = (await call()).data.content;
  assert.equal((await call()).data.corrected, true);
  assert.equal((await call()).data.hasPrevious, true);
  assert.equal((await call({ version: 2 }, true, 'restore')).status, 404);
  assert.equal((await call({ version: 1 }, false, 'restore')).status, 409);
  assert.equal((await call({ version: 2 }, false, 'restore')).status, 200);
  const original = (await call()).data;
  assert.equal(original.version, 3);
  assert.equal(original.corrected, false);
  assert.equal(original.hasPrevious, true);
  assert.match(original.content, /□/);
  assert.deepEqual(await applyChapterCorrections(db, c.insertId, ch.insertId, raw), raw);
  assert.equal((await call({ version: 3 }, false, 'undo')).status, 200);
  assert.equal((await call()).data.content, winner);
  assert.equal((await call()).data.corrected, true);
  assert.equal((await call({ content: '新版修正', version: 4 })).status, 200);
  assert.equal((await call({ version: 5 }, false, 'undo')).status, 200);
  assert.equal((await call()).data.content, winner);
  assert.equal((await call({ version: 5 }, false, 'restore')).status, 409);
  const [[material]] = await db.execute('SELECT extracted_text FROM course_materials WHERE id=?', [
    m.insertId,
  ]);
  assert.equal(material.extracted_text, '原始文本');
  await db.execute('DELETE FROM course_materials WHERE id=?', [m.insertId]);
  const [[count]] = await db.execute(
    'SELECT COUNT(*) n FROM chapter_source_corrections WHERE chapter_id=?',
    [ch.insertId],
  );
  assert.equal(Number(count.n), 0);
  console.log(
    'PASS corrections: persistence, ownership, damaged formula rejection, stale/concurrent edits, duplicate source replacement, chapter isolation, original unchanged, restore and undo with monotonic versions, cascade cleanup',
  );
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
