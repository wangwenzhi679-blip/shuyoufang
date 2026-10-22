import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileAskSchema, registerMobileLearning } from './mobile-learning.js';

function routes(db, askDeepSeek = async () => '') {
  const handlers = new Map();
  const app = {
    get: (path, ...actions) => handlers.set('GET ' + path, actions.at(-1)),
    post: (path, ...actions) => handlers.set('POST ' + path, actions.at(-1)),
    patch: (path, ...actions) => handlers.set('PATCH ' + path, actions.at(-1)),
    delete: (path, ...actions) => handlers.set('DELETE ' + path, actions.at(-1)),
  };
  registerMobileLearning(app, {
    db,
    auth() {},
    asyncRoute: (action) => action,
    serviceSettings: { configured: () => true },
    askDeepSeek,
    generationSignal: () => new AbortController().signal,
  });
  return handlers;
}
function response() {
  return {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test('图片问答拒绝空内容、外部图片 URL、过长历史和无效图片格式', () => {
  assert.equal(mobileAskSchema.safeParse({}).success, false);
  assert.equal(
    mobileAskSchema.safeParse({ image: 'https://example.com/photo.jpg' }).success,
    false,
  );
  assert.equal(
    mobileAskSchema.safeParse({
      question: '题目',
      history: Array(9).fill({ role: 'user', content: '问题' }),
    }).success,
    false,
  );
  assert.equal(
    mobileAskSchema.safeParse({ image: 'data:image/svg+xml;base64,AAAA' }).success,
    false,
  );
  assert.equal(mobileAskSchema.safeParse({ image: 'data:image/jpeg;base64,AAAA' }).success, true);
});

test('图片按多模态消息发送，原图不写入问答数据库', async () => {
  const writes = [];
  let messages;
  const handler = routes(
    {
      execute: async (...args) => {
        writes.push(args);
        return [{}];
      },
    },
    async (input) => {
      messages = input;
      return JSON.stringify({ question: '1+1=?', answer: '2', analysis: '相加得到2。' });
    },
  ).get('POST /api/mobile/ask');
  const res = response();
  await handler({ user: { sub: 7 }, body: { image: 'data:image/jpeg;base64,AAAA' } }, res);
  assert.equal(res.body.answer_text, '2');
  assert.equal(messages.at(-1).content[1].type, 'image_url');
  assert.equal(writes[0][1][1], 7);
  assert.equal(JSON.stringify(writes).includes('data:image'), false);
});

test('保存他人问答拒绝并回滚，不新增题目', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    execute: async (sql, values) => {
      calls.push(sql);
      assert.equal(values.at(-1), 9);
      return [[]];
    },
  };
  const handler = routes({ getConnection: async () => connection }).get(
    'POST /api/mobile/answers/:id/wrong',
  );
  const res = response();
  await handler({ user: { sub: 9 }, params: { id: 'b507c151-01f7-48cd-8783-9ee66f20c06a' } }, res);
  assert.equal(res.code, 404);
  assert.ok(calls.includes('rollback'));
  assert.ok(!calls.some((value) => value.startsWith('INSERT')));
});

test('重复收藏复用原题编号，不重复创建课程或题目', async () => {
  const writes = [];
  const connection = {
    beginTransaction: async () => {},
    rollback: async () => {},
    commit: async () => {},
    release() {},
    execute: async (sql, values) => {
      writes.push([sql, values]);
      return sql.startsWith('SELECT * FROM mobile_learning_answers')
        ? [[{ id: 'answer', question_id: 31 }]]
        : [[]];
    },
  };
  const handler = routes({ getConnection: async () => connection }).get(
    'POST /api/mobile/answers/:id/wrong',
  );
  const res = response();
  await handler({ user: { sub: 9 }, params: { id: 'b507c151-01f7-48cd-8783-9ee66f20c06a' } }, res);
  assert.equal(res.body.question_id, 31);
  assert.ok(
    !writes.some(
      ([sql]) =>
        sql.startsWith('INSERT INTO courses') || sql.startsWith('INSERT INTO practice_questions'),
    ),
  );
  assert.deepEqual(writes.at(-1)[1], [31]);
});
