import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { videoSignature, registerMobileVideos, MAX_VIDEO_BYTES } from './mobile-videos.js';
import jwt from 'jsonwebtoken';

test('检查实际视频文件头，拒绝伪装的视频文件', () => {
  assert.equal(videoSignature(Buffer.from('0000ftypisom')), 'video/mp4');
  assert.equal(videoSignature(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm');
  assert.throws(() => videoSignature(Buffer.from('<html>not a video</html>')));
  assert.throws(() => videoSignature(Buffer.alloc(0)));
  assert.equal(MAX_VIDEO_BYTES, 200 * 1024 * 1024);
});

async function harness(db, action) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mobile-video-'));
  const routes = new Map();
  const app = Object.fromEntries(
    ['get', 'post', 'delete'].map((method) => [
      method,
      (url, ...handlers) => routes.set(method + ' ' + url, handlers.at(-1)),
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
