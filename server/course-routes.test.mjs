import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCourseRoutes } from './course-routes.js';

function setup(overrides = {}) {
  const routes = new Map();
  const auth = () => {};
  const dependencies = {
    auth,
    asyncRoute: (handler) => handler,
    parseId: (_res, value) => Number(value),
    validationError: (res) => res.status(400).json({ message: 'invalid' }),
    getOwnedCourse: async () => ({ id: 1 }),
    db: {
      execute: async () => {
        throw new Error('Unexpected database write');
      },
    },
    ...overrides,
  };
  const app = Object.fromEntries(
    ['put', 'post', 'delete'].map((method) => [
      method,
      (path, ...handlers) => routes.set(`${method} ${path}`, handlers),
    ]),
  );
  registerCourseRoutes(app, dependencies);
  return {
    routes,
    auth,
    call: (key, body = {}) => {
      const response = {
        code: 200,
        body: null,
        status(code) {
          this.code = code;
          return this;
        },
        json(value) {
          this.body = value;
          return this;
        },
        end() {
          return this;
        },
      };
      const handler = routes.get(key).at(-1);
      return handler(
        { params: { courseId: '1', chapterId: '2' }, user: { sub: 3 }, body },
        response,
      ).then(() => response);
    },
  };
}

test('六个课程写入接口全部保留鉴权中间件', () => {
  const { routes, auth } = setup();
  assert.equal(routes.size, 6);
  for (const handlers of routes.values()) assert.equal(handlers[0], auth);
});

test('课程更新拒绝无效输入及无归属课程，不写入数据库', async () => {
  const context = setup({ getOwnedCourse: async () => null });
  assert.equal((await context.call('put /api/courses/:courseId', { title: '' })).code, 400);
  assert.equal((await context.call('put /api/courses/:courseId', { title: '数学' })).code, 404);
});

test('章节排序不接受重复或缺失的章节编号', async () => {
  const context = setup({ db: { execute: async () => [[{ id: 1 }, { id: 2 }]] } });
  for (const chapterIds of [[1, 1], [1]]) {
    const response = await context.call('put /api/courses/:courseId/chapters/order', {
      chapterIds,
    });
    assert.equal(response.code, 400);
  }
});

test('章节排序成功提交，写入失败回滚，两种情况均释放连接', async () => {
  for (const fail of [false, true]) {
    const events = [];
    const connection = {
      beginTransaction: async () => events.push('begin'),
      execute: async (_sql, values) => {
        events.push(values);
        if (fail) throw new Error('write failed');
      },
      commit: async () => events.push('commit'),
      rollback: async () => events.push('rollback'),
      release: () => events.push('release'),
    };
    const context = setup({
      db: {
        execute: async () => [[{ id: 1 }, { id: 2 }]],
        getConnection: async () => connection,
      },
    });
    const action = context.call('put /api/courses/:courseId/chapters/order', {
      chapterIds: [2, 1],
    });
    if (fail) await assert.rejects(action, /write failed/);
    else assert.equal((await action).code, 204);
    assert.equal(events.at(-2), fail ? 'rollback' : 'commit');
    assert.equal(events.at(-1), 'release');
    assert.deepEqual(events[1], [1, 2, 1]);
  }
});
