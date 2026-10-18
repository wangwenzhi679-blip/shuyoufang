import 'dotenv/config';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { registerNoteEnhancements } from './note-enhancements.js';
import {
  textDocument,
  appendExcerpt,
  replaceOrdinaryText,
  documentMarkdown,
  normalizeDocument,
} from '../shared/note-document.mjs';
const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let userId;
let adminForeignId;
try {
  const [adminForeign] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'隔离验证','test','disabled-test-login')",
    ['foreign_note-enhancements_' + Date.now()],
  );
  adminForeignId = adminForeign.insertId;
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'增强测试','test','disabled-test-login')",
    [`note_enh_${Date.now()}`],
  );
  userId = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'笔记增强测试')", [
    userId,
  ]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')", [
    c.insertId,
  ]);
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '5m' }),
    base = `http://127.0.0.1:8005/api/courses/${c.insertId}/chapters/${ch.insertId}/note`;
  const request = async (url, body, method = 'PUT', access = token) => {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      response,
      data: response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : await response.arrayBuffer(),
    };
  };
  const image = new FormData();
  image.append(
    'image',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      { type: 'image/png' },
    ),
    '测试.png',
  );
  const uploaded = await request(base + '/images', image, 'POST');
  assert.equal(uploaded.status, 200);
  const id = uploaded.data.attachment.id;
  let doc = textDocument('第一段\n\n第二段');
  doc.content[0].attrs = { important: true, noteId: 'first' };
  doc.content.push({ type: 'image', attrs: { attachmentId: id, alt: '测试图片', width: 75 } });
  doc = appendExcerpt(doc, '资料摘录', {
    name: '原资料.pdf',
    materialId: null,
    page: 2,
    fingerprint: 'test-source',
  });
  assert.throws(() => appendExcerpt(doc, '资料摘录', { fingerprint: 'test-source' }));
  const saved = await request(base, { document: doc, version: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.note.document.content[0].attrs.important, true);
  const replaced = replaceOrdinaryText(saved.data.note.document, 'AI 整理后的文字');
  assert.ok(JSON.stringify(replaced).includes('测试图片'));
  assert.ok(JSON.stringify(replaced).includes('原资料.pdf'));
  assert.ok(JSON.stringify(replaced).includes('第一段'));
  assert.equal(
    (await request(base, { document: replaced, version: 1, snapshot: true })).status,
    200,
  );
  const restored = await request(base + '/restore', { version: 2 }, 'POST');
  assert.equal(restored.status, 200);
  assert.equal(restored.data.note.body, saved.data.note.body);
  assert.equal((await request(base + '/restore', { version: 2 }, 'POST')).status, 409);
  const foreign = jwt.sign({ sub: adminForeignId }, process.env.JWT_SECRET);
  assert.equal(
    (await request(`http://127.0.0.1:8005/api/notes/images/${id}`, null, 'GET', foreign)).status,
    404,
  );
  const zip = await request(
    `http://127.0.0.1:8005/api/courses/${c.insertId}/notes/export?format=md`,
    null,
    'GET',
  );
  assert.equal(zip.status, 200);
  assert.equal(Buffer.from(zip.data).subarray(0, 2).toString(), 'PK');
  const pdf = await request(
    `http://127.0.0.1:8005/api/courses/${c.insertId}/notes/export?format=pdf`,
    null,
    'GET',
  );
  assert.equal(pdf.status, 200, JSON.stringify(pdf.data));
  assert.equal(Buffer.from(pdf.data).subarray(0, 4).toString(), '%PDF');
  assert.ok(documentMarkdown(doc, () => 'images/test.png').includes('images/test.png'));
  assert.throws(() => normalizeDocument({ type: 'doc', content: [{ type: 'script' }] }));
  assert.throws(() =>
    normalizeDocument({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://evil.test' } }],
    }),
  );
  let sourceText = '本章资料：学习概念与重点';
  let aiInput;
  const app = express();
  app.use(express.json());
  registerNoteEnhancements(
    app,
    db,
    (req, res, next) => {
      req.user = { sub: userId };
      next();
    },
    (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    async (messages) => {
      aiInput = messages;
      return '整理完成：保留原意。';
    },
    async () => sourceText,
  );
  const local = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => local.once('listening', resolve));
  try {
    const origin = `http://127.0.0.1:${local.address().port}`;
    const response = await request(
      `${origin}/api/courses/${c.insertId}/chapters/${ch.insertId}/note/organize`,
      { text: '测试笔记', version: 3, requirements: '精简' },
      'POST',
    );
    assert.equal(response.status, 202);
    let jobs = [];
    for (let i = 0; i < 20; i++) {
      jobs = (await request(`${origin}/api/notes/jobs`, null, 'GET')).data.jobs;
      if (jobs[0]?.status === 'done') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(jobs[0].result_text, '整理完成：保留原意。');
    assert.equal((await request(base, null, 'GET')).data.note.version, 3);
    const generated = await request(
      `${origin}/api/courses/${c.insertId}/chapters/${ch.insertId}/note/generate`,
      { version: 3, requirements: '重点笔记', text: '不应采用的客户端资料' },
      'POST',
    );
    assert.equal(generated.status, 202);
    for (let i = 0; i < 20; i++) {
      jobs = (await request(`${origin}/api/notes/jobs`, null, 'GET')).data.jobs;
      if (jobs[0]?.status === 'done') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(jobs[0].input_json.mode, 'generate');
    assert.ok(aiInput[1].content.includes(sourceText));
    assert.ok(!aiInput[1].content.includes('不应采用的客户端资料'));
    assert.equal((await request(base, null, 'GET')).data.note.version, 3);
    sourceText = '';
    assert.equal(
      (
        await request(
          `${origin}/api/courses/${c.insertId}/chapters/${ch.insertId}/note/generate`,
          { version: 3 },
          'POST',
        )
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => local.close(resolve));
  }
  console.log(
    'PASS: rich document, authenticated image upload, excerpt deduplication, protected replacement, restore conflict, export ZIP and sanitization',
  );
} finally {
  if (adminForeignId) await db.execute('DELETE FROM users WHERE id=?', [adminForeignId]);
  if (userId) {
    const [images] = await db.execute('SELECT stored_name FROM note_attachments WHERE user_id=?', [
      userId,
    ]);
    await db.execute('DELETE FROM users WHERE id=?', [userId]);
    const imageRoot = path.resolve('storage/note-images');
    for (const image of images) {
      const file = path.resolve(imageRoot, image.stored_name);
      if (path.dirname(file) !== imageRoot) throw new Error('测试清理路径越界');
      fs.rmSync(file, { force: true });
    }
  }
  await db.end();
}
