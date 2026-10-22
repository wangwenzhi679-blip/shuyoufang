import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantPageSource, assistantSourceContent } from './assistant-page-source.js';
import { createAssistantContext } from './assistant-context.js';
import { AssistantSessions } from './assistant-sessions.js';
import { registerPracticeRoutes } from './practice-routes.js';
import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { questionItemSchema } from './request-schemas.mjs';

const signal = () => new AbortController().signal;
const material = {
  id: 1,
  stored_name: 'book.pdf',
  original_name: '扫描课本.pdf',
  extracted_text: '',
};
const chapter = {
  id: 13,
  title: '本章',
  source_regions_json: [
    { materialId: 1, startPage: 15, endPage: 17 },
    { materialId: 1, startPage: 17, endPage: 19 },
  ],
};
function fixture(options = {}) {
  const rendered = [];
  const readAssistantPageSource = createAssistantPageSource({
    uploadRoot: 'unused',
    previewRoot: 'unused',
    renderPage: async (m, page) => {
      rendered.push([m.id, page]);
      return String(page);
    },
    readFile: async (page) => Buffer.from(`original-image-${page}`),
    pageCount: async () => 3,
    ...options,
  });
  const db = {
    execute: async (sql) => {
      if (sql.startsWith('SELECT title FROM courses')) return [[{ title: '语文' }]];
      if (sql.startsWith('SELECT id,title,description')) return [[chapter]];
      if (sql.startsWith('SELECT id,original_name')) return [[material]];
      if (sql.startsWith('SELECT c.material_id')) return [[]];
      throw new Error(sql);
    },
  };
  return { readAssistantPageSource, rendered, db };
}

test('章节原图去重并按物理页码发送，整本短PDF也直接发送原图', async () => {
  const f = fixture();
  const images = await f.readAssistantPageSource(chapter, [material], signal());
  assert.deepEqual(
    f.rendered.map(([, p]) => p),
    [15, 16, 17, 18, 19],
  );
  assert.equal(images.parts.filter((p) => p.type === 'image_url').length, 5);
  assert.deepEqual(
    images.sources.map((s) => s.page),
    [15, 16, 17, 18, 19],
  );
  assert.equal(
    Buffer.from(images.parts[1].image_url.url.split(',')[1], 'base64').toString(),
    'original-image-15',
  );
  f.rendered.length = 0;
  await f.readAssistantPageSource(null, [material], signal());
  assert.deepEqual(
    f.rendered.map(([, p]) => p),
    [1, 2, 3],
  );
});

test('越界资料、无效范围、大范围和取消不产生部分上下文，人工修正仍优先', async () => {
  const f = fixture({ maxPages: 4 });
  await assert.rejects(f.readAssistantPageSource(chapter, [material], signal()), /较小的章节范围/);
  assert.equal(f.rendered.length, 0);
  await assert.rejects(f.readAssistantPageSource(chapter, [], signal()), /原 PDF 不存在/);
  await assert.rejects(
    f.readAssistantPageSource({ ...chapter, source_regions_json: 'invalid' }, [material], signal()),
    /原页范围无效/,
  );
  const correction = { materialId: 1, corrected: true, content: '老师修正的正文' };
  const corrected = await f.readAssistantPageSource(
    chapter,
    [material],
    signal(),
    [correction],
    () => {
      throw Error('不应检查图片模型');
    },
  );
  assert.deepEqual(corrected.sections, [correction]);
  assert.deepEqual(corrected.parts, []);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(f.readAssistantPageSource(chapter, [material], cancelled.signal), {
    name: 'AbortError',
  });
  const blocked = fixture();
  await assert.rejects(
    blocked.readAssistantPageSource(chapter, [material], signal(), [], () => {
      throw Error('模型不支持图片');
    }),
    /模型不支持图片/,
  );
  assert.equal(blocked.rendered.length, 0);
  const large = fixture({ maxBytes: 1 });
  await assert.rejects(large.readAssistantPageSource(chapter, [material], signal()), /图片过大/);
});

test('章节助手直接将原图交给流式模型，跳过OCR且图片不存入聊天数据库', async () => {
  const f = fixture();
  const context = createAssistantContext({
    ...f,
    sliceChapterText,
    selectChapterQuestions,
    assertCourse: async (user, course) => {
      assert.equal(user, 9);
      assert.equal(course, 1);
    },
    applyChapterCorrections: async (_db, _course, _chapter, sections) => sections,
    readPreferences: async () => ({ preferences: { answerStyle: 'concise' } }),
    readChapterSummarySource: async () => {
      throw Error('禁止调用OCR或文字转录');
    },
  });
  const result = await context(9, 1, 13, '解释本章', 'configured', signal());
  assert.equal(result.sources.length, 5);
  assert.equal(result.sources[0].chapterId, 13);
  const content = assistantSourceContent(result, '生成练习');
  assert.equal(content.filter((p) => p.type === 'image_url').length, 5);
  assert.match(content[0].text, /生成练习/);
  const stored = [],
    streams = [];
  const sessions = new AssistantSessions(
    {
      execute: async (sql, values) => {
        stored.push(values);
        if (sql.startsWith('SELECT m.*')) return [[]];
        return [{ affectedRows: 1 }];
      },
    },
    {
      context: async () => result,
      runtime: { assert() {} },
      assertCourse: async () => {},
      stream: async (messages, model, _signal, onChunk) => {
        streams.push(messages);
        assert.equal(model, 'configured');
        assert.equal(messages[1].content.filter((p) => p.type === 'image_url').length, 5);
        await onChunk('根据原图的回答 [资料1]');
      },
    },
  );
  sessions.activeUser = async () => {};
  sessions.chapter = async () => {};
  await sessions.answer(
    9,
    0,
    { id: 'thread', course_id: 1, chapter_id: 13 },
    'message',
    'prompt',
    '解释本章',
    'configured',
    signal(),
  );
  assert.equal(streams.length, 1, '无需先调用模型转录文字');
  assert.doesNotMatch(JSON.stringify(stored), /data:image/);
});

test('根据助手回答生成练习也直接发送原图，沿用所选模型', async () => {
  const images = await fixture().readAssistantPageSource(chapter, [material], signal());
  const calls = [],
    writes = [];
  let task;
  const sessions = new AssistantSessions(
    {
      execute: async (sql, values) => {
        writes.push([sql, values]);
        if (sql.startsWith('SELECT * FROM assistant_messages'))
          return [[{ content: '此前的讨论' }]];
        if (sql.startsWith('SELECT id FROM assistant_practice_drafts')) return [[]];
        return [{ affectedRows: 1 }];
      },
    },
    {
      context: async () => ({
        text: '直接看本章图片',
        parts: images.parts,
        sources: images.sources,
      }),
      assertCourse: async () => {},
      assertModel() {},
      runtime: { assert() {} },
      questionSchema: questionItemSchema,
      ask: async (messages, model) => {
        assert.equal(model, 'configured');
        calls.push(messages);
        assert.equal(messages[1].content.filter((p) => p.type === 'image_url').length, 5);
        return JSON.stringify({
          questions: [
            {
              type: '简答题',
              question: '说明本章要点',
              options: [],
              answer: '本章要点',
              analysis: '依据原页图片',
            },
          ],
        });
      },
    },
  );
  sessions.activeUser = async () => {};
  sessions.chapter = async () => {};
  sessions.thread = async () => ({ id: crypto.randomUUID(), course_id: 1 });
  sessions.background = (_id, fn) => {
    task = fn(signal());
  };
  await sessions.generatePractice(9, 0, crypto.randomUUID(), crypto.randomUUID(), {
    requestId: crypto.randomUUID(),
    chapterId: 13,
    count: 1,
    model: 'configured',
  });
  await task;
  assert.equal(calls.length, 1);
  assert(writes.some(([sql]) => sql.includes("status='ready'")));
});

test('章节出题和多选答案核对都附带同一批原图，不调用OCR或中间转录', async () => {
  const f = fixture();
  const calls = [];
  const { questionsGenerate } = registerPracticeRoutes(
    { post() {}, get() {}, put() {}, delete() {} },
    {
      ...f,
      generationSignal: signal,
      parseId: (_res, id) => Number(id),
      auth() {},
      asyncRoute: (fn) => fn,
      getOwnedCourse: async () => ({ id: 1, title: '语文' }),
      validationError() {
        throw Error('输入无效');
      },
      readChapterSummarySource: async () => {
        throw Error('禁止调用OCR');
      },
      askDeepSeek: async (messages, model) => {
        assert.equal(model, undefined, '沿用当前用户的模型');
        calls.push(messages);
        const content = messages[1].content;
        assert.equal(content.filter((p) => p.type === 'image_url').length, 5);
        if (calls.length === 2)
          return JSON.stringify({
            answers: [{ index: 0, answer: 'AB', analysis: 'A、B与原图一致' }],
          });
        return JSON.stringify({
          questions: [
            {
              type: '多选题',
              question: '哪些说法与本章一致？',
              options: ['A.甲', 'B.乙', 'C.丙', 'D.丁'],
              answer: 'AB',
              analysis: '甲、乙符合本章原图',
            },
          ],
        });
      },
    },
  );
  const res = {
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
      body: { chapterId: 13, persist: false, questionCounts: [{ type: '多选题', count: 1 }] },
    },
    res,
  );
  assert.equal(calls.length, 2);
  assert.equal(res.body.questions[0].answer, 'AB');
});
