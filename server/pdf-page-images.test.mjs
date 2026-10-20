import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPdfPageImages } from './pdf-page-images.js';
import { createMaterialService } from './material-service.js';
import { registerMaterialRoutes } from './material-routes.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4h8AAAAASUVORK5CYII=',
  'base64',
);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-page-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'source.pdf'), 'synthetic');
  return { root, material: { id: 12, stored_name: 'source.pdf' } };
}

test('同页并发请求只渲染一次，完成后才发布图片并复用缓存', async (t) => {
  const { root, material } = await fixture(t);
  let calls = 0,
    ready,
    release;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const read = createPdfPageImages({
    uploadRoot: root,
    previewRoot: root,
    render: async (_tool, args) => {
      calls++;
      assert.ok(args.includes('-cropbox'));
      await fs.writeFile(`${args.at(-1)}.png`, PNG.subarray(0, 8));
      ready();
      await gate;
      await fs.writeFile(`${args.at(-1)}.png`, PNG);
    },
  });
  const first = read(material, 1),
    second = read(material, 1);
  await started;
  await assert.rejects(fs.access(path.join(root, 'original-12-1.png')));
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    path.join(root, 'original-12-1.png'),
    path.join(root, 'original-12-1.png'),
  ]);
  assert.deepEqual(await fs.readFile(await read(material, 1)), PNG);
  assert.equal(calls, 1);
  assert.deepEqual((await fs.readdir(root)).sort(), ['original-12-1.png', 'source.pdf']);
});

test('损坏缓存和渲染失败可恢复，不保留半成品或永久失败的请求锁', async (t) => {
  const { root, material } = await fixture(t);
  await fs.writeFile(path.join(root, 'original-12-1.png'), 'broken');
  let calls = 0;
  const read = createPdfPageImages({
    uploadRoot: root,
    previewRoot: root,
    render: async (_tool, args) => {
      calls++;
      await fs.writeFile(`${args.at(-1)}.png`, calls === 1 ? PNG.subarray(0, 8) : PNG);
    },
  });
  await assert.rejects(read(material, 1), /生成不完整/);
  assert.equal(
    (await fs.readdir(root)).some((name) => name.startsWith('original-temp-')),
    false,
  );
  assert.deepEqual(await fs.readFile(await read(material, 1)), PNG);
  assert.equal(calls, 2);
});

test('章节与分页阅读的独立入口共享同页渲染，不能读取半张缓存', async (t) => {
  const { root, material } = await fixture(t);
  let calls = 0,
    started,
    finish;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const options = {
    uploadRoot: root,
    previewRoot: root,
    render: async (_tool, args) => {
      calls++;
      await fs.writeFile(`${args.at(-1)}.png`, PNG.subarray(0, 8));
      started();
      await gate;
      await fs.writeFile(`${args.at(-1)}.png`, PNG);
    },
  };
  const chapterRead = createPdfPageImages(options);
  const pagedRead = createPdfPageImages(options);
  const first = chapterRead(material, 2);
  await ready;
  const second = pagedRead(material, 2);
  await assert.rejects(fs.access(path.join(root, 'original-12-2.png')));
  finish();
  const files = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(files[0], files[1]);
  assert.deepEqual(await fs.readFile(files[1]), PNG);
});

test('原资料在渲染期间被删除时不能发布孤立缓存', async (t) => {
  const { root, material } = await fixture(t);
  const read = createPdfPageImages({
    uploadRoot: root,
    previewRoot: root,
    render: async (_tool, args) => {
      await fs.writeFile(`${args.at(-1)}.png`, PNG);
      await fs.rm(path.join(root, 'source.pdf'));
    },
  });
  await assert.rejects(read(material, 1), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(root), []);
});

test('非法原页参数在渲染前拒绝', async (t) => {
  const { root, material } = await fixture(t);
  let calls = 0;
  const read = createPdfPageImages({
    uploadRoot: root,
    previewRoot: root,
    render: async () => {
      calls++;
    },
  });
  for (const [source, page] of [
    [material, 0],
    [material, 1.5],
    [material, 2001],
    [{ ...material, stored_name: '../outside.pdf' }, 1],
    [{ ...material, id: 'bad' }, 1],
  ])
    await assert.rejects(read(source, page), (error) => error.status === 400);
  assert.equal(calls, 0);
});

test('删除资料同时清理其原页和旧阅读缓存，保留其他资料图片', async (t) => {
  const { root, material } = await fixture(t);
  for (const name of ['original-12-1.png', 'reading-12-2.png', 'original-13-1.png'])
    await fs.writeFile(path.join(root, name), PNG);
  const service = createMaterialService({ uploadRoot: root, previewRoot: root });
  assert.equal(service.removeMaterialFiles([material]), false);
  assert.deepEqual(await fs.readdir(root), ['original-13-1.png']);
});

test('只有成功删除所属资料才停止相关课程生成，不能干扰其他课程', async () => {
  for (const affectedRows of [0, 1]) {
    const routes = {},
      aborted = [],
      queries = [];
    registerMaterialRoutes(
      {
        locals: { adminTasks: { course: { abortCourse: (id) => aborted.push(id) } } },
        post() {},
        get() {},
        put() {},
        delete: (url, ...handlers) => {
          routes[url] = handlers.at(-1);
        },
      },
      {
        auth() {},
        asyncRoute: (handler) => handler,
        upload: { array: () => () => {} },
        parseId: (_res, value) => Number(value),
        getOwnedMaterial: async () => ({ course: { id: 4 }, material: { id: 12 } }),
        db: {
          execute: async (sql) => {
            queries.push(sql);
            return [{ affectedRows }];
          },
        },
        removeMaterialFiles: () => false,
      },
    );
    const res = {
      status(code) {
        this.code = code;
        return this;
      },
      json() {},
    };
    await routes['/api/courses/:courseId/materials/:materialId'](
      { params: { courseId: '4', materialId: '12' }, user: { sub: 2 } },
      res,
    );
    assert.deepEqual(aborted, affectedRows ? [4] : []);
    assert.equal(
      queries.some((sql) => sql.includes('course_chapter_drafts')),
      Boolean(affectedRows),
    );
  }
});
