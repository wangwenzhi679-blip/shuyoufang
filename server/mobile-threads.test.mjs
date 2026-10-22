import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownedMobileThread,
  withMobileThread,
  insertThreadAnswer,
  registerMobileThreads,
} from './mobile-threads.js';
const id = 'ad20435e-55a3-4c37-a45b-cbc47191c49b';

test('对话必须属于当前账号，关闭的对话不调用模型', async () => {
  await assert.rejects(
    ownedMobileThread(
      {
        execute: async (sql, args) => {
          assert.deepEqual(args, [id, 7]);
          return [[]];
        },
      },
      7,
      id,
    ),
    { status: 404 },
  );
  let called = false;
  await assert.rejects(
    withMobileThread({ execute: async () => [[{ id, closed: 1 }]] }, 7, id, async () => {
      called = true;
    }),
    { status: 409 },
  );
  assert.equal(called, false);
});
test('同一对话不并发回答，失败后释放占用', async () => {
  const db = { execute: async () => [[{ id, closed: 0 }]] };
  let finish;
  const first = withMobileThread(
    db,
    7,
    id,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    withMobileThread(db, 7, id, async () => {}),
    { status: 409 },
  );
  finish();
  await first;
  await assert.rejects(
    withMobileThread(db, 7, id, async () => {
      throw new Error('失败');
    }),
    /失败/,
  );
  assert.equal(await withMobileThread(db, 7, id, async () => 42), 42);
});
test('保存回答按对话编号和顺序写入，不混入其他对话', async () => {
  const writes = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => writes.push('commit'),
    rollback: async () => writes.push('rollback'),
    release() {},
    execute: async (sql, args) => {
      writes.push([sql, args]);
      if (sql.includes('FOR UPDATE')) return [[{ id, title: '新的对话', closed: 0 }]];
      if (sql.includes('MAX(sequence_no)')) return [[{ value: 3 }]];
      return [{}];
    },
  };
  await insertThreadAnswer(
    { getConnection: async () => connection },
    7,
    id,
    ['answer', 7, '问题', '答案', '解析', '原话'],
    '新问题',
  );
  const insert = writes.find((value) => Array.isArray(value) && value[0].startsWith('INSERT'));
  assert.deepEqual(insert[1], ['answer', 7, '问题', '答案', '解析', '原话', id, 4]);
  assert.equal(writes.at(-1), 'commit');
});
test('删除对话只删除当前账号会话，不删除已收藏的错题', async () => {
  const handlers = new Map(),
    writes = [];
  const app = Object.fromEntries(
    ['get', 'post', 'patch', 'delete'].map((method) => [
      method,
      (route, ...actions) => handlers.set(method + ' ' + route, actions.at(-1)),
    ]),
  );
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    execute: async (sql, args) => {
      writes.push([sql, args]);
      return sql.startsWith('SELECT id FROM mobile_learning_answers')
        ? [[{ id: 'message' }]]
        : [[]];
    },
  };
  registerMobileThreads(app, {
    db: { execute: async () => [[{ id, closed: 0 }]], getConnection: async () => conn },
    auth() {},
    asyncRoute: (action) => action,
  });
  let result;
  await handlers.get('delete /api/mobile/threads/:id')(
    { params: { id }, user: { sub: 7 } },
    {
      json: (value) => {
        result = value;
      },
    },
  );
  assert.deepEqual(result.answerIds, ['message']);
  assert.deepEqual(writes.find(([sql]) => sql.startsWith('DELETE'))[1], [id, 7]);
  assert.equal(
    writes.some(([sql]) => /DELETE.*(wrong_questions|practice_questions)/.test(sql)),
    false,
  );
});
