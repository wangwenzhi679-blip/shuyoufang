import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPracticeRoutes } from './practice-routes.js';
import { createAssistantContext } from './assistant-context.js';
import { createChapterSummarySource } from './chapter-summary-source.js';
import { applyChapterCorrections } from './chapter-corrections.js';
import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { createChapterImageSource } from './chapter-image-source.js';

test('扫描课本OCR不通过时从本章原图识读再出题，不使用旧乱码或调用其他模型', async () => {
  const f = fixture(),
    rendered = [];
  f.readChapterSummarySource = async () => {
    throw Object.assign(new Error('OCR 识别置信度过低'), { status: 422 });
  };
  const readImages = createChapterImageSource({
    uploadRoot: 'unused',
    previewRoot: 'unused',
    renderPage: async (_material, page) => {
      rendered.push(page);
      return String(page);
    },
    readFile: async () => Buffer.from('image'),
  });
  let visionCalls = 0,
    questionCalls = 0;
  const { questionsGenerate } = registerPracticeRoutes(
    { post() {}, get() {}, put() {}, delete() {} },
    {
      ...f,
      readChapterImageSource: readImages,
      generationSignal: () => new AbortController().signal,
      parseId: (_res, id) => Number(id),
      getOwnedCourse: async () => ({ id: 1, title: '语文' }),
      getAiModel: async () => 'selected-vision-model',
      auth() {},
      asyncRoute: (fn) => fn,
      validationError() {
        throw Error('输入无效');
      },
      askDeepSeek: async (messages, model) => {
        assert.equal(model, undefined, '必须沿用当前账号模型');
        const content = messages.at(-1).content;
        if (Array.isArray(content)) {
          visionCalls++;
          const pages = content
            .filter((part) => part.type === 'text' && part.text.startsWith('【'))
            .map((part) => Number(part.text.match(/第 (\d+) 页/)[1]));
          return JSON.stringify({
            pages: pages.map((page) => ({ page, readable: true, text: '庖丁解牛选自《庄子》。' })),
          });
        }
        questionCalls++;
        assert.match(content, /庖丁解牛选自/);
        assert.doesNotMatch(content, /错误内容/);
        return JSON.stringify({
          questions: [
            {
              type: '单选题',
              question: '庖丁解牛出自哪里？',
              options: ['A. 庄子', 'B. 论语', 'C. 孟子', 'D. 史记'],
              answer: 'A',
              analysis: '原文注明选自庄子。',
            },
          ],
        });
      },
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
  await questionsGenerate(
    {
      params: { courseId: 1 },
      user: { sub: 9 },
      body: { chapterId: 13, questionCounts: [{ type: '单选题', count: 1 }], persist: false },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.questions.length, 1);
  assert.deepEqual(rendered, [15, 16, 17, 18, 19]);
  assert.equal(visionCalls, 3);
  assert.equal(questionCalls, 1);
});

const chapter = {
  id: 13,
  title: '组合标题：庖丁解牛、烛之武退秦师',
  source_regions_json: [{ materialId: 1, startPage: 15, endPage: 19 }],
};
const material = {
  id: 1,
  original_name: '语文.pdf',
  stored_name: 'book.pdf',
  extracted_text: '错误内容\ufffd',
};
function fixture() {
  const pages = [],
    prompts = [];
  const db = {
    async execute(sql) {
      if (sql.startsWith('SELECT title FROM courses')) return [[{ title: '语文' }]];
      if (sql.startsWith('SELECT id,title,description')) return [[chapter]];
      if (sql.startsWith('SELECT id,original_name')) return [[material]];
      if (sql.startsWith('SELECT c.material_id')) return [[]];
      throw new Error(sql);
    },
  };
  const readChapterSummarySource = createChapterSummarySource({
    uploadRoot: process.cwd(),
    readPdfText: async (_file, options) => {
      pages.push(options.pageNumbers);
      return '庖丁解牛本章可读取的原文';
    },
  });
  return { db, pages, prompts, readChapterSummarySource };
}
test('练习使用本章物理页码并修复错误题量，persist=false不写草稿', async () => {
  const f = fixture();
  let calls = 0;
  const q = {
    type: '单选题',
    question: '庖丁解牛出自哪里？',
    options: ['A. 庄子', 'B. 论语', 'C. 孟子', 'D. 史记'],
    answer: 'A',
    analysis: '原文注明出自庄子。',
  };
  const app = { post() {}, get() {}, put() {}, delete() {} };
  const { questionsGenerate } = registerPracticeRoutes(app, {
    ...f,
    generationSignal: () => new AbortController().signal,
    parseId: (_r, v) => Number(v),
    getOwnedCourse: async () => ({ id: 1, title: '语文' }),
    getAiModel: async () => 'configured',
    auth() {},
    asyncRoute: (x) => x,
    validationError: () => {
      throw new Error('invalid request');
    },
    askDeepSeek: async (messages) => {
      f.prompts.push(messages);
      return JSON.stringify({ questions: ++calls === 1 ? [] : [q] });
    },
  });
  const res = {
    statusCode: 200,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
  };
  await questionsGenerate(
    {
      params: { courseId: 1 },
      user: { sub: 9 },
      body: { chapterId: 13, questionCounts: [{ type: '单选题', count: 1 }], persist: false },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 2);
  assert.deepEqual(f.pages, [[15, 16, 17, 18, 19]]);
  assert.ok(f.prompts[0][1].content.includes('本章可读取的原文'));
  assert.ok(!f.prompts[0][1].content.includes('错误内容'));
  assert.equal(res.body.questions.length, 1);
});
test('章节助手检索同一原页范围，不使用整本或旧标题匹配', async () => {
  const f = fixture();
  const context = createAssistantContext({
    ...f,
    assertCourse: async () => {},
    sliceChapterText,
    selectChapterQuestions,
    applyChapterCorrections,
    readPreferences: async () => ({ preferences: { answerStyle: 'concise' } }),
  });
  const result = await context(9, 1, 13, '庖丁解牛', undefined, new AbortController().signal);
  assert.deepEqual(f.pages, [[15, 16, 17, 18, 19]]);
  assert.ok(result.text.includes('本章可读取的原文'));
  assert.ok(!result.text.includes('错误内容'));
  assert.equal(result.sources[0].chapterId, 13);
});
