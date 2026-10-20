import test from 'node:test';
import assert from 'node:assert/strict';
import { createChapterSummarySource } from './chapter-summary-source.js';
import { registerChapterGenerationRoutes } from './chapter-generation-routes.js';

const material = {
  id: 1,
  original_name: '课本.pdf',
  stored_name: 'book.pdf',
  extracted_text: '错误题库片段\uFFFD',
};
const chapter = {
  id: 13,
  title: '第一单元（二）：庖丁解牛、烛之武退秦师',
  source_regions_json: [{ materialId: 1, startPage: 15, endPage: 19 }],
};
const valid = JSON.stringify({
  summary: '本章总结',
  knowledgePoints: [
    { title: '知识点一', explanation: '解释一' },
    { title: '知识点二', explanation: '解释二' },
  ],
});

test('总结按物理页码合并同资料范围、去重排序，绝不传整本错误文本', async () => {
  const calls = [];
  const read = createChapterSummarySource({
    uploadRoot: process.cwd(),
    readPdfText: async (file, options) => {
      calls.push({ file, options });
      return '本章原文';
    },
  });
  const sections = await read(
    {
      ...chapter,
      source_regions_json: JSON.stringify([
        ...chapter.source_regions_json,
        { materialId: 1, startPage: 19, endPage: 20 },
      ]),
    },
    [material],
  );
  assert.deepEqual(calls[0].options.pageNumbers, [15, 16, 17, 18, 19, 20]);
  assert.equal(calls.length, 1);
  assert.equal(sections[0].content, '本章原文');
  assert.equal(await read({ source_regions_json: null }, [material]), null);
});

test('无效页码、跨课程资料、路径逃逸及空白扫描页不会静默回退整本', async () => {
  const read = createChapterSummarySource({
    uploadRoot: process.cwd(),
    readPdfText: async () => '',
  });
  for (const source of [
    'broken',
    [],
    [{ materialId: 1, startPage: 19, endPage: 15 }],
    [{ materialId: 2, startPage: 1, endPage: 2 }],
  ])
    await assert.rejects(
      read({ ...chapter, source_regions_json: source }, [material]),
      /范围无效|不存在/,
    );
  await assert.rejects(read(chapter, [{ ...material, stored_name: '../book.pdf' }]), /不存在/);
  await assert.rejects(read(chapter, [material]), /OCR/);
  const corrected = await read(chapter, [material], undefined, [
    { materialId: 1, name: '课本.pdf', content: '校正原文', corrected: true },
  ]);
  assert.equal(corrected[0].content, '校正原文');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(read(chapter, [material], controller.signal), { name: 'AbortError' });
});

function fixture(ask, { cancelBeforeSave = false, corrected = false } = {}) {
  const calls = [],
    saved = [];
  const controller = new AbortController();
  const db = {
    async execute(sql, args) {
      if (sql.startsWith('SELECT id,title,description')) return [[chapter]];
      if (sql.startsWith('SELECT id,original_name')) return [[material]];
      if (sql.startsWith('SELECT c.material_id'))
        return [
          corrected
            ? [{ material_id: 1, original_name: '课本.pdf', content: '用户校正后的原文' }]
            : [],
        ];
      if (sql.startsWith('INSERT INTO chapter_summaries')) {
        saved.push(args);
        return [{}];
      }
      if (sql.startsWith('SELECT id,updated_at')) return [[{ id: 9, updated_at: 'now' }]];
      throw new Error(sql);
    },
  };
  const { summaryGenerate } = registerChapterGenerationRoutes(
    { post() {} },
    {
      generationSignal: () => controller.signal,
      parseId: (_res, id) => Number(id),
      getOwnedCourse: async () => ({ id: 1, title: '语文' }),
      db,
      askDeepSeek: async (messages, _model, signal, options) => {
        calls.push({ messages, options });
        return ask(calls.length, signal);
      },
      getAiModel: async () => 'configured-test-model',
      auth() {},
      asyncRoute: (handler) => handler,
      readChapterSummarySource: createChapterSummarySource({
        uploadRoot: process.cwd(),
        readPdfText: async () => '庖丁解牛的本章原文',
      }),
    },
  );
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  const run = () =>
    summaryGenerate(
      {
        params: { courseId: 1, chapterId: 13 },
        user: { sub: 1 },
        body: {},
        beginSave: async () => {
          if (cancelBeforeSave) throw new Error('已取消');
        },
      },
      res,
    );
  return { run, res, calls, saved, controller };
}

test('真实故障回归：组合章节标题与损坏提取文本下仍按原页总结，保留用户校正', async () => {
  for (const corrected of [false, true]) {
    const f = fixture(() => valid, { corrected });
    await f.run();
    assert.equal(f.res.statusCode, 200);
    assert.equal(f.saved.length, 1);
    const prompt = f.calls[0].messages[1].content;
    assert.ok(prompt.includes(corrected ? '用户校正后的原文' : '庖丁解牛的本章原文'));
    assert.ok(!prompt.includes('错误题库片段'));
    assert.deepEqual(f.calls[0].options, {
      maxOutputTokens: 3072,
      thinking: false,
      jsonObject: true,
    });
  }
});

test('总结 JSON 或长度无效、输出截断最多修复一次；最终失败不覆盖已有总结', async () => {
  for (const bad of [
    'not json',
    JSON.stringify({ summary: 'x', knowledgePoints: [] }),
    Object.assign(new Error('truncated'), { code: 'AI_OUTPUT_LIMIT' }),
  ]) {
    const f = fixture((n) => {
      if (n === 1) {
        if (bad instanceof Error) throw bad;
        return bad;
      }
      return valid;
    });
    await f.run();
    assert.equal(f.calls.length, 2);
    assert.equal(f.saved.length, 1);
  }
  const failed = fixture(() => '{');
  await failed.run();
  assert.equal(failed.res.statusCode, 502);
  assert.equal(failed.calls.length, 2);
  assert.equal(failed.saved.length, 0);
});

test('鉴权错误不重复付费，取消后不保存总结', async () => {
  const f = fixture(() => {
    throw Object.assign(new Error('鉴权失败'), { status: 401 });
  });
  await assert.rejects(f.run(), /鉴权失败/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saved.length, 0);
  const cancelled = fixture(() => valid, { cancelBeforeSave: true });
  await assert.rejects(cancelled.run(), /已取消/);
  assert.equal(cancelled.saved.length, 0);
});
