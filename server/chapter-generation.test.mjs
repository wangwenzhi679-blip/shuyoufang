import test from 'node:test';
import assert from 'node:assert/strict';
import { registerChapterGenerationRoutes } from './chapter-generation-routes.js';
import { MAX_CHAPTER_DRAFTS } from './request-schemas.mjs';

// 合成的 270 页资料覆盖生成、缓存及采用过程，不连接真实数据库或 AI。
function fixture({ ask } = {}) {
  const routes = new Map();
  const state = {
    drafts: [],
    chapters: [],
    cache: null,
    calls: [],
    progress: [],
    saves: 0,
    materials: [{ id: 7, original_name: '合成测试.pdf', stored_name: 'test.pdf' }],
    rollbacks: 0,
    releases: 0,
  };
  const generated = Array.from({ length: 30 }, (_, index) => ({
    title: `第 ${index + 1} 章`,
    description: `原资料第 ${index * 9 + 1}–${(index + 1) * 9} 页`,
    sourceRegions: [{ materialId: 7, startPage: index * 9 + 1, endPage: (index + 1) * 9 }],
  }));
  const db = {
    async execute(sql, args) {
      if (sql.startsWith('SELECT id,original_name')) return [structuredClone(state.materials)];
      if (sql.startsWith('SELECT id FROM courses')) return [[{ id: 1 }]];
      if (sql.startsWith('SELECT result_text FROM course_context_cache'))
        return [state.cache?.hash === args[2] ? [{ result_text: state.cache.value }] : []];
      if (sql.startsWith('INSERT INTO course_context_cache')) {
        state.cache = { hash: args[2], value: args[3] };
        return [{}];
      }
      if (sql.startsWith('DELETE FROM course_chapter_drafts')) {
        state.drafts = [];
        return [{}];
      }
      if (sql.startsWith('INSERT INTO course_chapter_drafts')) {
        if (state.failDraftInsertAt === state.drafts.length + 1) throw new Error('模拟保存中断');
        state.drafts.push({
          id: state.drafts.length + 1,
          title: args[1],
          description: args[2],
          sort_order: args[3],
          source_regions_json: args[4],
        });
        if (state.cancelOnInsert === state.drafts.length) controller.abort();
        return [{}];
      }
      if (sql.startsWith('SELECT id,title,description,sort_order')) return [state.drafts];
      if (sql.startsWith('SELECT id FROM course_chapters')) return [state.chapters];
      if (sql.startsWith('DELETE FROM course_chapters')) {
        state.chapters = [];
        return [{}];
      }
      if (sql.startsWith('SELECT id,source_regions_json FROM course_chapter_drafts'))
        return [state.drafts];
      if (sql.startsWith('INSERT INTO course_chapters')) {
        state.chapters.push({
          id: state.chapters.length + 1,
          title: args[1],
          description: args[2],
          sort_order: args[3],
          source_regions_json: args[4],
        });
        return [{}];
      }
      if (sql.startsWith('SELECT id,course_id,title')) return [state.chapters];
      throw new Error(`未预期的数据库访问：${sql}`);
    },
    async getConnection() {
      let snapshot;
      return {
        execute: this.execute.bind(this),
        async beginTransaction() {
          snapshot = structuredClone({ drafts: state.drafts, chapters: state.chapters });
        },
        async commit() {},
        async rollback() {
          Object.assign(state, snapshot);
          state.rollbacks++;
        },
        release() {
          state.releases++;
        },
      };
    },
  };
  const controller = new AbortController();
  registerChapterGenerationRoutes(
    { post: (path, ...handlers) => routes.set(path, handlers.at(-1)) },
    {
      generationSignal: () => controller.signal,
      parseId: (_res, value) => Number(value),
      getOwnedCourse: async () => ({ id: 1, title: '合成测试课程' }),
      db,
      askDeepSeek: async (messages, _model, signal, options) => {
        state.calls.push({ messages, options });
        signal.throwIfAborted();
        return ask
          ? ask({ messages, options, generated, state, controller })
          : JSON.stringify({ chapters: generated });
      },
      getAiModel: async () => 'configured-test-model',
      auth() {},
      asyncRoute: (handler) => handler,
      preparePdfOutline: async (_materials, { onSources }) => {
        onSources([{ materialId: 7, pages: 270 }]);
        return '合成的逐页图片分区摘要';
      },
      validationError: (res) => res.status(400).json({ message: 'invalid' }),
    },
  );
  const request = (body = {}) => ({
    params: { courseId: '1' },
    user: { sub: 2 },
    body,
    updateProgress: async (message) => state.progress.push(message),
    beginSave: async () => state.saves++,
  });
  const response = () => ({
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });
  return {
    state,
    generated,
    request,
    response,
    controller,
    suggest: routes.get('/api/courses/:courseId/chapters/suggest'),
    confirm: routes.get('/api/courses/:courseId/chapters/confirm-draft'),
  };
}

test('超过20章的PDF目录可生成、复用缓存及采用，全部270页映射保持原样', async () => {
  const f = fixture();
  let res = f.response();
  await f.suggest(f.request(), res);
  assert.equal(res.code, 201);
  assert.equal(res.body.chapterDrafts.length, 30);
  assert.ok(f.state.progress.includes('PDF 图片识别已完成，正在汇总章节目录'));
  assert.ok(f.state.progress.includes('正在生成章节目录与页码映射'));
  const savedRegions = f.state.drafts.map((draft) => draft.source_regions_json);
  res = f.response();
  await f.suggest(f.request(), res);
  assert.equal(res.code, 201);
  assert.equal(f.state.calls.length, 1, '相同资料应直接复用目录缓存');
  const chapters = res.body.chapterDrafts.map((draft) => ({
    ...draft,
    sourceRegions: [{ materialId: 999, startPage: 1, endPage: 1 }],
  }));
  res = f.response();
  await f.confirm(f.request({ chapters }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.chapters.length, 30);
  assert.deepEqual(
    f.state.chapters.map((chapter) => chapter.source_regions_json),
    savedRegions,
  );
  assert.deepEqual(
    savedRegions.map(JSON.parse),
    f.generated.map((chapter) => chapter.sourceRegions),
  );
  assert.equal(f.state.drafts.length, 0);
});

test('目录输出截断后有限重试并扩大预算，丢弃残缺结果', async () => {
  const f = fixture({
    ask: ({ state, generated }) => {
      if (state.calls.length === 1)
        throw Object.assign(new Error('truncated'), { code: 'AI_OUTPUT_LIMIT' });
      return JSON.stringify({ chapters: generated });
    },
  });
  const res = f.response();
  await f.suggest(f.request(), res);
  assert.equal(res.code, 201);
  assert.deepEqual(
    f.state.calls.map((call) => call.options.maxOutputTokens),
    [16384, 32768],
  );
  assert.ok(
    f.state.calls.every((call) => call.options.thinking === false && call.options.jsonObject),
  );
  assert.match(f.state.calls[1].messages.at(-1).content, /输出被截断/);
  assert.equal(f.state.saves, 1);
});

test('目录仍须覆盖全部PDF页，持续遗漏不能写入草稿或缓存', async () => {
  const f = fixture({ ask: ({ generated }) => JSON.stringify({ chapters: generated.slice(1) }) });
  const res = f.response();
  await f.suggest(f.request(), res);
  assert.equal(res.code, 502);
  assert.match(res.body.message, /遗漏/);
  assert.equal(f.state.calls.length, 2);
  assert.equal(f.state.saves, 0);
  assert.equal(f.state.cache, null);
  assert.equal(f.state.drafts.length, 0);
});

test('取消在目录重试前生效，不继续请求模型或保存', async () => {
  const f = fixture({
    ask: ({ controller }) => {
      controller.abort();
      throw Object.assign(new Error('truncated'), { code: 'AI_OUTPUT_LIMIT' });
    },
  });
  await assert.rejects(() => f.suggest(f.request(), f.response()), { name: 'AbortError' });
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.saves, 0);
  assert.equal(f.state.cache, null);
});

test('采用目录仍有合理数量边界，超过300章在写入前拒绝', async () => {
  const f = fixture();
  const res = f.response();
  await f.confirm(
    f.request({
      chapters: Array.from({ length: MAX_CHAPTER_DRAFTS + 1 }, () => ({ title: '章节' })),
    }),
    res,
  );
  assert.equal(res.code, 400);
  assert.equal(f.state.chapters.length, 0);
});

test('保存新目录中断时完整保留旧草稿，不留下部分新章节', async () => {
  const f = fixture();
  const previous = [{ id: 99, title: '原有草稿' }];
  f.state.drafts = structuredClone(previous);
  f.state.failDraftInsertAt = 3;
  await assert.rejects(() => f.suggest(f.request(), f.response()), /模拟保存中断/);
  assert.deepEqual(f.state.drafts, previous);
  assert.equal(f.state.rollbacks, 1);
  assert.equal(f.state.releases, 1);
});

test('分析期间资料被删除或替换时拒绝保存过期目录', async () => {
  const f = fixture({
    ask: ({ state, generated }) => {
      state.materials = [];
      return JSON.stringify({ chapters: generated });
    },
  });
  await assert.rejects(
    () => f.suggest(f.request(), f.response()),
    (error) => error.status === 409 && /资料已变化/.test(error.message),
  );
  assert.equal(f.state.saves, 0);
  assert.equal(f.state.drafts.length, 0);
  assert.equal(f.state.rollbacks, 1);
});

test('保存途中课程被取消也回滚，不保留半份目录', async () => {
  const f = fixture();
  f.state.drafts = [{ id: 99, title: '原有草稿' }];
  f.state.cancelOnInsert = 3;
  await assert.rejects(() => f.suggest(f.request(), f.response()), { name: 'AbortError' });
  assert.deepEqual(f.state.drafts, [{ id: 99, title: '原有草稿' }]);
  assert.equal(f.state.rollbacks, 1);
});

test('空回答仅重试一次，成功后仍保存完整目录', async () => {
  const f = fixture({
    ask: ({ state, generated }) => {
      if (state.calls.length === 1)
        throw Object.assign(new Error('empty'), { code: 'AI_EMPTY_RESPONSE' });
      return JSON.stringify({ chapters: generated });
    },
  });
  const res = f.response();
  await f.suggest(f.request(), res);
  assert.equal(res.code, 201);
  assert.equal(f.state.calls.length, 2);
  assert.equal(f.state.drafts.length, 30);
});

test('采用时拒绝重复草稿或丢失图片草稿编号，旧章节保持完整', async () => {
  const f = fixture();
  await f.suggest(f.request(), f.response());
  let res = f.response();
  await f.confirm(f.request({ chapters: [f.state.drafts[0], f.state.drafts[0]] }), res);
  assert.equal(res.code, 400);
  assert.equal(f.state.chapters.length, 0);
  await assert.rejects(
    () => f.confirm(f.request({ chapters: [{ title: '丢失图片编号' }] }), f.response()),
    /缺少草稿编号/,
  );
  assert.equal(f.state.drafts.length, 30);
  res = f.response();
  await f.confirm(f.request({ chapters: f.state.drafts }), res);
  assert.equal(res.code, 200);
  await assert.rejects(
    () => f.confirm(f.request({ chapters: [{ id: 1, title: '重复提交' }] }), f.response()),
    (error) => error.status === 409,
  );
  assert.equal(f.state.chapters.length, 30);
});
