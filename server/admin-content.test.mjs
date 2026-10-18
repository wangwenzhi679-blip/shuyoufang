import 'dotenv/config';
import { PDFDocument } from 'pdf-lib';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureAdminContent, createContentControl, registerAdminContent } from './admin-content.js';
test('暂停在阅读和生成生效，恢复保留资料，修复防重复且失败保留旧版', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  let uid, server;
  const dir = path.resolve('storage', 'content-test-' + Date.now());
  const logs = [];
  let release,
    broken = false;
  try {
    await ensureAdminContent(db);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'source.docx'), 'original');
    await fs.writeFile(path.join(dir, 'old.pdf'), '%PDF-old');
    const [u] = await db.execute(
      "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'处置测试','','disabled-test-login')",
      ['content_' + Date.now()],
    );
    uid = u.insertId;
    const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'处置测试课程')", [
      uid,
    ]);
    const cid = c.insertId;
    const [m] = await db.execute(
      'INSERT INTO course_materials(course_id,original_name,stored_name,size_bytes,extracted_text,preview_name) VALUES(?,?,?,?,?,?)',
      [cid, 'source.docx', 'source.docx', 8, '正文', 'old.pdf'],
    );
    const mid = m.insertId;
    const [j] = await db.execute(
      "INSERT INTO course_generation_jobs(user_id,course_id,kind,status,input_json) VALUES(?,?,'chapters','running','{}')",
      [uid, cid],
    );
    let aborted = 0;
    const app = express();
    app.use(express.json());
    app.locals.adminTasks = {
      course: {
        abort() {
          aborted++;
        },
      },
    };
    const control = createContentControl(db);
    app.use((req, res, next) => {
      req.user = { sub: uid };
      control.middleware(req, res, next);
    });
    const route = (method, p, fn) =>
      app[method]('/api/admin' + p, (req, res, next) => Promise.resolve(fn(req, res)).catch(next));
    registerAdminContent(
      route,
      app,
      db,
      async (con, actor, action, target, result, detail) => logs.push({ action, detail }),
      {
        uploadRoot: dir,
        previewRoot: dir,
        repairPreview: async (original, output) => {
          await new Promise((r) => (release = r));
          if (broken) throw Error('conversion failure');
          const pdf = await PDFDocument.create();
          pdf.addPage();
          await fs.writeFile(output, await pdf.save());
        },
      },
    );
    app.get('/api/courses/:courseId/materials/:materialId/file', (req, res) =>
      res.json({ ok: true }),
    );
    app.get('/api/courses/:courseId/chapters/1/content', (req, res) => res.json({ ok: true }));
    app.post('/api/generation-jobs', (req, res) => res.json({ ok: true }));
    app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const call = async (p, body) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    const set = (source, id, status, version) =>
      call(`/api/admin/content/${source}/${id}/status`, { status, version, reason: '测试处理' });
    assert.equal((await set('material', mid, 'paused', 0)).status, 200);
    assert.equal(aborted, 1);
    assert.equal((await call(`/api/courses/${cid}/materials/${mid}/file`)).status, 423);
    assert.equal((await call(`/api/courses/${cid}/chapters/1/content`)).status, 423);
    assert.equal(
      (await call(`/api/courses/${cid}/chapters/1/content?materialId=99999999`)).status,
      423,
    );
    assert.equal((await call(`/API/COURSES/${cid}/CHAPTERS/1/CONTENT/`)).status, 423);
    assert.equal((await call('/api/generation-jobs', { courseId: cid })).status, 423);
    assert.equal((await set('material', mid, 'active', 0)).status, 409);
    assert.equal((await set('material', mid, 'active', 1)).status, 200);
    assert.equal((await call(`/api/courses/${cid}/materials/${mid}/file`)).status, 200);
    assert.equal((await set('course', cid, 'paused', 0)).status, 200);
    assert.equal((await call(`/api/courses/${cid}/materials/${mid}/file`)).status, 423);
    assert.equal((await set('course', cid, 'active', 1)).status, 200);
    const repair = () => call(`/api/admin/materials/${mid}/repair`, { reason: '重建测试' });
    const wait = async (status) => {
      for (let i = 0; i < 100; i++) {
        const result = await call(`/api/admin/materials/${mid}/repair`);
        if (result.data.job?.status === status) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error('修复未结束');
    };
    assert.equal((await repair()).status, 202);
    assert.equal((await repair()).status, 409);
    release();
    await wait('done');
    const [[first]] = await db.execute(
      'SELECT preview_name,extracted_text FROM course_materials WHERE id=?',
      [mid],
    );
    assert.notEqual(first.preview_name, 'old.pdf');
    assert.equal(first.extracted_text, '正文');
    assert.equal(await fs.readFile(path.join(dir, 'source.docx'), 'utf8'), 'original');
    broken = true;
    assert.equal((await repair()).status, 202);
    release();
    await wait('failed');
    const [[second]] = await db.execute('SELECT preview_name FROM course_materials WHERE id=?', [
      mid,
    ]);
    assert.equal(second.preview_name, first.preview_name);
    assert.ok(logs.some((l) => l.action === 'course_pause'));
    assert.equal((await set('toString', cid, 'paused', 0)).status, 400);
  } finally {
    release?.();
    if (server) await new Promise((r) => server.close(r));
    if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
    await db.end();
    if (
      path.dirname(dir) !== path.resolve('storage') ||
      !path.basename(dir).startsWith('content-test-')
    )
      throw Error('Unexpected cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  }
});
