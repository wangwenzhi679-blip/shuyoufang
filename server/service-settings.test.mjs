import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import express from 'express';
import { ServiceSettings, registerServices } from './service-settings.js';

test('服务配置持久化、秘密加密、版本保护、连接测试和运行请求快照', { timeout: 20000 }, async () => {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 4,
  });
  const suffix = `_test_${Date.now()}`,
    rewrite = (sql) =>
      sql
        .replaceAll('platform_service_settings', 'platform_service_settings' + suffix)
        .replaceAll('platform_service_checks', 'platform_service_checks' + suffix);
  const adapt = (connection) => ({
    execute: (sql, args) => connection.execute(rewrite(sql), args),
    query: (sql, args) => connection.query(rewrite(sql), args),
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => connection.release(),
  });
  const db = { ...adapt(pool), getConnection: async () => adapt(await pool.getConnection()) };
  const calls = [],
    auditRows = [];
  let gate = null,
    httpStatus = 200,
    mailFail = false,
    server;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (gate) await gate.promise;
    return {
      ok: httpStatus === 200,
      status: httpStatus,
      json: async () =>
        httpStatus === 200
          ? { choices: [{ message: { content: 'OK' } }] }
          : { error: { message: 'secret-test-key should never appear' } },
    };
  };
  const transport = (options) => ({
    verify: async () => {
      assert.equal(options.tls.rejectUnauthorized, true);
      if (mailFail) throw Object.assign(new Error('secret-mail-password'), { code: 'EAUTH' });
    },
    sendMail: async (mail) => {
      calls.push({ mail });
      return { accepted: [mail.to], rejected: [] };
    },
    close() {},
  });
  const manager = new ServiceSettings(db, 'isolated-test-encryption-secret', {
    env: {},
    fetcher,
    transport,
  });
  const audit = async (con, actor, action, target, result, detail) =>
    auditRows.push({ action, target, result, detail });
  try {
    await manager.init();
    const app = express();
    app.use(express.json());
    const route = (method, url, handler) =>
      app[method](
        '/api/admin' + url,
        (req, res, next) => {
          if (req.headers['x-role'] !== 'admin')
            return res.status(403).json({ message: '仅管理员' });
          req.user = { sub: 1, role: 'admin' };
          next();
        },
        (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
      );
    registerServices(route, manager, audit);
    app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const api = async (path, method = 'GET', body, role = 'admin') => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/services${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-role': role },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = await r.json();
      if (r.status === 202 && path.endsWith('/check')) {
        const kind = path.split('/')[1];
        for (let n = 0; n < 100; n++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          const state = await api('');
          const latest = state.data.latest[kind];
          if (latest?.id === data.id && latest.status !== 'running') {
            data = latest;
            break;
          }
        }
      }
      return { status: r.status, data };
    };
    assert.equal((await api('', 'GET', null, 'student')).status, 403);
    const ai = {
      enabled: true,
      model: 'test-model',
      timeoutMs: 5000,
      apiKey: 'secret-test-key',
      version: 0,
    };
    assert.equal((await api('/ai', 'PUT', ai)).status, 200);
    assert.equal(
      (
        await api('/ai', 'PUT', {
          ...ai,
          version: 1,
          baseUrl: 'https://other.example.com/v1',
          apiKey: '',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await api('/profiles', 'POST', {
          ...ai,
          name: '其他服务',
          baseUrl: 'http://localhost:8005',
          apiKey: 'other-key',
        })
      ).status,
      400,
    );
    const profile = await api('/profiles', 'POST', {
      ...ai,
      name: '其他服务',
      baseUrl: 'https://other.example.com/v1',
      model: 'other-model',
      apiKey: 'other-key',
    });
    assert.equal(profile.status, 200);
    assert.equal(
      (await api('/' + profile.data.id + '/check', 'POST', { version: 1 })).data.status,
      'done',
    );
    assert.equal(calls.at(-1).url, 'https://other.example.com/v1/chat/completions');
    const oldVersion = manager.snapshot('ai').version;
    assert.equal(
      (
        await api('/profiles/' + profile.data.id + '/activate', 'POST', {
          version: oldVersion,
          profileVersion: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await api('/profiles/' + profile.data.id + '/activate', 'POST', {
          version: oldVersion,
          profileVersion: 1,
        })
      ).status,
      200,
    );
    assert.equal((await api('')).data.profiles.find((p) => p.id === profile.data.id).current, true);
    assert.equal((await api('/profiles/' + profile.data.id, 'DELETE', { version: 1 })).status, 409);
    assert.ok((await api('')).data.profiles.some((p) => p.name === 'DeepSeek'));
    await manager.ask([{ role: 'user', content: 'custom' }], 'deepseek-flash');
    assert.equal(JSON.parse(calls.at(-1).options.body).model, 'other-model');
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer other-key');
    assert.equal((await api('/ai', 'PUT', { ...ai, version: 2 })).status, 200);
    // Reset version only within the isolated test table before the existing regression assertions.
    await db.execute('UPDATE platform_service_settings SET version=1 WHERE kind=?', ['ai']);
    manager.states.get('ai').version = 1;
    calls.length = 0;
    assert.doesNotMatch(JSON.stringify((await api('')).data), /other-key/);
    const otherRestored = new ServiceSettings(db, 'isolated-test-encryption-secret', {
      env: {},
      fetcher,
      transport,
    });
    await otherRestored.init();
    assert.equal(otherRestored.snapshot(profile.data.id).apiKey, 'other-key');
    assert.equal((await api('/profiles/' + profile.data.id, 'DELETE', { version: 0 })).status, 409);
    assert.equal((await api('/profiles/' + profile.data.id, 'DELETE', { version: 1 })).status, 200);
    assert.ok(!(await api('')).data.profiles.some((p) => p.id === profile.data.id));
    assert.equal((await api('/ai', 'PUT', ai)).status, 409);
    const view = (await api('')).data;
    assert.equal(view.ai.version, 1);
    assert.equal(view.ai.secretConfigured, true);
    assert.doesNotMatch(JSON.stringify(view), /secret-test-key|encrypted_secret|apiKey/);
    const [[stored]] = await db.execute(
      'SELECT encrypted_secret FROM platform_service_settings WHERE kind=?',
      ['ai'],
    );
    assert.ok(!stored.encrypted_secret.includes('secret-test-key'));
    const restored = new ServiceSettings(db, 'isolated-test-encryption-secret', {
      env: {},
      fetcher,
      transport,
    });
    await restored.init();
    assert.equal(restored.snapshot('ai').apiKey, 'secret-test-key');
    let release;
    gate = { promise: new Promise((resolve) => (release = resolve)) };
    const started = await manager.startCheck('ai', { version: 1 }, { sub: 1 }, audit);
    assert.equal(started.status, 'running');
    assert.ok(manager.checking.has('ai'));
    assert.equal((await manager.view()).latest.ai.status, 'running');
    await assert.rejects(
      () => manager.startCheck('ai', { version: 1 }, { sub: 1 }, audit),
      /正在检查/,
    );
    release();
    gate = null;
    for (let i = 0; i < 100 && manager.checking.has('ai'); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(!manager.checking.has('ai'));
    calls.length = 0;
    gate = { promise: new Promise((resolve) => (release = resolve)) };
    const inFlight = manager.ask([{ role: 'user', content: 'test' }]);
    assert.equal(
      (await api('/ai', 'PUT', { ...ai, apiKey: 'new-test-key', version: 1 })).status,
      200,
    );
    release();
    gate = null;
    await inFlight;
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-test-key');
    await manager.ask([{ role: 'user', content: 'new' }]);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer new-test-key');
    const races = await Promise.all([
      api('/ai', 'PUT', { ...ai, apiKey: '', version: 2 }),
      api('/ai', 'PUT', { ...ai, apiKey: '', version: 2 }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await api('/ai/check', 'POST', { version: 3 })).data.status, 'done');
    httpStatus = 401;
    const failed = await api('/ai/check', 'POST', { version: 3 });
    assert.equal(failed.data.status, 'failed');
    assert.match(failed.data.summary, /身份验证/);
    assert.doesNotMatch(JSON.stringify(failed.data), /secret-test/);
    httpStatus = 200;
    const mail = {
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      user: 'sender@example.com',
      from: 'sender@example.com',
      password: 'secret-mail-password',
      version: 0,
    };
    assert.equal((await api('/mail', 'PUT', { ...mail, secure: false })).status, 400);
    assert.equal((await api('/mail', 'PUT', mail)).status, 200);
    assert.equal((await api('/mail/check', 'POST', { version: 1 })).data.status, 'done');
    assert.equal(
      (await api('/mail_send/check', 'POST', { version: 1, to: 'invalid' })).status,
      400,
    );
    const send = await api('/mail_send/check', 'POST', { version: 1, to: 'receiver@example.com' });
    assert.equal(send.data.status, 'done');
    assert.doesNotMatch(send.data.summary, /receiver@example/);
    mailFail = true;
    assert.equal((await api('/mail/check', 'POST', { version: 1 })).data.status, 'failed');
    assert.equal(
      (await api('/ai', 'PUT', { ...ai, enabled: false, apiKey: '', version: 3 })).status,
      200,
    );
    await assert.rejects(() => manager.ask([{ role: 'user', content: 'test' }]), /已暂停/);
    const final = (await api('')).data;
    assert.equal(final.latest.ai.config_version, 3);
    assert.equal(final.ai.version, 4);
    assert.doesNotMatch(JSON.stringify(final), /secret-test|new-test-key|secret-mail-password/);
    assert.ok(auditRows.some((r) => r.result === 'failed'));
    assert.doesNotMatch(JSON.stringify(auditRows), /secret-test|new-test-key|secret-mail-password/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP TABLE IF EXISTS platform_service_checks${suffix}`);
    await pool.query(`DROP TABLE IF EXISTS platform_service_settings${suffix}`);
    await pool.end();
  }
});
