import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPdfOcrReader, needsOcr } from './pdf-ocr.js';
import { recognizePdfImages } from './pdf-ocr-worker.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chapter-ocr-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'book.pdf');
  await fs.writeFile(filename, 'test-source');
  return { root, filename, cacheRoot: path.join(root, 'cache') };
}
const good = '这是本章完整而且可以读取的原生文字，不应交给OCR重复识别。';

test('按页检测扫描和损坏文字，正常文字不识别，OCR缓存随源文件内容失效', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const read = createPdfOcrReader({
    ...f,
    readPdfText: async () => [
      { page: 1, text: good },
      { page: 2, text: '' },
      { page: 3, text: '公式\ufffd' },
    ],
    renderPage: async (_m, p) => String(p),
    recognize: async (images, { onPage }) => {
      calls++;
      assert.deepEqual(
        images.map((i) => i.page),
        [2, 3],
      );
      for (const image of images)
        await onPage({ page: image.page, text: '识别的本章原文', confidence: 90 });
    },
  });
  const text = await read(f.filename, { pageNumbers: [1, 2, 3] });
  assert.match(text, /原生文字/);
  assert.match(text, /识别的本章/);
  await read(f.filename, { pageNumbers: [1, 2, 3] });
  assert.equal(calls, 1);
  await fs.writeFile(f.filename, 'source-replaced');
  await read(f.filename, { pageNumbers: [1, 2, 3] });
  assert.equal(calls, 2);
  assert.equal(needsOcr(good), false);
  assert.equal(needsOcr('�'), true);
});
test('失败只补缺失页，低置信度、漏页和重复返回不会保存为有效文字', async (t) => {
  const f = await fixture(t);
  let attempt = 0;
  const read = createPdfOcrReader({
    ...f,
    readPdfText: async () => [
      { page: 1, text: '' },
      { page: 2, text: '' },
    ],
    renderPage: async (_m, p) => String(p),
    recognize: async (images, { onPage }) => {
      attempt++;
      if (attempt === 1) {
        await onPage({ page: 1, text: '第一页识别', confidence: 95 });
        throw new Error('第二页失败');
      }
      assert.deepEqual(
        images.map((i) => i.page),
        [2],
      );
      await onPage({ page: 2, text: '第二页识别', confidence: 95 });
    },
  });
  await assert.rejects(read(f.filename), /第二页失败/);
  assert.match(await read(f.filename), /第二页识别/);
  const badRoot = path.join(f.root, 'bad');
  const bad = createPdfOcrReader({
    ...f,
    cacheRoot: badRoot,
    readPdfText: async () => [{ page: 1, text: '' }],
    renderPage: async () => '',
    recognize: async (_images, { onPage }) => onPage({ page: 1, text: '猜测内容', confidence: 5 }),
  });
  await assert.rejects(bad(f.filename), /置信度/);
  const missing = createPdfOcrReader({
    ...f,
    cacheRoot: path.join(f.root, 'missing'),
    readPdfText: async () => [{ page: 1, text: '' }],
    renderPage: async () => '',
    recognize: async () => {},
  });
  await assert.rejects(missing(f.filename), /遗漏/);
});
test('等待中的OCR可以取消且不打断其他任务，空白页不能伪装成正文', async (t) => {
  const f = await fixture(t);
  let unblock, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const read = createPdfOcrReader({
    ...f,
    readPdfText: async () => [{ page: 1, text: '' }],
    renderPage: async () => '',
    recognize: async (_images, { onPage }) => {
      started();
      await gate;
      await onPage({ page: 1, text: '', confidence: 0 });
    },
  });
  const first = read(f.filename);
  await ready;
  const controller = new AbortController();
  const second = read(f.filename, { signal: controller.signal });
  controller.abort();
  await assert.rejects(second, { name: 'AbortError' });
  unblock();
  assert.equal(await first, '');
  assert.equal(await read(f.filename), '');
  await assert.rejects(
    recognizePdfImages([], { langPath: path.join(f.root, 'absent') }),
    /语言包缺失/,
  );
});
