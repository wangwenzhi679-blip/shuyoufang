import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractPdfText } from './pdf-text-worker.mjs';

test('轻量 PDF 提取保留首尾全部页文字，解析期间主线程仍可响应', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-text-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 25; i++)
    pdf.addPage([600, 800]).drawText(`PageAnchor${i}End`, { x: 50, y: 700, font });
  const file = path.join(root, 'test.pdf');
  await fs.writeFile(file, await pdf.save());
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  let text;
  try {
    text = await extractPdfText(file);
  } finally {
    clearInterval(timer);
  }
  for (let i = 1; i <= 25; i++) assert.ok(text.includes(`PageAnchor${i}End`));
  assert.ok(ticks > 0);
});

test('PDF 提取能立即取消，损坏的文件不能当作空白导入成功', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-text-abort-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'broken.pdf');
  await fs.writeFile(file, 'broken PDF');
  await assert.rejects(extractPdfText(file), /PDF 文件结构无效或已损坏/);
  await assert.rejects(extractPdfText(path.join(root, 'missing.pdf')), /原 PDF 文件不存在/);
  const controller = new AbortController();
  const parsing = extractPdfText(file, { signal: controller.signal });
  controller.abort(new Error('test cancellation'));
  await assert.rejects(parsing, /test cancellation/);
});
