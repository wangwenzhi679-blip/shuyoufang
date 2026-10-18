import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import 'dotenv/config';
import { AdminBackups } from './admin-backups.js';
test('备份在独立数据库恢复，校验关联与文件，拒绝损坏及缺失原件', async () => {
  const name = 'math_backup_test_' + crypto.randomUUID().replaceAll('-', ''),
    base = path.resolve('storage', name);
  const options = {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  };
  const control = await mysql.createConnection(options);
  let db;
  try {
    await control.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4');
    db = mysql.createPool({ ...options, database: name, connectionLimit: 2 });
    await db.query(
      'CREATE TABLE users(id INT PRIMARY KEY,name VARCHAR(40),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    );
    await db.query(
      'CREATE TABLE course_materials(id INT PRIMARY KEY,user_id INT,stored_name VARCHAR(100),preview_name VARCHAR(100),content JSON,FOREIGN KEY(user_id) REFERENCES users(id))',
    );
    await db.execute('INSERT INTO users(id,name) VALUES(1,?)', ['测试用户']);
    await db.execute('INSERT INTO course_materials VALUES(1,1,?,NULL,?)', [
      'test.pdf',
      JSON.stringify({ text: '公式与中文', items: [1, 2] }),
    ]);
    const roots = {
      root: path.join(base, 'backups'),
      uploadRoot: path.join(base, 'materials'),
      imageRoot: path.join(base, 'images'),
      previewRoot: path.join(base, 'previews'),
    };
    await fs.mkdir(roots.uploadRoot, { recursive: true });
    await fs.writeFile(path.join(roots.uploadRoot, 'test.pdf'), '%PDF-test');
    const backups = new AdminBackups(db, roots);
    await backups.init();
    const value = crypto.randomUUID();
    await backups.create(value);
    await backups.verify(value);
    assert.equal((await db.query('SELECT name FROM users'))[0][0].name, '测试用户');
    const filename = path.join(backups.directory(value), 'materials', 'test.pdf');
    await fs.writeFile(filename, 'tampered');
    await assert.rejects(backups.verify(value), /校验/);
    await fs.unlink(path.join(roots.uploadRoot, 'test.pdf'));
    await assert.rejects(backups.create(crypto.randomUUID()), /缺失/);
    assert.throws(() => backups.directory('../outside'));
    const [remaining] = await control.execute(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?',
      ['math_restorecheck_%'],
    );
    assert.equal(remaining.length, 0);
  } finally {
    if (db) await db.end();
    await control.query('DROP DATABASE IF EXISTS `' + name + '`');
    await control.end();
    if (path.dirname(base) !== path.resolve('storage')) throw Error('Unsafe cleanup');
    await fs.rm(base, { recursive: true, force: true });
  }
});
