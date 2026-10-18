import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ChapterImages, imageDefaults } from './chapter-images.js';
import { ServiceSettings, serviceChecksSql } from './service-settings.js';

test('章节自动配图：配置加密、章节隔离、去重生成、缓存复用和暂停', { timeout: 20000 }, async () => {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 5,
  });
  const suffix = '_ci_test_' + Date.now(),
    tables = [
      'chapter_image_drafts',
      'chapter_image_settings',
      'chapter_images',
      'chapter_image_usage',
      'platform_service_checks',
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chapter-image-test-'));
  const services = new ServiceSettings(db, process.env.JWT_SECRET),
    runtime = { snapshot: () => ({ generationEnabled: true }), run: (fn) => fn() };
  let userId,
    courseId,
    chapterId,
    manager,
    calls = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(30).fill(0)]);
  try {
    const [user] = await pool.execute(
      "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'Illustration test','test','disabled-test-login')",
      ['img_' + Date.now()],
    );
    userId = user.insertId;
    await pool.execute('INSERT INTO user_preferences(user_id,settings_json) VALUES(?,?)', [
      userId,
      JSON.stringify({ imageModel: 'doubao-seedream-4-5-251128' }),
    ]);
    const [course] = await pool.execute("INSERT INTO courses(user_id,title) VALUES(?,'线性代数')", [
      userId,
    ]);
    courseId = course.insertId;
    const [chapter] = await pool.execute(
      "INSERT INTO course_chapters(course_id,title,description) VALUES(?,'矩阵','PRIVATE_DESCRIPTION')",
      [courseId],
    );
    chapterId = chapter.insertId;
    const fetcher = async (url, options) => {
      calls++;
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'doubao-seedream-4-5-251128');
      assert.equal(request.size, '2K');
      const prompt = request.prompt;
      assert.ok(prompt.includes('矩阵'));
      assert.ok(!prompt.includes('PRIVATE_DESCRIPTION'));
      await gate;
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    };
    manager = new ChapterImages(db, services, runtime, { root, fetcher });
    await manager.init();
    assert.equal((await manager.ensure(userId, courseId, chapterId)).status, 'unconfigured');
    assert.equal(calls, 0);
    await assert.rejects(
      manager.ensure(userId + 10000, courseId, chapterId),
      (e) => e.status === 404,
    );
    const config = await manager.save(
      { ...imageDefaults, enabled: true, apiKey: 'test-only-key', version: 0 },
      { sub: userId },
      async () => {},
    );
    assert.equal(config.configured, true);
    assert.equal(config.apiKey, undefined);
    const [[saved]] = await db.query('SELECT encrypted_secret FROM chapter_image_settings');
    assert.ok(!saved.encrypted_secret.includes('test-only-key'));
    await Promise.all(Array.from({ length: 6 }, () => manager.ensure(userId, courseId, chapterId)));
    for (let i = 0; i < 100 && calls === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1);
    release();
    let result;
    for (let i = 0; i < 200; i++) {
      result = await manager.ensure(userId, courseId, chapterId);
      if (result.status === 'done') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(result.status, 'done');
    assert.equal(calls, 1);
    await manager.ensure(userId, courseId, chapterId);
    assert.equal(calls, 1);
    const [[image]] = await db.execute('SELECT filename FROM chapter_images WHERE chapter_id=?', [
      chapterId,
    ]);
    assert.deepEqual(await fs.readFile(path.join(root, image.filename)), png);
    await manager.save(
      { ...imageDefaults, enabled: false, apiKey: '', version: 1 },
      { sub: userId },
      async () => {},
    );
    assert.equal(
      (await manager.ensure(userId, courseId, chapterId)).status,
      'done',
      '暂停生图后仍能复用已有图片',
    );
    await pool.execute("UPDATE course_chapters SET title='向量' WHERE id=?", [chapterId]);
    assert.equal((await manager.ensure(userId, courseId, chapterId)).status, 'unconfigured');
    assert.equal(calls, 1);
    await db.query(serviceChecksSql);
    manager.fetcher = async (url, options) => {
      assert.ok(!JSON.parse(options.body).prompt.includes('PRIVATE_DESCRIPTION'));
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    };
    const routes = new Map();
    manager.registerAdmin(
      (method, url, handler) => routes.set(method + ' ' + url, handler),
      async () => {},
    );
    const request = {
      body: { ...manager.public(), apiKey: '', acknowledgeCost: true },
      user: { sub: userId },
    };
    let checked;
    await routes.get('post /chapter-images/check')(request, {
      json: (value) => {
        checked = value;
      },
    });
    assert.equal(checked.status, 'done');
    assert.equal(checked.config_version, 2);
    let view;
    await routes.get('get /chapter-images/config')(
      {},
      {
        json: (value) => {
          view = value;
        },
      },
    );
    assert.equal(view.latestCheck.status, 'done');
    assert.equal(view.latestCheck.config_version, 2);
    assert.equal(view.apiKey, undefined);
    assert.ok(!JSON.stringify(view).includes('test-only-key'));
  } finally {
    release();
    if (manager) {
      clearInterval(manager.timer);
      for (let i = 0; i < 100 && manager.active; i++) await new Promise((r) => setTimeout(r, 10));
    }
    for (const table of [tables[0], tables[2], tables[3], tables[4], tables[1]])
      await pool.query('DROP TABLE IF EXISTS ' + table + suffix);
    if (userId) await pool.execute('DELETE FROM users WHERE id=?', [userId]);
    for (const name of await fs.readdir(root)) await fs.unlink(path.join(root, name));
    await fs.rmdir(root);
    await pool.end();
  }
});
