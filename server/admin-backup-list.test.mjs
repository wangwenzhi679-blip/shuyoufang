import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { backupList } from './admin-backup-list.mjs';

test('备份历史分页稳定，按备份和验证异常筛选，末页删除后回到有效页', async () => {
  const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const table = 'backup_list_test_' + Date.now();
  const isolated = {
    query: (sql, args) => db.query(sql.replaceAll('platform_backups', table), args),
  };
  const ids = [];
  try {
    await db.query(
      `CREATE TABLE ${table}(id CHAR(36) PRIMARY KEY,status VARCHAR(20),verify_status VARCHAR(20),error_text VARCHAR(300),created_at DATETIME,verified_at DATETIME,size_bytes BIGINT UNSIGNED)`,
    );
    for (let n = 0; n < 43; n++) {
      const id = '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
      ids.push(id);
      await db.execute(
        `INSERT INTO ${table}(id,status,verify_status,created_at,size_bytes) VALUES(?,?,?,'2026-10-18 12:00:00',?)`,
        [
          id,
          n < 25
            ? 'done'
            : n < 36
              ? 'failed'
              : n < 40
                ? 'running'
                : n < 42
                  ? 'deleting'
                  : 'deleted',
          n === 0 ? 'failed' : n === 1 ? 'running' : 'pending',
          n < 25 ? 100 : null,
        ],
      );
    }
    const first = await backupList(isolated, {}, false);
    assert.equal(first.total, 42);
    assert.equal(first.pageSize, 20);
    assert.deepEqual(
      first.items.map((x) => x.id),
      ids.slice(22, 42).reverse(),
    );
    const second = await backupList(isolated, { page: 2 }, false);
    assert.deepEqual(
      second.items.map((x) => x.id),
      ids.slice(2, 22).reverse(),
    );
    const last = await backupList(isolated, { page: 999 }, false);
    assert.equal(last.page, 3);
    assert.deepEqual(
      last.items.map((x) => x.id),
      ids.slice(0, 2).reverse(),
    );
    const done = await backupList(isolated, { status: 'done' }, false);
    assert.equal(done.total, 25);
    assert.ok(done.items.every((x) => x.status === 'done'));
    const failed = await backupList(isolated, { status: 'failed' }, false);
    assert.equal(failed.total, 12);
    assert.ok(failed.items.some((x) => x.id === ids[0]));
    const running = await backupList(isolated, { status: 'running' }, true);
    assert.equal(running.total, 7);
    assert.equal(running.busy, true);
    await db.execute(`DELETE FROM ${table} WHERE id IN (?,?)`, ids.slice(0, 2));
    const clamped = await backupList(isolated, { page: 3 }, false);
    assert.equal(clamped.page, 2);
    assert.equal(clamped.total, 40);
    for (const query of [
      { page: 0 },
      { page: -1 },
      { page: 'abc' },
      { page: 100001 },
      { status: 'deleted' },
      { status: "' OR 1=1 --" },
    ])
      await assert.rejects(backupList(isolated, query, false), (error) => error.status === 400);
  } finally {
    if (!/^backup_list_test_\d+$/.test(table)) throw Error('Unexpected fixture');
    await db.query(`DROP TABLE IF EXISTS ${table}`);
    await db.end();
  }
});
