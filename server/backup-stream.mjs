import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';

const identifier = (name) => {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw Error('数据库名称不正确');
  return '`' + name + '`';
};
const canonical = (value) =>
  Buffer.isBuffer(value)
    ? { data: [...value], type: 'Buffer' }
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const mask = (1n << 256n) - 1n;
function accumulator() {
  let count = 0,
    sum = 0n;
  return {
    add(row) {
      sum = (sum + BigInt('0x' + hash(JSON.stringify(canonical(row))))) & mask;
      count++;
    },
    finish() {
      return { count, hash: hash(count + ':' + sum.toString(16).padStart(64, '0')) };
    },
  };
}
const typed = (value) =>
  value && value.type === 'Buffer' && Array.isArray(value.data)
    ? Buffer.from(value.data)
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : value;
export async function fileHash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
export function databaseRows(connection, table) {
  return connection.connection
    .query({ sql: 'SELECT * FROM ' + identifier(table), dateStrings: true })
    .stream({ highWaterMark: 8 });
}

async function copyReference(store, dir, files, known, kind, name, required) {
  if (!name || path.basename(name) !== name || /[\\/]/.test(name)) throw Error('资料文件名不正确');
  const relative = kind + '/' + name;
  if (known.has(relative)) return true;
  const from = path.join(store.roots[kind], name),
    to = path.join(dir, relative);
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    const before = await fileHash(from);
    await fs.copyFile(from, to);
    if ((await fileHash(to)) !== before || (await fileHash(from)) !== before)
      throw Error('资料在备份过程中发生变化，请重试');
    files.push({ name: relative, hash: before });
    known.add(relative);
    return true;
  } catch (error) {
    if (!required && error.code === 'ENOENT') return false;
    throw Error(error.code === 'ENOENT' ? '原资料或笔记图片缺失，请先处理后再备份' : error.message);
  }
}
export async function writeStreamingBackup(store, value) {
  const dir = store.directory(value);
  await fs.mkdir(dir, { recursive: false });
  await fs.mkdir(path.join(dir, 'tables'));
  const connection = await store.db.getConnection();
  const manifest = { format: 2, createdAt: new Date().toISOString(), tables: [], files: [] },
    known = new Set();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [tables] = await connection.query('SHOW FULL TABLES');
    for (const record of tables) {
      const [name, type] = Object.values(record);
      if (type !== 'BASE TABLE' || name === 'platform_backups') continue;
      const [[ddl]] = await connection.query('SHOW CREATE TABLE ' + identifier(name));
      const file = 'tables/' + name + '.jsonl',
        output = await fs.open(path.join(dir, file), 'wx'),
        digest = accumulator();
      try {
        for await (const row of databaseRows(connection, name)) {
          if (name === 'course_materials' || name === 'note_attachments') {
            await copyReference(
              store,
              dir,
              manifest.files,
              known,
              name === 'course_materials' ? 'materials' : 'images',
              row.stored_name,
              true,
            );
            if (
              name === 'course_materials' &&
              row.preview_name &&
              !(await copyReference(
                store,
                dir,
                manifest.files,
                known,
                'previews',
                row.preview_name,
                false,
              ))
            )
              row.preview_name = null;
          }
          await output.writeFile(JSON.stringify(row) + '\n');
          digest.add(row);
        }
      } finally {
        await output.close();
      }
      manifest.tables.push({
        name,
        ddl: ddl['Create Table'],
        file,
        fileHash: await fileHash(path.join(dir, file)),
        ...digest.finish(),
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const json = JSON.stringify(manifest);
  await fs.writeFile(path.join(dir, 'database.json'), json);
  await fs.writeFile(path.join(dir, 'checksum.txt'), hash(json));
  return manifest.tables.length;
}
export async function readBackup(store, value) {
  const dir = store.directory(value),
    raw = await fs.readFile(path.join(dir, 'database.json'), 'utf8'),
    checksum = await fs.readFile(path.join(dir, 'checksum.txt'), 'utf8');
  if (hash(raw) !== checksum) throw Error('备份数据校验失败');
  const manifest = JSON.parse(raw);
  if (
    ![1, 2].includes(manifest.format) ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.files)
  )
    throw Error('备份格式不支持');
  for (const entry of manifest.files) {
    if (
      !/^(materials|images|previews)\/[^/\\]+$/.test(entry.name) ||
      (await fileHash(path.join(dir, entry.name))) !== entry.hash
    )
      throw Error('备份文件校验失败');
  }
  if (manifest.format === 2)
    for (const table of manifest.tables) {
      identifier(table.name);
      if (
        table.file !== 'tables/' + table.name + '.jsonl' ||
        (await fileHash(path.join(dir, table.file))) !== table.fileHash
      )
        throw Error('数据表文件校验失败');
    }
  return manifest;
}
async function* rowsFromFile(file) {
  const input = createReadStream(file),
    lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) throw Error('数据表格式不正确');
      yield JSON.parse(line);
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
export async function restoreTables(connection, manifest, dir, legacyHash) {
  for (const table of manifest.tables) {
    if (manifest.format === 1 && legacyHash(table.rows) !== table.hash)
      throw Error('数据表校验失败');
    await connection.query(table.ddl);
    let batch = [],
      size = 0;
    const digest = accumulator();
    const flush = async () => {
      if (!batch.length) return;
      const keys = Object.keys(batch[0]),
        placeholders = '(' + keys.map(() => '?').join(',') + ')';
      await connection.query(
        'INSERT INTO ' +
          identifier(table.name) +
          ' (' +
          keys.map(identifier).join(',') +
          ') VALUES ' +
          batch.map(() => placeholders).join(','),
        batch.flatMap((row) => keys.map((key) => typed(row[key]))),
      );
      batch = [];
      size = 0;
    };
    const rows = manifest.format === 1 ? table.rows : rowsFromFile(path.join(dir, table.file));
    for await (const row of rows) {
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (
        batch.length &&
        (batch.length >= 100 ||
          size + bytes > 1024 * 1024 ||
          batch.length * Object.keys(row).length > 50000)
      )
        await flush();
      batch.push(row);
      size += bytes;
      digest.add(row);
    }
    await flush();
    const result = digest.finish();
    if (manifest.format === 2 && (result.hash !== table.hash || result.count !== table.count))
      throw Error('数据表校验失败');
  }
}
export async function verifyTables(connection, manifest, legacyHash) {
  for (const table of manifest.tables) {
    if (manifest.format === 1) {
      const [rows] = await connection.query({
        sql: 'SELECT * FROM ' + identifier(table.name),
        dateStrings: true,
      });
      if (legacyHash(rows) !== table.hash) throw Error('恢复后的数据与备份不一致');
    } else {
      const digest = accumulator();
      for await (const row of databaseRows(connection, table.name)) digest.add(row);
      const result = digest.finish();
      if (result.hash !== table.hash || result.count !== table.count)
        throw Error('恢复后的数据与备份不一致');
    }
  }
}
export async function directoryBytes(directory) {
  let total = 0;
  for await (const entry of await fs.opendir(directory)) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('备份文件格式不正确');
    if (entry.isDirectory()) total += await directoryBytes(file);
    else if (entry.isFile()) total += (await fs.stat(file)).size;
  }
  return total;
}
