import { backupList } from './admin-backup-list.mjs';
import {
  writeStreamingBackup,
  readBackup,
  restoreTables,
  verifyTables,
  directoryBytes,
} from './backup-stream.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZipArchive } from 'archiver';
const id = (value) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error('数据库名称不正确');
  return '`' + value + '`';
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object' && !Buffer.isBuffer(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const rowsHash = (rows) =>
  hash(JSON.stringify(rows.map((row) => JSON.stringify(canonical(row))).sort()));
export class AdminBackups {
  constructor(db, { root, uploadRoot, imageRoot, previewRoot }) {
    this.db = db;
    this.root = path.resolve(root);
    this.roots = { materials: uploadRoot, images: imageRoot, previews: previewRoot };
    this.running = false;
    this.downloads = new Map();
    this.deleting = new Set();
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS platform_backups(id CHAR(36) PRIMARY KEY,status VARCHAR(20) NOT NULL,verify_status VARCHAR(20) NOT NULL DEFAULT 'pending',error_text VARCHAR(300) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,verified_at TIMESTAMP NULL)`,
    );
    const [columns] = await this.db.query('SHOW COLUMNS FROM platform_backups');
    if (!columns.some((c) => c.Field === 'size_bytes'))
      await this.db.query(
        'ALTER TABLE platform_backups ADD COLUMN size_bytes BIGINT UNSIGNED NULL',
      );
    await this.db.query(
      "UPDATE platform_backups SET status='failed',error_text='清理中断，请重新清理' WHERE status='deleting'",
    );
    await this.db.query(
      "UPDATE platform_backups SET status='failed',error_text='服务重启，备份未完成' WHERE status='running'",
    );
    await this.db.query(
      "UPDATE platform_backups SET verify_status='failed',error_text='服务重启，恢复验证未完成' WHERE verify_status='running'",
    );
  }
  directory(value) {
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw Object.assign(new Error('备份编号不正确'), { status: 400 });
    return path.join(this.root, value);
  }
  async create(value) {
    return writeStreamingBackup(this, value);
  }
  async readPackage(value) {
    return readBackup(this, value);
  }
  async measure(value) {
    const dir = this.directory(value);
    if (path.dirname(path.resolve(dir)) !== this.root) throw Error('备份路径不正确');
    return directoryBytes(dir);
  }
  async verify(value) {
    const snapshot = await this.readPackage(value);
    const temporary = 'math_restorecheck_' + crypto.randomUUID().replaceAll('-', ''),
      conn = await this.db.getConnection();
    let created = false,
      original,
      error;
    try {
      [[{ name: original }]] = await conn.query('SELECT DATABASE() AS name');
      await conn.query('CREATE DATABASE ' + id(temporary) + ' CHARACTER SET utf8mb4');
      created = true;
      await conn.query('USE ' + id(temporary));
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      await restoreTables(conn, snapshot, this.directory(value), rowsHash);
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
      await verifyTables(conn, snapshot, rowsHash);
      const [relations] = await conn.execute(
        'SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION',
        [temporary],
      );
      const groups = new Map();
      for (const relation of relations) {
        const key = relation.TABLE_NAME + '|' + relation.CONSTRAINT_NAME;
        groups.set(key, [...(groups.get(key) || []), relation]);
      }
      for (const group of groups.values()) {
        const first = group[0],
          join = group
            .map((r) => 'c.' + id(r.COLUMN_NAME) + '=p.' + id(r.REFERENCED_COLUMN_NAME))
            .join(' AND '),
          nonNull = group.map((r) => 'c.' + id(r.COLUMN_NAME) + ' IS NOT NULL').join(' AND ');
        const [[row]] = await conn.query(
          'SELECT COUNT(*) AS total FROM ' +
            id(first.TABLE_NAME) +
            ' c LEFT JOIN ' +
            id(first.REFERENCED_TABLE_NAME) +
            ' p ON ' +
            join +
            ' WHERE ' +
            nonNull +
            ' AND p.' +
            id(first.REFERENCED_COLUMN_NAME) +
            ' IS NULL',
        );
        if (Number(row.total)) throw new Error('恢复后的关联记录不完整');
      }
    } catch (e) {
      error = e;
    } finally {
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS=1');
        if (original) await conn.query('USE ' + id(original));
        if (created) await conn.query('DROP DATABASE ' + id(temporary));
      } catch (e) {
        error = new Error('恢复验证清理失败，请检查临时数据库 ' + temporary);
      } finally {
        if (error && (!original || /清理失败/.test(error.message))) conn.destroy();
        else conn.release();
      }
    }
    if (error) throw error;
  }
  register(route, audit) {
    route('get', '/backups', async (req, res) =>
      res.json(await backupList(this.db, req.query, this.running)),
    );
    const action = (verify) => async (req, res) => {
      const reason = String(req.body?.reason || '').trim();
      if (!reason || reason.length > 200)
        throw Object.assign(new Error('请填写操作原因，最多 200 字'), { status: 400 });
      const value = verify ? req.params.id : crypto.randomUUID();
      this.directory(value);
      if (this.running)
        throw Object.assign(new Error('已有备份或恢复验证正在执行'), { status: 409 });
      // Reserve synchronously before any database await, including validation.
      this.running = true;
      let conn;
      try {
        conn = await this.db.getConnection();
        await conn.beginTransaction();
        if (verify) {
          const [[row]] = await conn.execute(
            'SELECT status FROM platform_backups WHERE id=? FOR UPDATE',
            [value],
          );
          if (row?.status !== 'done')
            throw Object.assign(new Error('备份尚未完成'), { status: 400 });
          await conn.execute(
            "UPDATE platform_backups SET verify_status='running',verified_at=NULL,error_text=NULL WHERE id=?",
            [value],
          );
        } else
          await conn.execute("INSERT INTO platform_backups(id,status) VALUES(?,'running')", [
            value,
          ]);
        await audit(
          conn,
          req.user,
          verify ? 'backup_verify' : 'backup_create',
          value,
          'accepted',
          reason,
        );
        await conn.commit();
      } catch (e) {
        try {
          if (conn) await conn.rollback();
        } finally {
          this.running = false;
        }
        throw e;
      } finally {
        conn?.release();
      }
      res.status(202).json({ id: value });
      Promise.resolve()
        .then(() => (verify ? this.verify(value) : this.create(value)))
        .then(async () => {
          if (verify)
            await this.db.execute(
              "UPDATE platform_backups SET verify_status='done',verified_at=NOW(),error_text=NULL WHERE id=?",
              [value],
            );
          else {
            const size = await this.measure(value).catch(() => null);
            await this.db.execute(
              "UPDATE platform_backups SET status='done',size_bytes=?,error_text=NULL WHERE id=?",
              [size, value],
            );
          }
          // Audit availability must not change a completed backup into a failed one.
          try {
            await audit(
              this.db,
              req.user,
              verify ? 'backup_verify' : 'backup_create',
              value,
              'success',
              reason,
            );
          } catch {
            console.error('备份已完成，操作日志写入失败');
          }
        })
        .catch(async (e) => {
          const message = /校验|缺失|变化|关联|格式|清理|一致|文件名/.test(e.message)
            ? e.message
            : '备份或恢复验证失败，请检查数据库权限及存储空间';
          await this.db.execute(
            verify
              ? "UPDATE platform_backups SET verify_status='failed',error_text=? WHERE id=?"
              : "UPDATE platform_backups SET status='failed',error_text=? WHERE id=?",
            [message, value],
          );
          if (!verify) {
            const dir = this.directory(value);
            if (path.dirname(dir) !== this.root) throw new Error('备份清理路径不正确');
            await fs
              .rm(dir, { recursive: true, force: true })
              .catch(() => console.error('未完成的备份文件清理失败'));
          }
          try {
            await audit(
              this.db,
              req.user,
              verify ? 'backup_verify' : 'backup_create',
              value,
              'failed',
              message,
            );
          } catch {
            console.error('备份失败，操作日志写入失败');
          }
        })
        .catch(() => console.error('备份任务状态写入失败'))
        .finally(() => {
          this.running = false;
        });
    };
    route('post', '/backups', action(false));
    route('post', '/backups/:id/verify', action(true));
    route('get', '/backups/:id/download', async (req, res) => {
      const value = req.params.id;
      this.directory(value);
      if (this.deleting.has(value))
        throw Object.assign(new Error('备份正在清理，请稍后再试'), { status: 409 });
      this.downloads.set(value, (this.downloads.get(value) || 0) + 1);
      try {
        const [[row]] = await this.db.execute('SELECT status FROM platform_backups WHERE id=?', [
          value,
        ]);
        if (row?.status !== 'done') throw Object.assign(new Error('备份不可下载'), { status: 404 });
        await this.readPackage(value);
        await audit(this.db, req.user, 'backup_download', value, 'success', '下载备份');
        res.attachment('backup-' + value + '.zip');
        res.set('Cache-Control', 'no-store');
        const zip = new ZipArchive({ zlib: { level: 3 } });
        zip.on('error', () => res.destroy());
        res.on('close', () => zip.abort());
        zip.pipe(res);
        zip.directory(this.directory(value), false);
        await zip.finalize();
      } finally {
        const active = this.downloads.get(value) || 0;
        if (active > 1) this.downloads.set(value, active - 1);
        else this.downloads.delete(value);
      }
    });
    route('post', '/backups/:id/size', async (req, res) => {
      const value = req.params.id;
      this.directory(value);
      if (this.running) throw Object.assign(new Error('已有备份任务正在执行'), { status: 409 });
      this.running = true;
      try {
        const [[row]] = await this.db.execute('SELECT status FROM platform_backups WHERE id=?', [
          value,
        ]);
        if (!row || row.status === 'deleted')
          throw Object.assign(new Error('备份不存在'), { status: 404 });
        const size = await this.measure(value);
        await this.db.execute('UPDATE platform_backups SET size_bytes=? WHERE id=?', [size, value]);
        res.json({ sizeBytes: size });
      } finally {
        this.running = false;
      }
    });
    route('delete', '/backups/:id', async (req, res) => {
      const value = req.params.id,
        dir = this.directory(value),
        reason = String(req.body?.reason || '').trim();
      if (!reason || reason.length > 200)
        throw Object.assign(new Error('请填写清理原因，最多 200 字'), { status: 400 });
      if (this.running || this.downloads.has(value))
        throw Object.assign(new Error('备份正在使用，请稍后清理'), { status: 409 });
      this.running = true;
      this.deleting.add(value);
      let reserved = false;
      try {
        const connection = await this.db.getConnection();
        try {
          await connection.beginTransaction();
          const [[row]] = await connection.execute(
            'SELECT status,verify_status FROM platform_backups WHERE id=? FOR UPDATE',
            [value],
          );
          if (!row || row.status === 'deleted')
            throw Object.assign(new Error('备份不存在'), { status: 404 });
          if (row.status === 'running' || row.verify_status === 'running')
            throw Object.assign(new Error('备份正在使用'), { status: 409 });
          await connection.execute(
            "UPDATE platform_backups SET status='deleting',error_text=NULL WHERE id=?",
            [value],
          );
          await audit(connection, req.user, 'backup_delete', value, 'accepted', reason);
          await connection.commit();
          reserved = true;
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
        if (path.dirname(path.resolve(dir)) !== this.root) throw Error('备份清理路径不正确');
        const info = await fs.lstat(dir).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (info?.isSymbolicLink() || (info && !info.isDirectory()))
          throw Error('备份文件格式不正确');
        await fs.rm(dir, { recursive: true, force: true });
        await this.db.execute(
          "UPDATE platform_backups SET status='deleted',size_bytes=0,error_text=NULL WHERE id=?",
          [value],
        );
        reserved = false;
        try {
          await audit(this.db, req.user, 'backup_delete', value, 'success', reason);
        } catch {
          console.error('备份已清理，日志写入失败');
        }
        res.json({ message: '历史备份已清理，网站当前数据保留' });
      } catch (error) {
        if (reserved) {
          await this.db.execute(
            "UPDATE platform_backups SET status='failed',error_text='清理未完成，请重新检查或重试' WHERE id=?",
            [value],
          );
          try {
            await audit(this.db, req.user, 'backup_delete', value, 'failed', '清理未完成');
          } catch {}
        }
        throw error;
      } finally {
        this.deleting.delete(value);
        this.running = false;
      }
    });
  }
}
