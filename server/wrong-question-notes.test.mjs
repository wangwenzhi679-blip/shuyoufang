import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWrongQuestionNotes, ensureWrongQuestionNotes } from './wrong-question-notes.js';

function setup({ owned = true, version = 0, failWrite = false } = {}) {
  const calls = [],
    routes = new Map();
  const execute = async (sql, args) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT w.id')) return [owned ? [{ id: 9 }] : []];
    if (sql.startsWith('SELECT version')) return [version ? [{ version }] : []];
    if (
      sql.startsWith('INSERT INTO wrong_question_notes') ||
      sql.startsWith('UPDATE wrong_question_notes')
    ) {
      if (failWrite) throw new Error('write failed');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
    if (sql.startsWith('SELECT n.reason'))
      return [[{ reason: '错因', takeaway: '心得', version: version + 1 }]];
    return [{}];
  };
  const connection = {
    execute,
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
  };
  const db = {
    execute,
    getConnection: async () => {
      calls.push('connect');
      return connection;
    },
  };
  const auth = () => {};
  const app = Object.fromEntries(
    ['get', 'put'].map((method) => [
      method,
      (path, middleware, handler) => {
        assert.equal(middleware, auth);
        routes.set(`${method} ${path}`, handler);
      },
    ]),
  );
  registerWrongQuestionNotes(app, db, auth, (handler) => handler);
  return {
    calls,
    run: async (method, path, overrides = {}) => {
      let result;
      await routes.get(`${method} /api/wrong-question-notes${path}`)(
        {
          user: { sub: 7 },
          params: { questionId: '12' },
          query: {},
          body: { reason: '错因', takeaway: '', version },
          ...overrides,
        },
        {
          json: (data) => {
            result = data;
          },
        },
      );
      return result;
    },
  };
}

test('table preserves notes across mastery updates and cascades deleted questions', async () => {
  let sql;
  await ensureWrongQuestionNotes({
    query: async (value) => {
      sql = value;
    },
  });
  assert.match(sql, /REFERENCES wrong_questions\(id\) ON DELETE CASCADE/);
});
test('create note scopes owner, locks parent and records study day in same transaction', async () => {
  const { calls, run } = setup();
  const data = await run('put', '/:questionId');
  assert.equal(data.note.version, 1);
  assert.deepEqual(calls.find((call) => call.sql?.startsWith('SELECT w.id')).args, [7, 12]);
  assert.match(calls.find((call) => call.sql?.startsWith('SELECT w.id')).sql, /FOR UPDATE$/);
  assert.deepEqual(
    calls.find((call) => call.sql?.startsWith('INSERT INTO wrong_question_notes')).args,
    [9, '错因', ''],
  );
  assert(calls.some((call) => call.sql?.startsWith('INSERT IGNORE INTO study_days')));
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});
test('existing note increments version rather than inserting duplicate', async () => {
  const { calls, run } = setup({ version: 2 });
  const data = await run('put', '/:questionId');
  assert.equal(data.note.version, 3);
  assert(calls.some((call) => call.sql?.includes('version=version+1')));
  assert(!calls.some((call) => call.sql?.startsWith('INSERT INTO wrong_question_notes')));
});
test('stale device cannot overwrite newer note', async () => {
  const { calls, run } = setup({ version: 2 });
  await assert.rejects(run('put', '/:questionId', { body: { reason: 'old', version: 1 } }), {
    status: 409,
  });
  assert(!calls.some((call) => call.sql?.startsWith('UPDATE')));
  assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
});
for (const method of ['get', 'put'])
  test(`${method}: foreign question is inaccessible`, async () => {
    const { calls, run } = setup({ owned: false });
    await assert.rejects(run(method, '/:questionId'), { status: 404 });
    assert(!calls.some((call) => call.sql?.startsWith('INSERT INTO wrong_question_notes')));
  });
for (const body of [
  { reason: '  ', version: 0 },
  { reason: 'x'.repeat(2001), version: 0 },
  { takeaway: 'x'.repeat(3001), version: 0 },
  { reason: 'x', version: -1 },
]) {
  test('invalid note is rejected before opening transaction', async () => {
    const { calls, run } = setup();
    await assert.rejects(run('put', '/:questionId', { body }), { status: 400 });
    assert.equal(calls.length, 0);
  });
}
test('write failure rolls back and releases connection', async () => {
  const { calls, run } = setup({ failWrite: true });
  await assert.rejects(run('put', '/:questionId'), /write failed/);
  assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
  assert(!calls.includes('commit'));
});
test('list remains owner scoped, parameterizes search and includes mastered questions', async () => {
  const { calls, run } = setup();
  const data = await run('get', '', { query: { courseId: '3', page: '2', q: "a' OR 1=1" } });
  assert.equal(data.pageSize, 20);
  for (const call of calls) {
    assert.match(call.sql, /c.user_id=\?/);
    assert(!call.sql.includes('mastered='));
    assert.deepEqual(call.args, [7, 3, "%a' OR 1=1%", "%a' OR 1=1%", "%a' OR 1=1%"]);
  }
  assert.match(calls[1].sql, /LIMIT 20 OFFSET 20/);
});
test('invalid pagination is rejected without querying database', async () => {
  const { calls, run } = setup();
  await assert.rejects(run('get', '', { query: { page: '0 OR 1=1' } }), { status: 400 });
  assert.equal(calls.length, 0);
});
