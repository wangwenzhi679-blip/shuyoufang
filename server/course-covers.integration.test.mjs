import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ChapterImages, imageDefaults } from './chapter-images.js';
import { CourseCovers, decodeCoverUpload } from './course-covers.js';
import { createContentControl } from './admin-content.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9RYVFHYAAAAASUVORK5CYII=',
  'base64',
);
const image = 'data:image/png;base64,' + png.toString('base64');
const wait = async (check) => {
  for (let i = 0; i < 500; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('课程封面测试等待超时');
};
const gate = () => {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    release: () => resolve(),
  };
};

async function fixture(run) {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 8,
  });
  const suffix = '_cover_' + crypto.randomBytes(5).toString('hex'),
    tables = [
      'course_cover_drafts',
      'course_covers',
      'chapter_image_drafts',
      'chapter_images',
      'chapter_image_usage',
      'chapter_image_settings',
    ];
  const rewrite = (sql) =>
    tables.reduce((value, table) => value.replaceAll(table, table + suffix), sql);
  const adapt = (connection) => ({
    execute: (sql, args) => connection.execute(rewrite(sql), args),
    query: (sql, args) => connection.query(rewrite(sql), args),
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => connection.release(),
  });
  const db = { ...adapt(pool), getConnection: async () => adapt(await pool.getConnection()) };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'course-covers-'));
  const state = {
    db,
    pool,
    root,
    calls: 0,
    models: [],
    enabled: true,
    providerGate: null,
    runtimeGate: null,
    logs: [],
    actor: null,
  };
  let manager, covers, uid, server;
  const content = createContentControl(db);
  try {
    const [user] = await pool.execute(
      "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'课程封面隔离测试','test','disabled-test-only')",
      ['cover_' + crypto.randomBytes(6).toString('hex')],
    );
    uid = user.insertId;
    state.uid = uid;
    state.actor = { sub: uid, role: 'student', account: 'cover-test' };
    const [course] = await pool.execute(
      "INSERT INTO courses(user_id,title,description) VALUES(?,'微积分封面测试','PRIVATE_DESCRIPTION_NEVER_SEND')",
      [uid],
    );
    state.cid = course.insertId;
    const runtime = {
      snapshot: () => ({ generationEnabled: state.enabled }),
      run: async (fn) => {
        await state.runtimeGate?.promise;
        return fn();
      },
    };
    manager = new ChapterImages(db, {}, runtime, {
      root: path.join(root, 'chapters'),
      assertCourse: (...args) => content.assertCourse(...args),
    });
    await manager.init();
    clearInterval(manager.timer);
    manager.config = {
      ...imageDefaults,
      enabled: true,
      apiKey: 'test-no-provider-network',
      version: 0,
    };
    manager.generateImage = async (config, prompt) => {
      state.calls++;
      state.models.push(config.model);
      assert.ok(prompt.includes('微积分'));
      assert.ok(!prompt.includes('PRIVATE_DESCRIPTION_NEVER_SEND'));
      assert.ok(!prompt.includes('PRIVATE_MATERIAL_NEVER_SEND'));
      await state.providerGate?.promise;
      return { buffer: png, extension: 'png' };
    };
    covers = new CourseCovers(db, manager, {
      root: path.join(root, 'covers'),
      assertCourse: (...args) => content.assertCourse(...args),
    });
    await covers.init();
    clearInterval(covers.timer);
    state.manager = manager;
    state.covers = covers;
    covers.audit = async (connection, actor, action, courseId) =>
      state.logs.push({ actor, action, courseId });
    state.draft = async (draftId) => {
      const [[row]] = await db.execute('SELECT * FROM course_cover_drafts WHERE id=?', [draftId]);
      return row;
    };
    state.ready = async (draftId) =>
      wait(async () => {
        const row = await state.draft(draftId);
        return row?.status === 'ready' ? row : null;
      });
    state.failed = async (draftId) =>
      wait(async () => {
        const row = await state.draft(draftId);
        return row?.status === 'failed' ? row : null;
      });
    state.usage = async () => {
      const [[row]] = await db.query(
        'SELECT COALESCE(SUM(requests),0) total FROM chapter_image_usage',
      );
      return Number(row.total);
    };
    const app = express();
    app.use(express.json({ limit: '4.2mb' }));
    covers.register(
      app,
      (req, res, next) => {
        req.user = {
          ...state.actor,
          sub: req.headers.foreign ? uid + 1000000 : uid,
          role: req.headers.admin ? 'admin' : 'student',
        };
        next();
      },
      (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    );
    app.use((error, req, res, next) =>
      res.status(error.status || 500).json({ message: error.message }),
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    state.url = 'http://127.0.0.1:' + server.address().port;
    state.request = (suffix = '', body, headers = {}) =>
      fetch(state.url + '/api/courses/' + state.cid + '/cover' + suffix, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await run(state);
  } finally {
    state.runtimeGate?.release();
    state.providerGate?.release();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (covers) {
      clearInterval(covers.timer);
      await wait(() => covers.active === 0 && !covers.pumping);
    }
    if (manager) {
      clearInterval(manager.timer);
      await wait(() => manager.active === 0 && !manager.pumping);
    }
    try {
      for (const table of tables) await pool.query('DROP TABLE IF EXISTS ' + table + suffix);
      if (uid) await pool.execute('DELETE FROM users WHERE id=?', [uid]);
      await fs.rm(root, { recursive: true, force: true });
    } finally {
      await pool.end();
    }
  }
}

test(
  '课程封面：上传、权限、候选采用、原封面冲突、模板回退和共享额度',
  { timeout: 30000 },
  async () =>
    fixture(async (f) => {
      const { covers, cid, uid, actor, request } = f;
      const initial = await covers.state(cid, uid);
      assert.equal(initial.revision, '');
      assert.equal(initial.source, 'template');
      assert.equal(initial.has_image, false);
      assert.equal(f.calls, 0);
      assert.equal((await request('', undefined, { foreign: '1' })).status, 404);
      assert.equal((await request('', undefined, { admin: '1' })).status, 403);
      assert.equal((await request('/file')).status, 404);
      assert.equal((await request('/preview?draft=1')).status, 404);
      const list = await (
        await fetch(f.url + '/api/course-covers?q=' + encodeURIComponent('微积分'))
      ).json();
      assert.equal(list.total, 1);
      assert.equal(Number(list.items[0].id), cid);
      assert.equal(list.items[0].source, 'template');
      const foreign = await (
        await fetch(f.url + '/api/course-covers', { headers: { foreign: '1' } })
      ).json();
      assert.equal(foreign.total, 0);
      assert.equal((await fetch(f.url + '/api/course-covers?page=0')).status, 400);
      assert.equal(f.calls, 0, '读取封面和列表不调用计费接口');
      await assert.rejects(
        decodeCoverUpload('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')),
        /PNG/,
      );
      await assert.rejects(decodeCoverUpload(image.replace('image/png', 'image/jpeg')), /有效/);
      await assert.rejects(
        decodeCoverUpload(
          'data:image/png;base64,' + Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64'),
        ),
        /3 MB/,
      );
      await assert.rejects(
        decodeCoverUpload('data:image/png;base64,' + png.subarray(0, 40).toString('base64')),
        /有效/,
      );
      const corrupted = Buffer.from(png);
      corrupted[45] ^= 1;
      await assert.rejects(
        decodeCoverUpload('data:image/png;base64,' + corrupted.toString('base64')),
        /有效/,
      );
      await assert.rejects(
        covers.upload(cid, { image, expectedRevision: '' }, { ...actor, sub: uid + 1000000 }),
        (e) => e.status === 404,
      );
      const uploaded = await covers.upload(cid, { image, expectedRevision: '' }, actor);
      assert.equal(uploaded.source, 'upload');
      assert.ok(uploaded.revision.endsWith('.png'));
      const served = await request('/file?v=' + uploaded.revision);
      assert.equal(served.status, 200);
      assert.match(served.headers.get('Cache-Control'), /private/);
      assert.match(served.headers.get('Cache-Control'), /no-store/);
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
      await assert.rejects(
        covers.upload(cid, { image, expectedRevision: '' }, actor),
        (e) => e.status === 409,
      );
      await assert.rejects(
        covers.generate(cid, { instructions: '', acknowledgeCost: false }, actor),
        /确认/,
      );
      await assert.rejects(
        covers.generate(cid, { instructions: 'x'.repeat(501), acknowledgeCost: true }, actor),
        /500/,
      );
      f.providerGate = gate();
      const first = await covers.generate(
        cid,
        { instructions: '描绘微积分概念', acknowledgeCost: true },
        actor,
      );
      await wait(() => f.calls === 1);
      await assert.rejects(
        covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor),
        (e) => e.status === 409,
      );
      assert.equal((await covers.state(cid, uid)).revision, uploaded.revision);
      const changed = await covers.upload(
        cid,
        { image, expectedRevision: uploaded.revision },
        actor,
      );
      f.providerGate.release();
      f.providerGate = null;
      await wait(() => covers.active === 0);
      assert.equal((await f.draft(first.id)).status, 'discarded');
      assert.equal(
        (await covers.state(cid, uid)).revision,
        changed.revision,
        '候选生成不覆盖上传封面',
      );
      await assert.rejects(
        covers.adopt(cid, first.id, { expectedRevision: changed.revision }, actor),
        (e) => e.status === 409,
      );
      assert.equal((await request('/preview?draft=' + first.id)).status, 404);
      const second = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
      const candidate = await f.ready(second.id);
      const preview = await request('/preview?draft=' + second.id);
      assert.equal(preview.status, 200);
      assert.equal(
        (
          await request(
            '/drafts/' + second.id + '/adopt',
            { expectedRevision: changed.revision },
            { foreign: '1' },
          )
        ).status,
        404,
      );
      const adopted = await covers.adopt(
        cid,
        second.id,
        { expectedRevision: changed.revision },
        actor,
      );
      assert.equal(adopted.source, 'ai');
      assert.equal(adopted.revision, candidate.filename);
      await assert.rejects(fs.access(path.join(covers.root, changed.revision)));
      const parallel = await Promise.allSettled([
        covers.upload(cid, { image, expectedRevision: adopted.revision }, actor),
        covers.upload(cid, { image, expectedRevision: adopted.revision }, actor),
      ]);
      assert.equal(parallel.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(parallel.find((result) => result.status === 'rejected').reason.status, 409);
      const current = await covers.state(cid, uid),
        template = await covers.template(cid, { expectedRevision: current.revision }, actor);
      assert.equal(template.revision, '');
      assert.equal(template.source, 'template');
      assert.equal((await request('/file')).status, 404);
      const third = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
      await f.ready(third.id);
      await covers.template(cid, { expectedRevision: '' }, actor);
      await assert.rejects(
        covers.adopt(cid, third.id, { expectedRevision: '' }, actor),
        (e) => e.status === 409,
      );
      assert.equal((await f.draft(third.id)).status, 'discarded');
      const fourth = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
      await f.ready(fourth.id);
      await f.pool.execute("UPDATE courses SET title='微积分（新版）' WHERE id=?", [cid]);
      await assert.rejects(covers.adopt(cid, fourth.id, { expectedRevision: '' }, actor), /名称/);
      await covers.discard(cid, fourth.id, actor);
      f.manager.config.dailyLimit = await f.usage();
      const before = f.calls,
        limited = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
      assert.match((await f.failed(limited.id)).error_text, /额度/);
      assert.equal(f.calls, before);
      assert.ok(f.logs.some((log) => log.action === 'cover_upload'));
      assert.ok(f.logs.some((log) => log.action === 'cover_adopt'));
      assert.ok(f.logs.some((log) => log.action === 'cover_template'));
    }),
);

test(
  '课程封面：排队期间暂停AI不调用服务且不扣额度，课程暂停拦截修改',
  { timeout: 20000 },
  async () =>
    fixture(async (f) => {
      const { covers, cid, uid, actor } = f;
      f.runtimeGate = gate();
      const first = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
      await wait(async () => (await f.draft(first.id)).status === 'running');
      f.enabled = false;
      f.runtimeGate.release();
      f.runtimeGate = null;
      assert.match((await f.failed(first.id)).error_text, /暂停/);
      assert.equal(f.calls, 0);
      assert.equal(await f.usage(), 0);
      await assert.rejects(
        covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor),
        /暂停/,
      );
      f.enabled = true;
      await f.pool.execute(
        "UPDATE courses SET admin_status='paused',admin_reason='课程封面隔离测试' WHERE id=?",
        [cid],
      );
      await assert.rejects(covers.state(cid, uid), (e) => e.status === 423);
      await assert.rejects(
        covers.upload(cid, { image, expectedRevision: '' }, actor),
        (e) => e.status === 423,
      );
      await assert.rejects(
        covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor),
        (e) => e.status === 423,
      );
      assert.equal(f.calls, 0);
    }),
);

test('课程封面：重启中断任务失败，待执行任务恢复生成，课程删除级联', { timeout: 20000 }, async () =>
  fixture(async (f) => {
    const { covers, cid, actor } = f;
    covers.pumping = true;
    const job = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
    covers.pumping = false;
    await f.db.execute("UPDATE course_cover_drafts SET status='running' WHERE id=?", [job.id]);
    await covers.init();
    clearInterval(covers.timer);
    assert.match((await f.draft(job.id)).error_text, /重启/);
    assert.equal((await f.draft(job.id)).status, 'failed');
    assert.equal(f.calls, 0);
    covers.pumping = true;
    const queued = await covers.generate(cid, { instructions: '', acknowledgeCost: true }, actor);
    covers.pumping = false;
    await covers.init();
    clearInterval(covers.timer);
    await f.ready(queued.id);
    assert.equal(f.calls, 1);
    await covers.adopt(cid, queued.id, { expectedRevision: '' }, actor);
    await f.pool.execute('DELETE FROM courses WHERE id=?', [cid]);
    const [[count]] = await f.db.execute(
      'SELECT COUNT(*) total FROM course_covers WHERE course_id=?',
      [cid],
    );
    const [[drafts]] = await f.db.execute(
      'SELECT COUNT(*) total FROM course_cover_drafts WHERE course_id=?',
      [cid],
    );
    assert.equal(Number(count.total), 0);
    assert.equal(Number(drafts.total), 0);
  }),
);

const tinyJpeg =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==';
test('课程封面：池化小JPG可解码，缺失图像流的伪JPG被拒绝', async () => {
  const result = await decodeCoverUpload('data:image/jpeg;base64,' + tinyJpeg);
  assert.equal(result.extension, 'jpg');
  assert.ok(result.buffer.length < 1000);
  const jpeg = Buffer.from(tinyJpeg, 'base64'),
    scan = jpeg.indexOf(Buffer.from([255, 218]));
  assert.ok(scan > 0);
  const noPixels = Buffer.concat([jpeg.subarray(0, scan), Buffer.from([255, 217])]);
  await assert.rejects(
    decodeCoverUpload('data:image/jpeg;base64,' + noPixels.toString('base64')),
    /有效/,
  );
});
test('课程封面：预留额度期间取消任务，不启动付费调用并归还额度', { timeout: 20000 }, async () =>
  fixture(async (f) => {
    const entered = gate(),
      resume = gate(),
      reserve = f.manager.reserve.bind(f.manager);
    f.manager.reserve = async (...args) => {
      const value = await reserve(...args);
      entered.release();
      await resume.promise;
      return value;
    };
    try {
      const job = await f.covers.generate(
        f.cid,
        { instructions: '', acknowledgeCost: true },
        f.actor,
      );
      await entered.promise;
      assert.equal(await f.usage(), 1);
      await f.covers.template(f.cid, { expectedRevision: '' }, f.actor);
      resume.release();
      await wait(() => f.covers.active === 0 && !f.covers.pumping);
      assert.equal((await f.draft(job.id)).status, 'discarded');
      assert.equal(f.calls, 0);
      assert.equal(await f.usage(), 0);
    } finally {
      resume.release();
    }
  }),
);
test('课程封面：删除课程清理原封面、候选及在途任务文件', { timeout: 20000 }, async () =>
  fixture(async (f) => {
    const uploaded = await f.covers.upload(f.cid, { image, expectedRevision: '' }, f.actor);
    const job = await f.covers.generate(
      f.cid,
      { instructions: '', acknowledgeCost: true },
      f.actor,
    );
    const candidate = await f.ready(job.id);
    assert.equal((await f.covers.removeCourse(f.cid, f.uid + 1000000)).affectedRows, 0);
    await fs.access(path.join(f.covers.root, uploaded.revision));
    await fs.access(path.join(f.covers.root, candidate.filename));
    await f.pool.execute("UPDATE courses SET admin_status='paused' WHERE id=?", [f.cid]);
    const deleted = await f.covers.removeCourse(f.cid, f.uid);
    assert.equal(deleted.affectedRows, 1);
    assert.equal(deleted.cleanupFailed, false);
    assert.deepEqual(await fs.readdir(f.covers.root), []);
    const [[count]] = await f.db.execute(
      'SELECT COUNT(*) total FROM course_cover_drafts WHERE course_id=?',
      [f.cid],
    );
    assert.equal(Number(count.total), 0);
    const [created] = await f.pool.execute(
      "INSERT INTO courses(user_id,title,description) VALUES(?,'微积分删除并发测试','')",
      [f.uid],
    );
    const courseId = created.insertId;
    f.providerGate = gate();
    await f.covers.generate(courseId, { instructions: '', acknowledgeCost: true }, f.actor);
    await wait(() => f.calls === 2);
    await f.covers.removeCourse(courseId, f.uid);
    f.providerGate.release();
    f.providerGate = null;
    await wait(() => f.covers.active === 0 && !f.covers.pumping);
    assert.deepEqual(await fs.readdir(f.covers.root), []);
  }),
);

test('课程封面按学习者保存的生图模型调用供应商', { timeout: 20000 }, () =>
  fixture(async (s) => {
    await s.pool.execute('INSERT INTO user_preferences(user_id,settings_json) VALUES(?,?)', [
      s.uid,
      JSON.stringify({ imageModel: 'doubao-seedream-4-5-251128' }),
    ]);
    const draft = await s.covers.generate(
      s.cid,
      { instructions: '', acknowledgeCost: true },
      s.actor,
    );
    await s.ready(draft.id);
    assert.deepEqual(s.models, ['doubao-seedream-4-5-251128']);
  }),
);
