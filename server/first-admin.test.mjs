import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createFirstAdmin } from './first-admin.mjs';

function database({ admin = false, occupied = false, lock = 1, failInsert = false } = {}) {
  const events = [];
  let inserted;
  return {
    events,
    get inserted() {
      return inserted;
    },
    async beginTransaction() {
      events.push('begin');
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    async execute(sql, values) {
      if (sql.includes('GET_LOCK')) {
        events.push('lock');
        return [[{ acquired: lock }]];
      }
      if (sql.includes('RELEASE_LOCK')) {
        events.push('release');
        return [[{ released: 1 }]];
      }
      if (sql.includes("role='admin'")) return [admin ? [{ id: 1 }] : []];
      if (sql.includes('WHERE account=?')) return [occupied ? [{ id: 2 }] : []];
      if (sql.startsWith('INSERT')) {
        if (failInsert) throw new Error('insert failed');
        inserted = values;
        return [{ insertId: 3 }];
      }
      throw new Error('Unexpected SQL');
    },
  };
}
const input = { account: 'admin', nickname: '管理员', password: 'unit-test-only-password' };

test('creates the first admin with a password hash and releases the initialization lock', async () => {
  const db = database();
  assert.equal(await createFirstAdmin(db, input), 3);
  assert.equal(db.inserted[0], input.account);
  assert.equal(db.inserted[1], input.nickname);
  assert.notEqual(db.inserted[2], input.password);
  assert.ok(await bcrypt.compare(input.password, db.inserted[2]));
  assert.deepEqual(db.events, ['lock', 'begin', 'commit', 'release']);
});

test('existing admin or occupied student account cannot be overwritten or promoted', async () => {
  for (const options of [{ admin: true }, { occupied: true }]) {
    const db = database(options);
    await assert.rejects(createFirstAdmin(db, input), /已有管理员|已被使用/);
    assert.equal(db.inserted, undefined);
    assert.deepEqual(db.events, ['lock', 'begin', 'rollback', 'release']);
  }
});

test('invalid input or unavailable initialization lock cannot create an account', async () => {
  for (const fields of [
    { account: 'a' },
    { account: 'a b' },
    { password: 'short' },
    { password: 'a'.repeat(65) },
    { nickname: '' },
  ]) {
    const db = database();
    await assert.rejects(createFirstAdmin(db, { ...input, ...fields }));
    assert.deepEqual(db.events, []);
  }
  const db = database({ lock: 0 });
  await assert.rejects(createFirstAdmin(db, input), /其他初始化/);
  assert.deepEqual(db.events, ['lock']);
});

test('insert failure rolls back and releases the lock', async () => {
  const db = database({ failInsert: true });
  await assert.rejects(createFirstAdmin(db, input), /insert failed/);
  assert.deepEqual(db.events, ['lock', 'begin', 'rollback', 'release']);
});
