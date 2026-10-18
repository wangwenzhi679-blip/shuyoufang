import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { ZipArchive } from 'archiver';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || 'storage/course-materials');
const previewRoot = path.resolve(process.env.PREVIEW_DIR || 'storage/course-previews');
let userId, courseId;
const cleanup = [];
const request = async (url, token, body, method = 'GET') => {
  const response = await fetch('http://127.0.0.1:8005' + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('json')
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
  };
};
const form = (entries) => {
  const body = new FormData();
  for (const [name, content, type] of entries)
    body.append('files', new Blob([content], { type }), name);
  return body;
};
const directoryNames = () => fs.readdirSync(uploadRoot).sort();

let adminForeignId;
try {
  const [adminForeign] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'隔离验证','test','disabled-test-login')",
    ['foreign_material-upload_' + Date.now()],
  );
  adminForeignId = adminForeign.insertId;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Chapter 1 - Source document', { x: 50, y: 780, size: 18, font });
  page.drawText('1. Calculate the determinant of the matrix below.', {
    x: 50,
    y: 740,
    size: 12,
    font,
  });
  page.drawText('2    1    -1', { x: 100, y: 700, size: 16, font });
  page.drawText('3   -1     2', { x: 100, y: 670, size: 16, font });
  page.drawLine({ start: { x: 90, y: 715 }, end: { x: 90, y: 660 }, thickness: 1 });
  page.drawLine({ start: { x: 200, y: 715 }, end: { x: 200, y: 660 }, thickness: 1 });
  page.drawText('2. Select an answer: A. True   B. False', { x: 50, y: 620, size: 12, font });
  const pdfBytes = Buffer.from(await pdf.save());
  const zip = new ZipArchive({ zlib: { level: 6 } }),
    chunks = [];
  const zipDone = new Promise((resolve, reject) => {
    zip.on('data', (chunk) => chunks.push(chunk));
    zip.on('end', resolve);
    zip.on('error', reject);
  });
  zip.append(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    { name: '[Content_Types].xml' },
  );
  zip.append(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    { name: '_rels/.rels' },
  );
  const paragraphs = [
    '第一章 学习资料',
    '1. 第一题：请选择正确答案。',
    'A. 第一选项',
    'B. 第二选项',
    '2. 第二题：判断下列说法。',
    '每道题保留独立段落。',
  ];
  zip.append(
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((text) => '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>').join('') +
      '</w:body></w:document>',
    { name: 'word/document.xml' },
  );
  await zip.finalize();
  await zipDone;
  const docxBytes = Buffer.concat(chunks);
  const [user] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'导入验收','test','disabled-test-login')",
    ['uploadqa_' + Date.now()],
  );
  userId = user.insertId;
  const [course] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'资料导入验收')", [
    userId,
  ]);
  courseId = course.insertId;
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const foreign = jwt.sign({ sub: adminForeignId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const before = directoryNames();
  assert.equal(
    (
      await request(
        `/api/courses/${courseId}/materials`,
        foreign,
        form([['权限测试.pdf', pdfBytes, 'application/pdf']]),
        'POST',
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/api/courses/0/materials',
        token,
        form([['参数测试.pdf', pdfBytes, 'application/pdf']]),
        'POST',
      )
    ).status,
    400,
  );
  assert.deepEqual(directoryNames(), before, '无权访问或无效课程不能先写入资料文件');
  const result = await request(
    `/api/courses/${courseId}/materials`,
    token,
    form([
      ['原始矩阵.pdf', pdfBytes, 'application/pdf'],
      [
        '中文资料.docx',
        docxBytes,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    ]),
    'POST',
  );
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.deepEqual(
    result.data.materials.map((m) => m.original_name),
    ['原始矩阵.pdf', '中文资料.docx'],
  );
  const [materials] = await db.execute(
    'SELECT id,original_name,stored_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY id',
    [courseId],
  );
  for (const material of materials) cleanup.push([uploadRoot, material.stored_name]);
  assert.ok(materials[1].extracted_text.includes('第一题'));
  assert.ok(materials[1].extracted_text.includes('第二题'));
  const original = await request(
    `/api/courses/${courseId}/materials/${materials[0].id}/preview`,
    token,
  );
  assert.equal(original.status, 200);
  assert.deepEqual(original.data, pdfBytes, 'PDF 预览必须保留原始文件字节');
  cleanup.push([previewRoot, `original-${materials[0].id}-1.png`]);
  const image = await request(
    `/api/courses/${courseId}/materials/${materials[0].id}/pages/1`,
    token,
  );
  assert.equal(image.status, 200, JSON.stringify(image.data));
  assert.deepEqual([...image.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const pageQaRoot = path.resolve('../docs/qa');
  fs.mkdirSync(pageQaRoot, { recursive: true });
  fs.writeFileSync(path.join(pageQaRoot, 'material-matrix-page-verified.png'), image.data);
  const word = await request(
    `/api/courses/${courseId}/materials/${materials[1].id}/preview`,
    token,
  );
  assert.equal(word.status, 200, JSON.stringify(word.data));
  assert.equal(word.data.subarray(0, 4).toString(), '%PDF');
  assert.ok((await PDFDocument.load(word.data)).getPageCount() > 0);
  const [[preview]] = await db.execute('SELECT preview_name FROM course_materials WHERE id=?', [
    materials[1].id,
  ]);
  if (preview.preview_name) cleanup.push([previewRoot, preview.preview_name]);
  const qaRoot = path.resolve('../docs/qa');
  fs.mkdirSync(qaRoot, { recursive: true });
  fs.writeFileSync(path.join(qaRoot, 'material-word-preview-verified.pdf'), word.data);
  const savedNames = directoryNames();
  const failed = await request(
    `/api/courses/${courseId}/materials`,
    token,
    form([
      ['有效资料.pdf', pdfBytes, 'application/pdf'],
      [
        '损坏资料.docx',
        Buffer.from('not a document'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    ]),
    'POST',
  );
  assert.ok(failed.status >= 400, '损坏批次应明确返回失败');
  assert.deepEqual(directoryNames(), savedNames, '解析失败必须清理整批文件');
  const [[count]] = await db.execute('SELECT COUNT(*) n FROM course_materials WHERE course_id=?', [
    courseId,
  ]);
  assert.equal(Number(count.n), 2);
  const [chapter] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'笔记导出验收')",
    [courseId],
  );
  assert.equal(
    (
      await request(
        `/api/courses/${courseId}/chapters/${chapter.insertId}/note`,
        token,
        { body: '第一段：本章学习重点。\n\n第二段：保留中文与段落。', version: 0 },
        'PUT',
      )
    ).status,
    200,
  );
  const notes = await request(`/api/courses/${courseId}/notes/export?format=pdf`, token);
  assert.equal(notes.status, 200, JSON.stringify(notes.data));
  assert.equal(notes.data.subarray(0, 4).toString(), '%PDF');
  fs.writeFileSync(path.join(qaRoot, 'note-export-verified.pdf'), notes.data);
  console.log(
    'PASS live upload: ownership before disk write, Chinese names, PDF byte fidelity, Word preview, failed-batch cleanup, notes PDF',
  );
} finally {
  if (adminForeignId) await db.execute('DELETE FROM users WHERE id=?', [adminForeignId]);
  if (courseId) {
    const [rows] = await db.execute(
      'SELECT stored_name,preview_name FROM course_materials WHERE course_id=?',
      [courseId],
    );
    for (const row of rows) {
      cleanup.push([uploadRoot, row.stored_name]);
      if (row.preview_name) cleanup.push([previewRoot, row.preview_name]);
    }
  }
  if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
  for (const [root, name] of cleanup) {
    const file = path.resolve(root, name);
    if (path.dirname(file) !== root) throw new Error('测试清理路径越界');
    fs.rmSync(file, { force: true });
  }
  await db.end();
}
