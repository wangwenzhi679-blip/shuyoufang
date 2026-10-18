import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageAudit } from './storage-audit.mjs';
import { ServiceSettings } from './service-settings.js';
import { AdminBackups } from './admin-backups.js';
import mysql from 'mysql2/promise';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

test('存储核查分批有界并发、并发请求共用任务、缓存时间与手动重查', async () => {
  let clock = 1_000_000,
    queries = 0,
    stats = 0,
    active = 0,
    peak = 0;
  const rows = Array.from({ length: 270 }, (_, n) => ({ id: n + 1, stored_name: `item-${n + 1}` }));
  const db = {
    execute: async (sql, [after]) => {
      queries++;
      return [
        sql.includes('course_materials') ? rows.filter((row) => row.id > after).slice(0, 256) : [],
      ];
    },
  };
  const audit = new StorageAudit(
    db,
    { uploadRoot: 'materials', imageRoot: 'images' },
    {
      ttl: 1000,
      now: () => clock,
      stat: async (file) => {
        stats++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        if (file.endsWith('item-4')) throw Object.assign(Error('missing'), { code: 'ENOENT' });
        return { isFile: () => true, size: 10 };
      },
    },
  );
  const results = await Promise.all(Array.from({ length: 10 }, () => audit.read()));
  assert.equal(stats, 270);
  assert.equal(queries, 4);
  assert.ok(peak <= 16);
  assert.equal(results[0].missingFiles, 1);
  assert.equal(results[0].materialBytes, 2690);
  assert.strictEqual(await audit.read(), results[0]);
  assert.equal(stats, 270);
  clock += 500;
  await audit.read(true);
  assert.equal(stats, 540);
  clock += 1001;
  await audit.read();
  assert.equal(stats, 810);
});

test('服务状态一次查询最新记录，配图配置复用同一响应', async () => {
  let calls = 0;
  const db = {
    execute: async (sql, args) => {
      calls++;
      assert.match(sql, /MAX\(id\)/);
      assert.ok(args.includes('chapter_images'));
      return [
        [
          { id: 3, kind: 'ai', status: 'done', config_version: 1 },
          { id: 7, kind: 'chapter_images', status: 'done', finished_at: '2026-10-18 10:00:00' },
        ],
      ];
    },
  };
  const manager = new ServiceSettings(db, 'test-only-secret', { env: {} });
  for (const name of ['ai_00000001', 'ai_00000002', 'ai_00000003'])
    manager.states.set(name, { ...manager.defaults.ai, name, apiKey: 'PRIVATE_KEY', version: 1 });
  manager.chapterImages = {
    public: () => ({ model: 'test-model', dailyLimit: 50, secretConfigured: true }),
    usage: async () => ({ todayRequests: 4, remainingRequests: 46, usageDate: '2026-10-18' }),
  };
  const view = await manager.view();
  assert.equal(calls, 1);
  assert.equal(view.profiles.length, 3);
  assert.equal(view.latest.ai.id, 3);
  assert.equal(view.chapterImages.todayRequests, 4);
  assert.equal(view.chapterImages.latestCheck.checkedAt, '2026-10-18 10:00:00');
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_KEY/);
});

test(
  '流式备份包含长文本、JSON与二进制，旧格式兼容，清理只作用于独立测试备份',
  { timeout: 30000 },
  async () => {
    const name = 'math_backup_scale_' + crypto.randomUUID().replaceAll('-', ''),
      base = path.resolve('storage', name);
    const options = {
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
    };
    const control = await mysql.createConnection(options);
    let db, server;
    const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
    try {
      await control.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4');
      db = mysql.createPool({ ...options, database: name, connectionLimit: 2 });
      await db.query(
        'CREATE TABLE records(id INT PRIMARY KEY,body LONGTEXT,payload JSON,content BLOB)',
      );
      for (let offset = 0; offset < 250; offset += 50) {
        const values = Array.from({ length: 50 }, (_, n) => [
          offset + n,
          '长文本'.repeat(1500) + offset,
          JSON.stringify({ b: [1, 2], a: '公式' }),
          Buffer.from([0, 255, 10]),
        ]);
        await db.query('INSERT INTO records VALUES ?', [values]);
      }
      const roots = {
        root: path.join(base, 'backups'),
        uploadRoot: path.join(base, 'materials'),
        imageRoot: path.join(base, 'images'),
        previewRoot: path.join(base, 'previews'),
      };
      const backups = new AdminBackups(db, roots);
      await backups.init();
      const value = crypto.randomUUID();
      await backups.create(value);
      const manifest = await backups.readPackage(value);
      assert.equal(manifest.format, 2);
      assert.equal(manifest.tables[0].rows, undefined);
      assert.equal(manifest.tables[0].count, 250);
      const manifestBytes = (await fs.stat(path.join(backups.directory(value), 'database.json')))
        .size;
      assert.ok(manifestBytes < 10000);
      await backups.verify(value);
      assert.equal((await db.query('SELECT COUNT(*) AS n FROM records'))[0][0].n, 250);
      const old = crypto.randomUUID(),
        oldDir = backups.directory(old);
      await fs.mkdir(oldDir);
      const oldRows = [{ id: 1, title: '旧格式' }];
      const oldHash = hash(JSON.stringify(oldRows.map((row) => JSON.stringify(row)).sort()));
      const raw = JSON.stringify({
        format: 1,
        tables: [
          {
            name: 'legacy',
            ddl: 'CREATE TABLE legacy(id INT PRIMARY KEY,title VARCHAR(40))',
            rows: oldRows,
            hash: oldHash,
          },
        ],
        files: [],
      });
      await fs.writeFile(path.join(oldDir, 'database.json'), raw);
      await fs.writeFile(path.join(oldDir, 'checksum.txt'), hash(raw));
      await backups.verify(old);
      await db.execute("INSERT INTO platform_backups(id,status) VALUES(?,'done')", [value]);
      const audits = [],
        app = express();
      app.use(express.json());
      const route = (method, url, fn) =>
        app[method]('/api/admin' + url, (req, res, next) => {
          if (req.headers['x-role'] !== 'admin')
            return res.status(403).json({ message: '仅管理员' });
          req.user = { sub: 1 };
          Promise.resolve(fn(req, res)).catch(next);
        });
      backups.register(route, async (con, actor, action, target, result) =>
        audits.push({ action, target, result }),
      );
      app.use((e, req, res, next) =>
        res.status(e.status || 500).json({ message: e.status ? e.message : '服务器错误' }),
      );
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      const call = async (url, method = 'GET', body, role = 'admin') => {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${url}`, {
          method,
          headers: { 'x-role': role, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, data: await r.json() };
      };
      assert.equal(
        (await call(`backups/${value}`, 'DELETE', { reason: '独立测试清理' }, 'student')).status,
        403,
      );
      assert.equal((await call(`backups/${value}`, 'DELETE', { reason: '' })).status, 400);
      const size = await call(`backups/${value}/size`, 'POST');
      assert.equal(size.status, 200);
      assert.ok(size.data.sizeBytes > 1_000_000);
      backups.running = true;
      assert.equal(
        (await call(`backups/${value}`, 'DELETE', { reason: '独立测试清理' })).status,
        409,
      );
      backups.running = false;
      backups.downloads.set(value, 1);
      assert.equal(
        (await call(`backups/${value}`, 'DELETE', { reason: '独立测试清理' })).status,
        409,
      );
      backups.downloads.delete(value);
      backups.deleting.add(value);
      assert.equal((await call(`backups/${value}/download`)).status, 409);
      backups.deleting.delete(value);
      assert.equal(
        (await call(`backups/${value}`, 'DELETE', { reason: '独立测试清理' })).status,
        200,
      );
      assert.equal((await call('backups')).data.items.length, 0);
      assert.equal((await call(`backups/${value}/download`)).status, 404);
      assert.equal((await db.query('SELECT COUNT(*) AS n FROM records'))[0][0].n, 250);
      assert.ok(audits.some((a) => a.action === 'backup_delete' && a.result === 'success'));
      await assert.rejects(fs.stat(backups.directory(value)), { code: 'ENOENT' });
      const [remaining] = await control.execute(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?',
        ['math_restorecheck_%'],
      );
      assert.equal(remaining.length, 0);
    } finally {
      if (server) await new Promise((r) => server.close(r));
      if (db) await db.end();
      await control.query('DROP DATABASE IF EXISTS `' + name + '`');
      await control.end();
      if (
        path.dirname(base) !== path.resolve('storage') ||
        !path.basename(base).startsWith('math_backup_scale_')
      )
        throw Error('Unsafe cleanup');
      await fs.rm(base, { recursive: true, force: true });
    }
  },
);
