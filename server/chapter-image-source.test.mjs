import test from 'node:test';
import assert from 'node:assert/strict';
import { createChapterImageSource, canReadChapterImages } from './chapter-image-source.js';

const material = { id: 7, stored_name: 'book.pdf', original_name: '课本.pdf' };
const chapter = {
  source_regions_json: JSON.stringify([
    { materialId: 7, startPage: 3, endPage: 7 },
    { materialId: 7, startPage: 6, endPage: 7 },
  ]),
};
test('图片读取只使用当前章节所有映射页，分批不漏页、不重复、不使用整本课本', async () => {
  const rendered = [],
    batches = [];
  const read = createChapterImageSource({
    uploadRoot: 'unused',
    previewRoot: 'unused',
    renderPage: async (m, page) => {
      assert.equal(m.id, 7);
      rendered.push(page);
      return String(page);
    },
    readFile: async () => Buffer.from('image'),
  });
  const result = await read(chapter, [material], undefined, [], undefined, async (messages) => {
    const content = messages.at(-1).content;
    const pages = content
      .filter((item) => item.type === 'text' && item.text.startsWith('【'))
      .map((item) => Number(item.text.match(/第 (\d+) 页/)[1]));
    batches.push(pages);
    assert.ok(pages.length <= 2);
    assert.equal(content.filter((item) => item.type === 'image_url').length, pages.length);
    return JSON.stringify({
      pages: pages.map((page) => ({ page, readable: true, text: `第${page}页的原文` })),
    });
  });
  assert.deepEqual(rendered, [3, 4, 5, 6, 7]);
  assert.deepEqual(batches, [[3, 4], [5, 6], [7]]);
  assert.match(result[0].content, /第7页的原文/);
  assert.doesNotMatch(result[0].content, /第2页/);
});
test('读不清的页面拒绝猜测，返回原页编号', async () => {
  const read = createChapterImageSource({
    uploadRoot: 'unused',
    previewRoot: 'unused',
    renderPage: async () => '',
    readFile: async () => Buffer.from('image'),
  });
  await assert.rejects(
    read(
      { source_regions_json: [{ materialId: 7, startPage: 4, endPage: 4 }] },
      [material],
      undefined,
      [],
      undefined,
      async () => JSON.stringify({ pages: [{ page: 4, readable: false, text: '' }] }),
    ),
    (error) => error.code === 'PAGE_IMAGE_UNREADABLE' && /第 4 页/.test(error.message),
  );
});
test('禁止引用不属于当前课程的文件、跨目录文件和错误页码', async () => {
  let called = 0;
  const read = createChapterImageSource({
    uploadRoot: 'unused',
    previewRoot: 'unused',
    renderPage: async () => {
      called++;
      return '';
    },
    readFile: async () => Buffer.from('image'),
  });
  await assert.rejects(read(chapter, [], undefined), /不存在/);
  await assert.rejects(read(chapter, [{ ...material, stored_name: '../other.pdf' }]), /不存在/);
  await assert.rejects(
    read({ ...chapter, source_regions_json: [{ materialId: 7, startPage: 8, endPage: 4 }] }, [
      material,
    ]),
    /范围无效/,
  );
  assert.equal(called, 0);
});
test('人工修正正文优先，不额外调用图片模型；取消和鉴权不进入OCR补救', async () => {
  const read = createChapterImageSource({
    uploadRoot: 'unused',
    previewRoot: 'unused',
    renderPage: async () => {
      throw Error('不应渲染');
    },
  });
  const corrected = { materialId: 7, corrected: true, content: '人工修正的正文' };
  assert.deepEqual(await read(chapter, [material], undefined, [corrected]), [corrected]);
  assert.equal(
    canReadChapterImages(Object.assign(new Error('OCR 识别置信度过低'), { status: 422 })),
    true,
  );
  assert.equal(
    canReadChapterImages(Object.assign(new Error('OCR 请求鉴权失败'), { status: 401 })),
    false,
  );
  assert.equal(
    canReadChapterImages(Object.assign(new Error('章节原页范围无效'), { status: 422 })),
    false,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(read(chapter, [material], controller.signal), { name: 'AbortError' });
});
