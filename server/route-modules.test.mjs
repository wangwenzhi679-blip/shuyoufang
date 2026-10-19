import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createAccountService } from './account-service.js';
import { createCourseData } from './course-data.js';
import { registerReadingAdapters } from './reading-adapters.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerAssistantRoutes } from './assistant-routes.js';
import { registerPracticeRoutes } from './practice-routes.js';
import { registerCourseQueryRoutes } from './course-query-routes.js';
import { registerMaterialReadingRoutes } from './material-reading-routes.js';
import { registerChapterGenerationRoutes } from './chapter-generation-routes.js';
import { registerMaterialRoutes } from './material-routes.js';
import { registerGenerationRunner } from './generation-runner.js';

function fixture() {
  const routes = new Map();
  const registrations = [];
  const app = { locals: {} };
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (path, ...handlers) => {
      const key = `${method} ${path}`;
      registrations.push([key, handlers]);
      // Express 按注册顺序匹配；保留已有模块对相同路径的前后置处理。
      if (!routes.has(key)) routes.set(key, handlers);
    };
  }
  const unexpected = async () => {
    throw new Error('不应访问数据库或外部服务');
  };
  const auth = (_req, _res, next) => next();
  const context = {
    db: { query: unexpected, execute: unexpected },
    auth,
    asyncRoute: (handler) => handler,
    validationError: (res) => res.status(400).json({ message: 'invalid' }),
    getOwnedCourse: async () => null,
    getOwnedMaterial: async () => ({ course: null, material: null }),
    serviceSettings: { configured: () => false, snapshot: () => ({}) },
    parseId: (_res, value) => Number(value),
    upload: { array: () => auth },
    contentControl: { assertCourse: unexpected },
    askDeepSeek: unexpected,
    accountModels: () => [],
    generationSignal: () => AbortSignal.timeout(1000),
  };
  return { app, routes, registrations, context };
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
    end() {
      return this;
    },
  };
}

test('业务模块可独立注册，无数据库操作，所有非公开接口保留鉴权', () => {
  const { app, routes, registrations, context } = fixture();
  registerReadingAdapters(app, context);
  registerAuthRoutes(app, context);
  registerAssistantRoutes(app, context);
  Object.assign(context, registerPracticeRoutes(app, context));
  registerCourseQueryRoutes(app, context);
  registerMaterialReadingRoutes(app, context);
  Object.assign(context, registerChapterGenerationRoutes(app, context));
  registerMaterialRoutes(app, context);
  registerGenerationRunner(app, context);
  for (const [key, handlers] of registrations) {
    if (
      !key.includes('/api/auth/') ||
      key === 'get /api/auth/me' ||
      key === 'post /api/auth/bind-email'
    ) {
      assert.equal(handlers[0], context.auth, key);
    }
  }
  for (const key of [
    'post /api/auth/register',
    'post /api/assistant/ask',
    'post /api/generation-jobs',
    'get /api/courses',
    'post /api/courses/:courseId/materials',
  ]) {
    assert.ok(routes.has(key), key);
  }
});

test('注册校验与邮件服务未配置均在数据库写入前返回', async () => {
  const { app, routes, context } = fixture();
  registerAuthRoutes(app, context);
  const handler = routes.get('post /api/auth/register').at(-1);
  let res = response();
  await handler({ body: {} }, res);
  assert.equal(res.code, 400);
  res = response();
  await handler(
    {
      body: {
        account: 'student01',
        email: 'student@example.com',
        nickname: '同学',
        password: 'password01',
      },
    },
    res,
  );
  assert.equal(res.code, 503);
});

test('课程归属控制失败时停止查询；资料读取拒绝无归属课程', async () => {
  const { app, routes, context } = fixture();
  const data = createCourseData({ db: context.db, contentControl: context.contentControl });
  await assert.rejects(data.getOwnedCourse(1, 2), /不应访问/);
  registerCourseQueryRoutes(app, context);
  const res = response();
  await routes.get('get /api/courses/:courseId').at(-1)(
    { params: { courseId: '2' }, user: { sub: 1 } },
    res,
  );
  assert.equal(res.code, 404);
});

test('账号服务保留令牌版本与公开用户信息，不暴露密码哈希', () => {
  const secret = 'unit-test-only-secret';
  const service = createAccountService({ secret });
  const user = {
    id: 1,
    account: 'student01',
    nickname: '同学',
    role: 'student',
    status_version: 3,
    password_hash: 'not-public',
  };
  const claims = jwt.verify(service.issue(user), secret);
  assert.equal(claims.sub, 1);
  assert.equal(claims.version, 3);
  assert.equal(claims.role, 'student');
  assert.equal('password_hash' in service.userView(user), false);
});
