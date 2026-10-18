import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sessionAuth } from './admin.js';
import {
  ensureUserAccount,
  registerUserAccount,
  checkAvatar,
  preferencesSchema,
} from './user-account.js';
import { defaultPreferences } from '../shared/account-preferences.mjs';
import { imageModelOptions } from '../shared/image-models.mjs';

test('个人资料、设置冲突、账号隔离、邮箱验证和会话撤销', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const ids = [];
  let server, mail;
  try {
    await ensureUserAccount(db);
    for (let i = 0; i < 2; i++) {
      const [result] = await db.execute(
        'INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,?,?,?)',
        ['acct_' + Date.now() + '_' + i, '测试用户', '', await bcrypt.hash('OriginalPass1', 4)],
      );
      ids.push(result.insertId);
    }
    const secret = 'account-test-only',
      tokens = ids.map((sub) => jwt.sign({ sub, version: 0 }, secret));
    const app = express();
    app.use(express.json());
    registerUserAccount(
      app,
      db,
      sessionAuth(db, secret),
      (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
      {
        userView: (u) => ({
          id: u.id,
          nickname: u.nickname,
          account: u.account,
          email: u.email,
          emailVerified: !!u.email_verified_at,
        }),
        passwordSchema: z.string().min(8).max(16),
        emailSchema: z.string().email(),
        models: () => [{ id: 'configured', label: '默认模型' }],
        services: {
          chapterImages: {
            modelOptions: () => imageModelOptions('doubao-seedream-5-0-flash-260915'),
            modelInfo: () => ({
              id: 'doubao-seedream-5-0-flash-260915',
              label: 'Seedream 5.0 Flash',
              status: 'enabled',
            }),
          },
          configured: () => true,
          snapshot: () => ({ from: 'test@example.invalid' }),
          mailTransport: () => ({
            sendMail: async (value) => {
              mail = value;
            },
            close() {},
          }),
        },
      },
    );
    app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const call = async (path = '', method = 'GET', body, token = tokens[0]) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/${path || 'account'}`,
        {
          method,
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await call('', 'GET', undefined, 'invalid')).status, 401);
    assert.deepEqual((await call()).data.imageModel, {
      id: 'doubao-seedream-5-0-flash-260915',
      label: 'Seedream 5.0 Flash',
      status: 'enabled',
    });
    assert.deepEqual((await call()).data.preferences, defaultPreferences);
    const avatar = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(
      (await call('account/profile', 'PATCH', { nickname: '新昵称', avatar })).status,
      200,
    );
    assert.equal((await call()).data.user.avatar, avatar);
    assert.equal((await call()).data.user.nickname, '新昵称');
    assert.equal(
      (
        await call('account/profile', 'PATCH', {
          nickname: '无效头像',
          avatar: 'data:image/svg+xml;base64,PHN2Zz4=',
        })
      ).status,
      400,
    );
    assert.equal((await call()).data.user.nickname, '新昵称');
    assert.equal((await call('', 'GET', undefined, tokens[1])).data.user.avatar, null);
    const prefs = {
      ...defaultPreferences,
      theme: 'dark',
      readingSize: 20,
      answerStyle: 'concise',
      imageModel: 'doubao-seedream-4-5-251128',
    };
    assert.equal(
      (await call('account/preferences', 'PUT', { preferences: prefs, version: 0 })).status,
      200,
    );
    assert.equal(
      (await call('account/preferences', 'PUT', { preferences: defaultPreferences, version: 0 }))
        .status,
      409,
    );
    assert.deepEqual((await call()).data.preferences, prefs);
    assert.deepEqual(
      (await call('', 'GET', undefined, tokens[1])).data.preferences,
      defaultPreferences,
    );
    assert.equal(
      (
        await call('account/preferences', 'PUT', {
          preferences: { ...prefs, defaultModel: 'deepseek-flash' },
          version: 1,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('account/preferences', 'PUT', {
          preferences: { ...prefs, readingSize: 100 },
          version: 1,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('account/preferences', 'PUT', {
          preferences: { ...prefs, imageModel: 'arbitrary-private-model' },
          version: 1,
        })
      ).status,
      400,
    );
    assert.equal((await call()).data.preferences.imageModel, 'doubao-seedream-4-5-251128');
    assert.ok(
      (await call()).data.imageModels.some((model) => model.id === 'doubao-seedream-4-5-251128'),
    );
    assert.equal(
      (
        await call('account/email-code', 'POST', {
          email: 'new@example.invalid',
          currentPassword: 'wrong',
        })
      ).status,
      400,
    );
    assert.equal(mail, undefined);
    assert.equal(
      (
        await call('account/email-code', 'POST', {
          email: 'new@example.invalid',
          currentPassword: 'OriginalPass1',
        })
      ).status,
      200,
    );
    assert.equal((await call()).data.user.email, null);
    assert.equal(
      (
        await call('account/email-code', 'POST', {
          email: 'other@example.invalid',
          currentPassword: 'OriginalPass1',
        })
      ).status,
      429,
    );
    const code = mail.text.match(/\d{6}/)[0];
    assert.equal(
      (
        await call('account/email', 'PUT', {
          email: 'wrong@example.invalid',
          currentPassword: 'OriginalPass1',
          code,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('account/email', 'PUT', {
          email: 'new@example.invalid',
          currentPassword: 'OriginalPass1',
          code,
        })
      ).status,
      200,
    );
    assert.equal((await call()).data.user.emailVerified, true);
    assert.equal(
      (
        await call('account/email', 'PUT', {
          email: 'new@example.invalid',
          currentPassword: 'OriginalPass1',
          code,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('account/password', 'POST', {
          currentPassword: 'wrong',
          password: 'NewPassword1',
          confirmPassword: 'NewPassword1',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('account/password', 'POST', {
          currentPassword: 'OriginalPass1',
          password: 'NewPassword1',
          confirmPassword: 'Mismatch1',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('account/password', 'POST', {
          currentPassword: 'OriginalPass1',
          password: 'NewPassword1',
          confirmPassword: 'NewPassword1',
        })
      ).status,
      200,
    );
    assert.equal((await call()).status, 401);
    assert.equal((await call('auth/logout', 'POST', {}, tokens[1])).status, 200);
    assert.equal((await call('', 'GET', undefined, tokens[1])).status, 401);
    const [[row]] = await db.execute('SELECT password_hash FROM users WHERE id=?', [ids[0]]);
    assert.ok(await bcrypt.compare('NewPassword1', row.password_hash));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (ids.length) await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
    await db.end();
  }
});
test('头像及设置拒绝非法格式', () => {
  assert.throws(() => checkAvatar('data:image/png;base64,AAAA'));
  assert.equal(checkAvatar(null), null);
  assert.equal(
    preferencesSchema.safeParse({ ...defaultPreferences, unknown: true }).success,
    false,
  );
});
