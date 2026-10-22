import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  videoSignature,
  registerMobileVideos,
  ensureMobileVideos,
  MAX_VIDEO_BYTES,
} from './mobile-videos.js';
import jwt from 'jsonwebtoken';

test('检查实际视频文件头，拒绝伪装的视频文件', () => {
  assert.equal(videoSignature(Buffer.from('0000ftypisom')), 'video/mp4');
  assert.equal(videoSignature(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm');
  assert.throws(() => videoSignature(Buffer.from('<html>not a video</html>')));
  assert.throws(() => videoSignature(Buffer.alloc(0)));
  assert.equal(MAX_VIDEO_BYTES, 500 * 1024 * 1024 - 1);
});

async function harness(db, action) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mobile-video-'));
  const routes = new Map();
  routes.handlers = new Map();
  const app = Object.fromEntries(
    ['get', 'post', 'delete', 'patch'].map((method) => [
      method,
      (url, ...handlers) => {
        routes.set(method + ' ' + url, handlers.at(-1));
        routes.handlers.set(method + ' ' + url, handlers);
      },
    ]),
  );
  const secret = 'testing-only-secret';
  try {
    registerMobileVideos(app, { db, auth() {}, asyncRoute: (fn) => fn, secret, root });
    await action(routes, secret);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('用户只能为自己的视频取得播放授权', async () => {
  const queries = [];
  await harness(
    {
      execute: async (sql, values) => {
        queries.push([sql, values]);
        return [[]];
      },
    },
    async (routes) => {
      await assert.rejects(
        routes.get('post /api/mobile/videos/:id/play')(
          { user: { sub: 7 }, params: { id: 'other-video' } },
          {},
        ),
        /无权访问/,
      );
      assert.deepEqual(queries[0][1], ['other-video', 7]);
    },
  );
});

test('已有个人视频默认不公开，迁移只新增公开标记', async () => {
  const queries = [];
  await ensureMobileVideos({
    query: async (sql) => {
      queries.push(sql);
      return [[]];
    },
  });
  assert(queries[0].includes('is_public BOOLEAN NOT NULL DEFAULT FALSE'));
  assert(queries.some((sql) => sql.startsWith('ALTER TABLE') && sql.includes('DEFAULT FALSE')));
  assert(!queries.some((sql) => /^\s*(UPDATE|DELETE)\b/.test(sql)));
});

test('公共视频对其他用户可播放，播放票据仍绑定观看者，且下架后立即失效', async () => {
  const queries = [];
  let published = true;
  await harness(
    {
      execute: async (sql, params) => {
        queries.push([sql, params]);
        if (sql.startsWith('SELECT id FROM mobile_videos'))
          return sql.includes('OR is_public=TRUE') && published ? [[{ id: 'public-video' }]] : [[]];
        if (sql.startsWith('SELECT status_version')) return [[{ status_version: 3 }]];
        if (sql.startsWith('SELECT v.stored_name')) {
          assert.deepEqual(params, ['7', 'public-video', '7']);
          assert(sql.includes('(v.user_id=? OR v.is_public=TRUE)'));
          return [[]];
        }
        throw Error(sql);
      },
    },
    async (routes, secret) => {
      const res = {
        json(value) {
          this.body = value;
        },
      };
      await routes.get('post /api/mobile/videos/:id/play')(
        { user: { sub: 7 }, params: { id: 'public-video' } },
        res,
      );
      const ticket = new URL(res.body.url, 'https://shuyoufang.asia').searchParams.get('ticket');
      const claims = jwt.verify(ticket, secret, { audience: 'mobile-video' });
      assert.equal(claims.sub, '7');
      assert.equal(claims.version, 3);
      published = false;
      await assert.rejects(
        routes.get('get /api/mobile/videos/:id/content')(
          { params: { id: 'public-video' }, query: { ticket } },
          {},
        ),
        /登录状态已变化/,
      );
      await assert.rejects(
        routes.get('post /api/mobile/videos/:id/play')(
          { user: { sub: 7 }, params: { id: 'public-video' } },
          {},
        ),
        /无权访问/,
      );
    },
  );
});

test('发布入口在接收文件前拒绝普通用户，公共视频不允许用个人删除接口删除', async () => {
  await harness(
    {
      execute: async (sql) => {
        assert(sql.includes('user_id=? AND is_public=FALSE'));
        return [[]];
      },
    },
    async (routes) => {
      const guard = routes.handlers.get('post /api/admin/videos')[1];
      let code, body;
      guard(
        { user: { role: 'student' } },
        {
          status(value) {
            code = value;
            return this;
          },
          json(value) {
            body = value;
          },
        },
        () => {
          throw Error('普通用户不能通过发布鉴权');
        },
      );
      assert.equal(code, 403);
      assert.match(body.message, /管理员/);
      await assert.rejects(
        routes.get('delete /api/mobile/videos/:id')(
          { user: { sub: 7 }, params: { id: 'public-video' } },
          {},
        ),
        /无权访问/,
      );
    },
  );
});
test('播放授权绑定单个视频，有效期一小时', async () => {
  const db = {
    execute: async (sql, values) =>
      sql.startsWith('SELECT id FROM mobile_videos')
        ? [[{ id: values[0] }]]
        : [[{ status_version: 4 }]],
  };
  await harness(db, async (routes, secret) => {
    const res = {
      json(value) {
        this.body = value;
      },
    };
    await routes.get('post /api/mobile/videos/:id/play')(
      { user: { sub: 7 }, params: { id: 'video-1' } },
      res,
    );
    const token = new URL(res.body.url, 'https://shuyoufang.asia').searchParams.get('ticket');
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'], audience: 'mobile-video' });
    assert.equal(claims.video, 'video-1');
    assert.equal(claims.sub, '7');
    assert.equal(claims.exp - claims.iat, 3600);
    await assert.rejects(
      routes.get('get /api/mobile/videos/:id/content')(
        { params: { id: 'video-2' }, query: { ticket: token } },
        {},
      ),
      /无权播放/,
    );
  });
});
test('删除他人视频不会修改数据库或文件', async () => {
  const queries = [];
  await harness(
    {
      execute: async (sql, values) => {
        queries.push([sql, values]);
        return [[]];
      },
    },
    async (routes) => {
      await assert.rejects(
        routes.get('delete /api/mobile/videos/:id')(
          { user: { sub: 9 }, params: { id: 'not-owned' } },
          {},
        ),
        /无权访问/,
      );
      assert.equal(queries.length, 1);
      assert.deepEqual(queries[0][1], ['not-owned', 9]);
    },
  );
});
