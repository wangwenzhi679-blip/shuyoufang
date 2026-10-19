import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  createPdfOutlineReader,
  validatePageRegions,
  regionCrop,
  renderPageRegions,
  recognizePdfRegions,
} from './pdf-outline.js';
import { registerChapterGenerationRoutes } from './chapter-generation-routes.js';
import { prepareLongContext } from './long-context.js';
import { validatePdfChapterSources } from './pdf-chapter-sources.js';
import { registerMaterialReadingRoutes } from './material-reading-routes.js';

test('困难批次自动拆成逐页识别，完整保留所有页的上下区', async () => {
  const calls = [];
  const images = [178, 179, 180].flatMap((page) =>
    ['top', 'bottom'].map((zone) => ({ page, zone, url: 'data:image/jpeg;base64,dGVzdA==' })),
  );
  const result = await recognizePdfRegions({
    images,
    pages: [178, 179, 180],
    name: 'test.pdf',
    ask: async (messages, _signal, options) => {
      const labels = messages[1].content.filter(
        (part) => part.type === 'text' && part.text.includes('原 PDF 第'),
      );
      calls.push(labels.length);
      assert.equal(options.thinking, false);
      assert.equal(options.jsonObject, true);
      if (labels.length > 2)
        throw Object.assign(new Error('output limit'), { code: 'AI_OUTPUT_LIMIT', status: 502 });
      const page = Number(labels[0].text.match(/第 (\d+) 页/)[1]);
      return JSON.stringify({ pages: [[page, '', '主题', '', '主题']] });
    },
  });
  assert.deepEqual(calls, [6, 6, 2, 2, 2]);
  assert.equal(result.length, 6);
  assert.deepEqual(
    result.map((region) => region.page),
    [178, 178, 179, 179, 180, 180],
  );
});

test('断连、超时和鉴权失败不会反复拆页重试，避免整批重复调用', async () => {
  for (const error of [
    new TypeError('fetch failed'),
    Object.assign(new Error('timeout'), { code: 'AI_TIMEOUT', status: 502 }),
    Object.assign(new Error('unauthorized'), { status: 502 }),
  ]) {
    let calls = 0;
    await assert.rejects(
      recognizePdfRegions({
        images: [],
        pages: [1, 2, 3],
        name: 'test.pdf',
        ask: async () => {
          calls++;
          throw error;
        },
      }),
      (actual) => actual === error,
    );
    assert.equal(calls, 1);
  }
});

test('模型返回后若已取消，图片识别不再当作成功结果', async () => {
  const controller = new AbortController();
  await assert.rejects(
    recognizePdfRegions({
      images: [],
      pages: [1],
      name: 'test.pdf',
      signal: controller.signal,
      ask: async () => {
        controller.abort();
        return '{"pages":[[1,"","主题","","主题"]]}';
      },
    }),
    { name: 'AbortError' },
  );
});

test('图片章节必须按原顺序覆盖全部页码，拒绝越界、遗漏和重复', () => {
  const sources = [
    { materialId: 4, pages: 3 },
    { materialId: 8, pages: 1 },
  ];
  const chapter = (materialId, startPage, endPage) => ({
    title: '章节',
    sourceRegions: [{ materialId, startPage, endPage }],
  });
  validatePdfChapterSources([chapter(4, 1, 2), chapter(4, 3, 3), chapter(8, 1, 1)], sources);
  for (const chapters of [
    [chapter(4, 1, 4)],
    [chapter(99, 1, 1)],
    [chapter(4, 3, 1)],
    [chapter(4, 1, 2), chapter(8, 1, 1)],
    [chapter(4, 1, 3), chapter(4, 3, 3), chapter(8, 1, 1)],
    [chapter(8, 1, 1), chapter(4, 1, 3)],
  ])
    assert.throws(() => validatePdfChapterSources(chapters, sources));
});

test('图片章节阅读直接返回原页映射，不再用 OCR 或标题猜测章节内容', async () => {
  const routes = {};
  registerMaterialReadingRoutes(
    {
      get: (route, ...handlers) => {
        routes[route] = handlers.at(-1);
      },
    },
    {
      auth() {},
      asyncRoute: (handler) => handler,
      parseId: (_res, id) => Number(id),
      getOwnedCourse: async () => ({ id: 1 }),
      db: {
        execute: async (sql) =>
          sql.includes('FROM course_chapters')
            ? [
                [
                  {
                    id: 9,
                    title: '新标题',
                    source_regions_json: JSON.stringify([
                      { materialId: 3, startPage: 2, endPage: 4 },
                    ]),
                  },
                ],
              ]
            : [[{ id: 3, original_name: 'test.pdf', extracted_text: '不应成为本章正文' }]],
      },
    },
  );
  const res = {
    json(value) {
      this.value = value;
    },
  };
  await routes['/api/courses/:courseId/chapters/:chapterId/content'](
    { params: { courseId: 1, chapterId: 9 }, user: { sub: 1 } },
    res,
  );
  assert.equal(res.value.contentType, 'pdf-images');
  assert.deepEqual(res.value.sections[0].originalPages, [2, 3, 4]);
  assert.equal(res.value.sections[0].content, '');
});

test('采用图片草稿保存服务端映射，不信任客户端提供的页码', async () => {
  const routes = {},
    writes = [];
  const source = [{ materialId: 7, startPage: 1, endPage: 5 }];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    execute: async (sql, args) => {
      if (sql.startsWith('SELECT id FROM courses')) return [[{ id: 1 }]];
      if (sql.startsWith('SELECT id FROM course_chapters')) return [[]];
      if (sql.includes('SELECT id,source_regions_json'))
        return [[{ id: 12, source_regions_json: source }]];
      writes.push({ sql, args });
      return [{}];
    },
  };
  registerChapterGenerationRoutes(
    {
      post: (route, ...handlers) => {
        routes[route] = handlers.at(-1);
      },
    },
    {
      auth() {},
      asyncRoute: (handler) => handler,
      parseId: (_res, id) => Number(id),
      getOwnedCourse: async () => ({ id: 1 }),
      db: { getConnection: async () => connection, execute: async () => [[]] },
    },
  );
  const res = {
    json(value) {
      this.value = value;
    },
  };
  await routes['/api/courses/:courseId/chapters/confirm-draft'](
    {
      params: { courseId: 1 },
      user: { sub: 1 },
      body: {
        chapters: [
          {
            id: 12,
            title: '已修改标题',
            sourceRegions: [{ materialId: 999, startPage: 999, endPage: 999 }],
          },
        ],
      },
    },
    res,
  );
  const insert = writes.find((item) => item.sql.startsWith('INSERT INTO course_chapters'));
  assert.deepEqual(JSON.parse(insert.args[4]), source);
});

async function fixture(t, count = 7) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shuyoufang-pdf-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) document.addPage([600, 800]);
  await fs.writeFile(path.join(root, 'test.pdf'), await document.save());
  return { root, document, materials: [{ stored_name: 'test.pdf', original_name: 'test.pdf' }] };
}

test('全部页面分为上下区，按批缓存并在模型变化后失效', async (t) => {
  const { root, materials } = await fixture(t);
  const cache = new Map();
  const db = {
    execute: async (sql, args) => {
      const key = args.slice(0, 3).join(':');
      if (sql.startsWith('SELECT'))
        return [cache.has(key) ? [{ result_text: cache.get(key) }] : []];
      cache.set(key, args[3]);
      return [{}];
    },
  };
  let calls = 0,
    active = 0,
    peak = 0;
  const seen = [];
  const read = createPdfOutlineReader({
    db,
    uploadRoot: root,
    tempRoot: root,
    render: async (_document, pages) =>
      pages.flatMap((page) =>
        ['top', 'bottom'].map((zone) => ({ page, zone, url: 'data:image/jpeg;base64,dGVzdA==' })),
      ),
  });
  const ask = async (messages) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const regions = messages[1].content
      .filter((item) => item.type === 'text')
      .flatMap((item) => {
        const match = item.text.match(/原 PDF 第 (\d+) 页，.*zone=(top|bottom)/);
        return match
          ? [{ page: Number(match[1]), zone: match[2], title: '', summary: '页面知识主题' }]
          : [];
      });
    seen.push(...regions.map((region) => `${region.page}:${region.zone}`));
    active--;
    return JSON.stringify({ regions });
  };
  const options = { courseId: 1, model: 'model-a', ask };
  const result = await read(materials, options);
  assert.ok(result.includes('第7页下区'));
  assert.equal(new Set(seen).size, 14);
  assert.equal(calls, 3);
  assert.equal(peak, 3);
  assert.equal(await read(materials, options), result);
  assert.equal(calls, 3);
  await read(materials, { ...options, model: 'model-b' });
  assert.equal(calls, 6);
});

test('拒绝遗漏、重复和错误页码的识别结果', () => {
  const top = { page: 1, zone: 'top', title: '', summary: '标题' };
  const bottom = { ...top, zone: 'bottom' };
  assert.equal(validatePageRegions({ regions: [bottom, top] }, [1])[0].zone, 'top');
  assert.deepEqual(validatePageRegions({ pages: [[1, '', '标题', '', '标题']] }, [1]), [
    top,
    bottom,
  ]);
  assert.throws(() => validatePageRegions({ pages: [[1, '', '主题']] }, [1]), /格式/);
  assert.throws(() => validatePageRegions({ regions: [top] }, [1]), /遗漏/);
  assert.throws(() => validatePageRegions({ regions: [top, top] }, [1]), /重复/);
  assert.throws(
    () => validatePageRegions({ regions: [top, { ...bottom, page: 2 }] }, [1]),
    /无效页码/,
  );
});

test('页数超限在发送图片前报错，不静默裁去尾页', async (t) => {
  const { root, materials } = await fixture(t, 301);
  const read = createPdfOutlineReader({
    uploadRoot: root,
    tempRoot: root,
    render: () => {
      throw Error('不应渲染超限资料');
    },
  });
  await assert.rejects(
    () =>
      read(materials, {
        ask: () => {
          throw Error('不应调用模型');
        },
      }),
    /最多处理 300 页/,
  );
});

test('裁剪范围包含重叠并处理旋转页', () => {
  const box = { x: 10, y: 20, width: 600, height: 800 };
  for (const angle of [0, 90, 180, 270]) {
    const top = regionCrop(box, angle, 'top'),
      bottom = regionCrop(box, angle, 'bottom');
    assert.ok(top.x >= box.x && top.y >= box.y);
    assert.ok(bottom.x >= box.x && bottom.y >= box.y);
    assert.ok(top.x + top.width <= box.x + box.width + 0.01);
    assert.ok(top.y + top.height <= box.y + box.height + 0.01);
    assert.ok(Math.min(top.x + top.width, bottom.x + bottom.width) > Math.max(top.x, bottom.x));
    assert.ok(Math.min(top.y + top.height, bottom.y + bottom.height) > Math.max(top.y, bottom.y));
  }
});

test('渲染采用 cropbox 且异常后删除临时批次目录', async (t) => {
  const { root, document } = await fixture(t, 1);
  await assert.rejects(
    () =>
      renderPageRegions(document, [1], root, undefined, async (_tool, args) => {
        assert.ok(args.includes('-cropbox'));
        throw new Error('render failure');
      }),
    /render failure/,
  );
  assert.deepEqual(await fs.readdir(root), ['test.pdf']);
});

test('失败识别不会伪装成功；取消在发送图片前生效', async (t) => {
  const { root, materials } = await fixture(t, 1);
  let calls = 0;
  const read = createPdfOutlineReader({
    uploadRoot: root,
    tempRoot: root,
    render: async () => [{ page: 1, zone: 'top', url: 'data:image/jpeg;base64,dGVzdA==' }],
  });
  await assert.rejects(
    () =>
      read(materials, {
        ask: async () => {
          calls++;
          return '{"regions":[]}';
        },
      }),
    /图片识别失败/,
  );
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() =>
    read(materials, {
      signal: controller.signal,
      ask: () => {
        throw Error('must not call');
      },
    }),
  );
});

test('新课程导入的 PDF 即使重命名也默认按图片分章，不发送 OCR 长文本', async () => {
  const routes = {};
  const app = {
    post: (route, ...handlers) => {
      routes[route] = handlers.at(-1);
    },
  };
  let imageCalls = 0,
    outlineCalls = 0,
    generatedMessages;
  const directoryCache = new Map();
  const { chaptersSuggest } = registerChapterGenerationRoutes(app, {
    generationSignal: (_req, _res, options) => {
      assert.equal(options.timeoutMs, 1800000);
      return new AbortController().signal;
    },
    parseId: (_res, value) => Number(value),
    getOwnedCourse: async (_userId, courseId) => {
      assert.equal(courseId, 73);
      return { id: 73, title: '新导入的课程' };
    },
    db: {
      async getConnection() {
        return {
          execute: this.execute.bind(this),
          async beginTransaction() {},
          async commit() {},
          async rollback() {},
          release() {},
        };
      },
      execute: async (sql, args) => {
        if (sql.startsWith('SELECT id FROM courses')) return [[{ id: 73 }]];
        if (sql.startsWith('SELECT result_text'))
          return [
            directoryCache.has(args.join(':'))
              ? [{ result_text: directoryCache.get(args.join(':')) }]
              : [],
          ];
        if (sql.startsWith('INSERT INTO course_context_cache')) {
          directoryCache.set(args.slice(0, 3).join(':'), args[3]);
          return [{}];
        }
        if (sql.includes('SELECT id,original_name'))
          return [
            [
              {
                id: 1,
                original_name: '已重命名的新资料',
                stored_name: 'test.pdf',
                extracted_text: '不应发送的OCR长文本',
              },
            ],
          ];
        if (sql.includes('SELECT id,title'))
          return [[{ id: 1, title: '章节', description: '第1页' }]];
        return [{}];
      },
    },
    preparePdfOutline: async (_materials, options) => {
      assert.equal(options.courseId, 73);
      options.onSources([{ materialId: 1, pages: 1 }]);
      imageCalls++;
      return 'test.pdf 第1页上区：章节主题';
    },
    serviceSettings: { snapshot: () => ({ baseUrl: 'https://example.com', model: 'test' }) },
    askDeepSeek: async (messages) => {
      generatedMessages = messages;
      outlineCalls++;
      if (outlineCalls === 1) return '{"chapters":[{"title":"缺少页码的章节"}]}';
      return '{"chapters":[{"title":"章节","description":"test.pdf 第1页","sourceRegions":[{"materialId":1,"startPage":1,"endPage":1}]}]}';
    },
    buildVisionPages: () => {
      throw Error('PDF 不应回到前四页辅助图像路径');
    },
    auth() {},
    asyncRoute: (handler) => handler,
  });
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
  await chaptersSuggest({ params: { courseId: '73' }, user: { sub: 1 }, body: {} }, res);
  assert.equal(res.code, 201);
  assert.equal(imageCalls, 1);
  assert.equal(outlineCalls, 2);
  assert.equal(JSON.stringify(generatedMessages).includes('不应发送的OCR长文本'), false);
  assert.ok(JSON.stringify(generatedMessages).includes('第1页'));
  await chaptersSuggest({ params: { courseId: '73' }, user: { sub: 1 }, body: {} }, res);
  assert.equal(outlineCalls, 2, '相同资料和要求复用已验证目录，不再次请求模型');
  await chaptersSuggest(
    { params: { courseId: '73' }, user: { sub: 1 }, body: { requirements: '按知识点细分' } },
    res,
  );
  assert.equal(outlineCalls, 3, '要求变化后重新分析，不能误用上次结果');
});

test('图片摘要允许三万字符上下文，但不放宽普通任务默认上限', async () => {
  const text = '资料'.repeat(12500);
  assert.equal(
    await prepareLongContext(
      text,
      () => {
        throw Error('不应整理');
      },
      undefined,
      { maxContextChars: 30000 },
    ),
    text,
  );
});
