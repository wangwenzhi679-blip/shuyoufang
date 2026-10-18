import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import { ChapterImages, imageDefaults } from './chapter-images.js';
import { ServiceSettings } from './service-settings.js';
import { RuntimeLimits } from './runtime-limits.js';

test(
  '学习端配图：后台生成、重复拦截、保留原图、预览采用、冲突及失败限额',
  { timeout: 20000 },
  async () => {
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 8,
    });
    const suffix = '_manage_test_' + Date.now(),
      tables = [
        'chapter_image_drafts',
        'chapter_images',
        'chapter_image_usage',
        'chapter_image_settings',
      ];
    const rewrite = (sql) => tables.reduce((s, t) => s.replaceAll(t, t + suffix), sql);
    const adapt = (c) => ({
      execute: (s, a) => c.execute(rewrite(s), a),
      query: (s, a) => c.query(rewrite(s), a),
      beginTransaction: () => c.beginTransaction(),
      commit: () => c.commit(),
      rollback: () => c.rollback(),
      release: () => c.release(),
    });
    const db = { ...adapt(pool), getConnection: async () => adapt(await pool.getConnection()) };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chapter-image-management-'));
    let uid,
      cid,
      chid,
      manager,
      server,
      calls = 0,
      mode = 'ok',
      resume;
    const actor = { sub: 1, role: 'admin', account: 'test' },
      logs = [],
      audit = async (db, actor, action, ...args) => {
        logs.push({ action, args });
      };
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(40).fill(0)]);
    const fetcher = async (url, options) => {
      calls++;
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'doubao-seedream-4-0-250828');
      assert.equal(request.size, '1K');
      const prompt = request.prompt;
      assert.ok(!prompt.includes('PRIVATE_BODY'));
      assert.ok(prompt.includes('矩阵'));
      if (mode === 'gate')
        await new Promise((r) => {
          resume = r;
        });
      if (mode === 'fail')
        return new Response(JSON.stringify({ error: { message: 'PRIVATE_SECRET' } }), {
          status: 401,
        });
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    };
    const wait = async (check) => {
      for (let i = 0; i < 400; i++) {
        const value = await check();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('Timed out');
    };
    const draft = async (draftId) => {
      const [[row]] = await db.execute('SELECT * FROM chapter_image_drafts WHERE id=?', [draftId]);
      return row;
    };
    const ready = async (draftId) =>
      wait(async () => {
        const row = await draft(draftId);
        return row?.status === 'ready' ? row : null;
      });
    try {
      const [user] = await pool.execute(
        "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'管理配图测试','test','disabled')",
        ['image_manage_' + Date.now()],
      );
      uid = user.insertId;
      await pool.execute('INSERT INTO user_preferences(user_id,settings_json) VALUES(?,?)', [
        uid,
        JSON.stringify({ imageModel: 'doubao-seedream-4-0-250828' }),
      ]);
      const [course] = await pool.execute(
        "INSERT INTO courses(user_id,title) VALUES(?,'线性代数')",
        [uid],
      );
      cid = course.insertId;
      const [chapter] = await pool.execute(
        "INSERT INTO course_chapters(course_id,title,description) VALUES(?,'矩阵','PRIVATE_BODY')",
        [cid],
      );
      chid = chapter.insertId;
      manager = new ChapterImages(
        db,
        new ServiceSettings(db, process.env.JWT_SECRET),
        { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() },
        { root, fetcher },
      );
      await manager.init();
      await manager.save(
        { ...imageDefaults, enabled: true, apiKey: 'test-only', version: 0 },
        actor,
        audit,
      );
      await manager.ensure(uid, cid, chid);
      await wait(async () => (await manager.ensure(uid, cid, chid)).status === 'done');
      const originalRevision = (await manager.ensure(uid, cid, chid)).revision;
      const [[original]] = await db.execute('SELECT * FROM chapter_images WHERE chapter_id=?', [
        chid,
      ]);
      const management = manager.management;
      await assert.rejects(
        management.generate(chid, { instructions: '', acknowledgeCost: false }, actor, audit),
        /确认/,
      );
      await assert.rejects(
        management.generate(
          chid,
          { instructions: 'x'.repeat(501), acknowledgeCost: true },
          actor,
          audit,
        ),
        /500/,
      );
      await assert.rejects(
        management.generate(0, { instructions: '', acknowledgeCost: true }, actor, audit),
        /参数/,
      );
      mode = 'gate';
      const duplicates = await Promise.allSettled([
        management.generate(
          chid,
          { instructions: '突出矩阵概念，水墨淡一些', acknowledgeCost: true },
          actor,
          audit,
        ),
        management.generate(chid, { instructions: '', acknowledgeCost: true }, actor, audit),
      ]);
      assert.equal(duplicates.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(duplicates.find((x) => x.status === 'rejected').reason.status, 409);
      const first = duplicates.find((x) => x.status === 'fulfilled').value;
      await wait(() => Boolean(resume));
      await assert.rejects(management.adopt(first.id, actor, audit), (e) => e.status === 409);
      assert.equal((await manager.ensure(uid, cid, chid)).revision, originalRevision);
      resume();
      mode = 'ok';
      await ready(first.id);
      assert.equal(
        (await manager.ensure(uid, cid, chid)).revision,
        originalRevision,
        '候选图生成后原图继续展示',
      );
      assert.deepEqual(await fs.readFile(await management.file(chid, first.id)), png);
      await assert.rejects(management.file(chid + 1000000, first.id), (e) => e.status === 404);
      const state = await management.state(chid);
      assert.equal(state.draft_status, 'ready');
      assert.equal(state.title, '矩阵');
      await management.discard(first.id, actor, audit);
      assert.equal((await manager.ensure(uid, cid, chid)).revision, originalRevision);
      await assert.rejects(management.file(chid, first.id), (e) => e.status === 404);
      const second = await management.generate(
        chid,
        { instructions: '', acknowledgeCost: true },
        actor,
        audit,
      );
      const candidate = await ready(second.id);
      await management.adopt(second.id, actor, audit);
      const [[adopted]] = await db.execute('SELECT * FROM chapter_images WHERE chapter_id=?', [
        chid,
      ]);
      assert.equal(adopted.filename, candidate.filename);
      assert.notEqual(adopted.filename, original.filename);
      assert.notEqual(
        (await manager.ensure(uid, cid, chid)).revision,
        originalRevision,
        '采用后图片缓存版本改变',
      );
      await assert.rejects(fs.access(path.join(root, original.filename)));
      await assert.rejects(management.adopt(second.id, actor, audit), (e) => e.status === 409);
      const third = await management.generate(
        chid,
        { instructions: '', acknowledgeCost: true },
        actor,
        audit,
      );
      await ready(third.id);
      await pool.execute("UPDATE course_chapters SET title='矩阵（新版）' WHERE id=?", [chid]);
      await assert.rejects(management.adopt(third.id, actor, audit), /名称已变化/);
      await management.discard(third.id, actor, audit);
      mode = 'fail';
      const callsBefore = calls;
      const failed = await management.generate(
        chid,
        { instructions: '', acknowledgeCost: true },
        actor,
        audit,
      );
      await wait(async () => (await draft(failed.id)).status === 'failed');
      await manager.pump();
      assert.equal(calls, callsBefore + 1);
      assert.ok(!(await draft(failed.id)).error_text.includes('PRIVATE_SECRET'));
      const [[retained]] = await db.execute(
        'SELECT filename FROM chapter_images WHERE chapter_id=?',
        [chid],
      );
      assert.equal(retained.filename, adopted.filename);
      manager.reserve = async () => false;
      const limited = await management.generate(
        chid,
        { instructions: '', acknowledgeCost: true },
        actor,
        audit,
      );
      await wait(async () => (await draft(limited.id)).status === 'failed');
      assert.match((await draft(limited.id)).error_text, /额度/);
      assert.equal(calls, callsBefore + 1);
      assert.ok(logs.some((log) => log.action === 'image_adopt'));
      assert.ok(logs.some((log) => log.action === 'image_discard'));
      const app = express();
      app.use(express.json());
      management.register(
        app,
        (req, res, next) => {
          req.user = { sub: req.headers.foreign ? uid + 1000000 : uid };
          next();
        },
        (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
      );
      app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      const endpoint = `http://127.0.0.1:${server.address().port}/api/courses/${cid}/chapters/${chid}/illustration`;
      assert.equal((await fetch(endpoint + '/draft', { headers: { foreign: '1' } })).status, 404);
      assert.equal((await fetch(endpoint + '/draft')).status, 200);
      const listEndpoint = `http://127.0.0.1:${server.address().port}/api/chapter-illustrations`;
      const ownList = await (
        await fetch(listEndpoint + '?q=' + encodeURIComponent('线性代数'))
      ).json();
      assert.equal(ownList.total, 1);
      assert.equal(Number(ownList.items[0].id), chid);
      const foreignList = await (await fetch(listEndpoint, { headers: { foreign: '1' } })).json();
      assert.equal(foreignList.total, 0);
      assert.equal(foreignList.items.length, 0);
      assert.equal((await fetch(listEndpoint + '?page=0')).status, 400);
      assert.equal(
        (await fetch(endpoint + '/preview?draft=' + third.id, { headers: { foreign: '1' } }))
          .status,
        404,
      );
      assert.equal(
        (
          await fetch(endpoint + '/drafts/' + limited.id + '/discard', {
            method: 'POST',
            headers: { foreign: '1' },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await fetch(endpoint + '/regenerate', {
            method: 'POST',
            headers: { foreign: '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ instructions: '', acknowledgeCost: true }),
          })
        ).status,
        404,
      );
      const [otherChapter] = await pool.execute(
        "INSERT INTO course_chapters(course_id,title) VALUES(?,'另一个章节')",
        [cid],
      );
      assert.equal(
        (
          await fetch(
            endpoint.replace('/chapters/' + chid, '/chapters/' + otherChapter.insertId) +
              '/drafts/' +
              limited.id +
              '/discard',
            { method: 'POST' },
          )
        ).status,
        404,
      );
    } finally {
      resume?.();
      if (server) await new Promise((r) => server.close(r));
      if (manager) {
        clearInterval(manager.timer);
        await wait(() => manager.active === 0);
      }
      for (const table of tables) await pool.query('DROP TABLE IF EXISTS ' + table + suffix);
      if (uid) await pool.execute('DELETE FROM users WHERE id=?', [uid]);
      for (const name of await fs.readdir(root)) await fs.unlink(path.join(root, name));
      await fs.rmdir(root);
      await pool.end();
    }
  },
);

const deferred = () => {
  let resolve;
  const value = {
    settled: false,
    promise: new Promise((r) => {
      resolve = r;
    }),
  };
  value.resolve = () => {
    value.settled = true;
    resolve();
  };
  return value;
};
async function waitFor(check, message = 'Timed out waiting for image regression test') {
  for (let i = 0; i < 400; i++) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function withImageRaceFixture(run) {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 8,
  });
  const unique = crypto.randomBytes(6).toString('hex'),
    suffix = '_race_' + unique;
  const tables = [
    'chapter_image_drafts',
    'chapter_images',
    'chapter_image_usage',
    'chapter_image_settings',
  ];
  const rewrite = (sql) =>
    tables.reduce((result, table) => result.replaceAll(table, table + suffix), sql);
  const hooks = { before: null, after: null },
    releases = [];
  const execute = async (connection, method, sql, args) => {
    await hooks.before?.(sql, args);
    const result = await connection[method](rewrite(sql), args);
    await hooks.after?.(sql, args, result);
    return result;
  };
  const adapt = (connection) => ({
    execute: (sql, args) => execute(connection, 'execute', sql, args),
    query: (sql, args) => execute(connection, 'query', sql, args),
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => connection.release(),
  });
  const db = { ...adapt(pool), getConnection: async () => adapt(await pool.getConnection()) };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chapter-image-races-'));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(40).fill(0)]);
  const fixture = {
    db,
    pool,
    root,
    hooks,
    png,
    calls: 0,
    actor: { sub: 1, role: 'admin', account: 'image-regression' },
    audit: async () => {},
    fetchGate: null,
    gate() {
      const value = deferred();
      releases.push(value.resolve);
      return value;
    },
    async image() {
      const [[row]] = await db.execute('SELECT * FROM chapter_images WHERE chapter_id=?', [
        fixture.chid,
      ]);
      return row;
    },
    async draft(draftId) {
      const [[row]] = await db.execute('SELECT * FROM chapter_image_drafts WHERE id=?', [draftId]);
      return row;
    },
    async usage() {
      const [[row]] = await db.query(
        'SELECT COALESCE(SUM(requests),0) total FROM chapter_image_usage',
      );
      return Number(row.total);
    },
  };
  let uid, manager;
  try {
    const [user] = await pool.execute(
      "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'配图并发回归','test','disabled-test-login')",
      ['imgrace_' + unique.slice(0, 8)],
    );
    uid = user.insertId;
    fixture.uid = uid;
    const [course] = await pool.execute(
      "INSERT INTO courses(user_id,title) VALUES(?,'配图并发回归课程')",
      [uid],
    );
    fixture.cid = course.insertId;
    const [chapter] = await pool.execute(
      "INSERT INTO course_chapters(course_id,title) VALUES(?,'并发章节')",
      [fixture.cid],
    );
    fixture.chid = chapter.insertId;
    const fetcher = async () => {
      fixture.calls++;
      await fixture.fetchGate?.promise;
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    };
    manager = new ChapterImages(
      db,
      {},
      { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() },
      { root, fetcher },
    );
    fixture.manager = manager;
    await manager.init();
    clearInterval(manager.timer);
    manager.config = {
      ...imageDefaults,
      enabled: true,
      apiKey: 'test-only-no-network',
      version: 0,
    };
    await run(fixture);
  } finally {
    hooks.before = null;
    hooks.after = null;
    for (const release of releases) release();
    if (manager) {
      clearInterval(manager.timer);
      manager.config.enabled = false;
      await waitFor(
        () => manager.active === 0 && !manager.pumping,
        'Image workers did not stop before fixture cleanup',
      );
    }
    try {
      for (const table of tables) await pool.query('DROP TABLE IF EXISTS ' + table + suffix);
      if (uid) await pool.execute('DELETE FROM users WHERE id=?', [uid]);
      for (const name of await fs.readdir(root)) await fs.unlink(path.join(root, name));
      await fs.rmdir(root);
    } finally {
      await pool.end();
    }
  }
}

// NOWAIT proves that the real MySQL transaction owns the chapter/image lock;
// the interleaving does not depend on an arbitrary sleep or supplier latency.
async function assertChapterLocked(fixture, includeImage = false) {
  const connection = await fixture.db.getConnection();
  try {
    await connection.beginTransaction();
    await assert.rejects(
      connection.execute('SELECT id FROM course_chapters WHERE id=? FOR UPDATE NOWAIT', [
        fixture.chid,
      ]),
      (error) => error.code === 'ER_LOCK_NOWAIT' || error.errno === 3572,
    );
    if (includeImage)
      await assert.rejects(
        connection.execute(
          'SELECT chapter_id FROM chapter_images WHERE chapter_id=? FOR UPDATE NOWAIT',
          [fixture.chid],
        ),
        (error) => error.code === 'ER_LOCK_NOWAIT' || error.errno === 3572,
      );
  } finally {
    await connection.rollback();
    connection.release();
  }
}

test('配图回归：ensure检查旧文件期间并发采用，最终保留已采用图片', { timeout: 20000 }, async () =>
  withImageRaceFixture(async (fixture) => {
    const { manager, uid, cid, chid, actor, audit, root } = fixture;
    await manager.ensure(uid, cid, chid);
    await waitFor(async () => (await fixture.image())?.status === 'done');
    await waitFor(() => manager.active === 0 && !manager.pumping);
    const original = await fixture.image();
    const candidateJob = await manager.management.generate(
      chid,
      { instructions: '', acknowledgeCost: true },
      actor,
      audit,
    );
    const candidate = await waitFor(async () => {
      const row = await fixture.draft(candidateJob.id);
      return row?.status === 'ready' ? row : null;
    });
    await waitFor(() => manager.active === 0 && !manager.pumping);
    const callsBefore = fixture.calls,
      entered = fixture.gate(),
      releaseAccess = fixture.gate(),
      adoptLockAttempt = fixture.gate();
    const originalAccess = fs.access,
      oldPath = path.join(root, original.filename);
    let intercept = true,
      ensureTask,
      adoptTask;
    fs.access = async (filename, ...args) => {
      if (intercept && String(filename) === oldPath) {
        intercept = false;
        entered.resolve();
        await releaseAccess.promise;
      }
      return originalAccess(filename, ...args);
    };
    try {
      ensureTask = manager.ensure(uid, cid, chid);
      await waitFor(() => entered.settled, 'ensure never reached the original image file check');
      await assertChapterLocked(fixture, true);
      fixture.hooks.before = async (sql) => {
        if (sql.startsWith('SELECT ch.id,ch.title,c.id course_id') && sql.endsWith(' FOR UPDATE'))
          adoptLockAttempt.resolve();
      };
      adoptTask = manager.management.adopt(candidate.id, actor, audit);
      await waitFor(() => adoptLockAttempt.settled, 'Adoption never attempted to lock the chapter');
      releaseAccess.resolve();
      await Promise.all([ensureTask, adoptTask]);
    } finally {
      releaseAccess.resolve();
      fs.access = originalAccess;
      fixture.hooks.before = null;
      await Promise.allSettled([ensureTask, adoptTask].filter(Boolean));
    }
    const final = await fixture.image();
    assert.equal(final.status, 'done');
    assert.equal(final.filename, candidate.filename);
    assert.deepEqual(await fs.readFile(path.join(root, final.filename)), fixture.png);
    await assert.rejects(fs.access(oldPath), (error) => error.code === 'ENOENT');
    assert.equal(
      (await manager.ensure(uid, cid, chid)).revision,
      final.content_hash + '.' + candidate.filename,
    );
    await waitFor(() => manager.active === 0 && !manager.pumping);
    assert.equal(fixture.calls, callsBefore, '文件检查与采用交错不能触发额外付费调用');
  }),
);

test('配图回归：首次ensure与手动生成并发，只创建并调用一个配图任务', { timeout: 20000 }, async () =>
  withImageRaceFixture(async (fixture) => {
    const { manager, uid, cid, chid, actor, audit } = fixture;
    const draftRead = fixture.gate(),
      releaseRead = fixture.gate(),
      manualLockAttempt = fixture.gate();
    fixture.fetchGate = fixture.gate();
    let intercept = true,
      ensureTask,
      manualTask;
    fixture.hooks.after = async (sql) => {
      if (intercept && sql.startsWith('SELECT status FROM chapter_image_drafts')) {
        intercept = false;
        draftRead.resolve();
        await releaseRead.promise;
      }
    };
    try {
      ensureTask = manager.ensure(uid, cid, chid);
      await waitFor(() => draftRead.settled, 'ensure never checked for a pending candidate');
      await assertChapterLocked(fixture);
      fixture.hooks.before = async (sql) => {
        if (sql.startsWith('SELECT ch.id,ch.title,c.id course_id') && sql.endsWith(' FOR UPDATE'))
          manualLockAttempt.resolve();
      };
      manualTask = manager.management.generate(
        chid,
        { instructions: '', acknowledgeCost: true },
        actor,
        audit,
      );
      const resultsTask = Promise.allSettled([ensureTask, manualTask]);
      await waitFor(
        () => manualLockAttempt.settled,
        'Manual generation never attempted to lock the chapter',
      );
      releaseRead.resolve();
      const results = await resultsTask;
      assert.equal(results[0].status, 'fulfilled');
      assert.equal(results[1].status, 'rejected');
      assert.equal(results[1].reason.status, 409);
    } finally {
      releaseRead.resolve();
      fixture.hooks.before = null;
      fixture.hooks.after = null;
      await Promise.allSettled([ensureTask, manualTask].filter(Boolean));
      fixture.fetchGate.resolve();
    }
    await waitFor(async () => (await fixture.image())?.status === 'done');
    await waitFor(() => manager.active === 0 && !manager.pumping);
    const [[drafts]] = await fixture.db.execute(
      'SELECT COUNT(*) total FROM chapter_image_drafts WHERE chapter_id=?',
      [chid],
    );
    assert.equal(Number(drafts.total), 0);
    assert.equal(fixture.calls, 1);
    assert.equal(await fixture.usage(), 1);
  }),
);

test(
  '配图回归：候选在runtime等待时暂停，不调用供应商也不消耗每日额度',
  { timeout: 20000 },
  async () =>
    withImageRaceFixture(async (fixture) => {
      const { manager, chid, actor, audit } = fixture,
        runtime = new RuntimeLimits({});
      runtime.config.aiConcurrency = 1;
      manager.runtime = runtime;
      const releaseOccupied = fixture.gate(),
        occupied = runtime.run(() => releaseOccupied.promise);
      let draftId;
      try {
        const created = await manager.management.generate(
          chid,
          { instructions: '', acknowledgeCost: true },
          actor,
          audit,
        );
        draftId = created.id;
        await waitFor(
          () => runtime.queue.length === 1,
          'Candidate never entered the real runtime waiting queue',
        );
        assert.equal(fixture.calls, 0);
        assert.equal(await fixture.usage(), 0, '等待并发位时不预扣额度');
        runtime.config.generationEnabled = false;
        releaseOccupied.resolve();
        await occupied;
        const failed = await waitFor(async () => {
          const row = await fixture.draft(draftId);
          return row?.status === 'failed' ? row : null;
        });
        assert.match(failed.error_text, /暂停/);
        assert.equal(failed.filename, null);
        await waitFor(() => manager.active === 0 && !manager.pumping);
        assert.equal(fixture.calls, 0);
        assert.equal(await fixture.usage(), 0);
      } finally {
        runtime.config.generationEnabled = false;
        releaseOccupied.resolve();
        await occupied;
      }
    }),
);
