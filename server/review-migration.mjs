import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile, rename, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) });

const root = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(root, '../startup-logs');
const storage = {
  materials: path.join(root, 'storage/course-materials'),
  previews: path.join(root, 'storage/course-previews'),
  images: path.join(root, 'storage/note-images'),
  chapterImages: path.join(root, 'storage/chapter-images'),
  covers: path.join(root, 'storage/course-covers'),
};
const action = process.argv[2];
const account = process.argv[3];
const identifier = (value) => {
  if (!/^[a-z_]+$/i.test(value)) throw new Error('数据表名称不正确');
  return `\`${value}\``;
};
const hashFile = async (file) => crypto.createHash('sha256').update(await readFile(file)).digest('hex');
const scalar = (value) =>
  value && typeof value === 'object' && value.type === 'Buffer'
    ? Buffer.from(value.data)
    : value && typeof value === 'object'
      ? JSON.stringify(value)
      : value;
// 旧环境中的执行任务不应在云端恢复，以免重新执行或占用任务编号。
const transientTables = new Set([
  'material_import_jobs', 'course_generation_jobs', 'learning_plan_jobs', 'note_ai_jobs',
  'material_preview_repairs', 'course_cover_drafts', 'chapter_image_drafts',
]);
// 这些记录的主键没有被其他迁移记录引用，可直接使用云端自增编号。
const independentIds = new Set([
  'chapter_summaries', 'course_chapter_drafts', 'study_records',
  'reading_positions', 'reading_bookmarks', 'note_attachments', 'chapter_question_drafts',
]);
const linkedIds = new Set(['practice_questions', 'practice_attempts', 'wrong_questions', 'review_schedules']);

async function normalizeMigrationDates(db, entries) {
  const [columns] = await db.query(
    "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('date','datetime','timestamp')",
  );
  // 原本机导出使用香港时间；ISO 日期被 JSON 转成 UTC，需要恢复 +08:00。
  await db.query("SET time_zone = '+08:00'");
  for (const entry of entries) {
    const dates = columns.filter((column) => column.TABLE_NAME === entry.name);
    for (const row of entry.rows) {
      for (const column of dates) {
        const value = row[column.COLUMN_NAME];
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) continue;
        const instant = Date.parse(value);
        if (!Number.isFinite(instant)) throw new Error(`日期数据不正确：${entry.name}.${column.COLUMN_NAME}`);
        const local = new Date(instant + 8 * 60 * 60 * 1000).toISOString();
        row[column.COLUMN_NAME] = column.DATA_TYPE === 'date'
          ? local.slice(0, 10)
          : local.slice(0, 19).replace('T', ' ');
      }
    }
  }
}
const command = (program, args, cwd) =>
  new Promise((resolve, reject) => {
    const task = spawn(program, args, { cwd, windowsHide: true });
    let message = '';
    task.stderr.on('data', (chunk) => (message += chunk));
    task.on('error', reject);
    task.on('close', (code) => (code === 0 ? resolve() : reject(new Error(message || `${program} 执行失败`))));
  });
const ids = (values) => [...new Set(values.filter((value) => value != null))];
const where = (column, values) => ({ sql: values.length ? `${identifier(column)} IN (${values.map(() => '?').join(',')})` : '1=0', values });

async function database() {
  if (!process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) throw new Error('请先配置 server/.env');
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
}

async function exportRows(db, table, condition) {
  const [rows] = await db.execute(`SELECT * FROM ${identifier(table)} WHERE ${condition.sql}`, condition.values);
  return rows;
}

async function exportReview() {
  if (!/^review_[a-f0-9]{8}$/.test(account || '')) throw new Error('请指定原评审账号');
  const db = await database();
  const created = new Date().toISOString().replace(/[:.]/g, '-');
  const folderName = `评审体验迁移-${account}-${created}`;
  const work = path.join(outputRoot, folderName);
  const archive = path.join(outputRoot, `${folderName}.tar.gz`);
  try {
    const [users] = await db.execute('SELECT * FROM users WHERE account=?', [account]);
    if (users.length !== 1) throw new Error('未找到原评审账号');
    const user = users[0];
    const [tables] = await db.query('SHOW TABLES');
    const existing = new Set(tables.map((row) => Object.values(row)[0]));
    const rows = {};
    const get = async (table, condition) => {
      if (!existing.has(table)) return [];
      const value = await exportRows(db, table, condition);
      if (value.length) rows[table] = value;
      return value;
    };
    rows.users = [user];
    const userScope = where('user_id', [user.id]);
    const courses = await get('courses', userScope);
    const courseIds = ids(courses.map((row) => row.id));
    const courseScope = where('course_id', courseIds);
    const chapters = await get('course_chapters', courseScope);
    const chapterIds = ids(chapters.map((row) => row.id));
    const chapterScope = where('chapter_id', chapterIds);
    const materials = await get('course_materials', courseScope);
    const materialIds = ids(materials.map((row) => row.id));
    const practices = await get('chapter_practices', courseScope);
    const practiceIds = ids(practices.map((row) => row.id));
    const questions = await get('practice_questions', where('practice_id', practiceIds));
    const questionIds = ids(questions.map((row) => row.id));
    const threads = await get('assistant_threads', userScope);
    const threadIds = ids(threads.map((row) => row.id));

    for (const table of ['learner_profiles', 'user_preferences', 'study_days', 'study_records']) await get(table, userScope);
    for (const table of [
      'course_chapter_drafts', 'course_context_cache', 'course_covers', 'course_cover_drafts',
      'course_generation_jobs', 'learning_plans', 'learning_plan_jobs', 'learning_progress',
      'material_import_jobs', 'note_attachments', 'note_ai_jobs', 'reading_bookmarks',
      'reading_positions', 'practice_attempts', 'practice_in_progress',
      'chapter_images', 'chapter_notes',
    ]) await get(table, table === 'note_attachments' ? userScope : courseScope);
    await get('review_schedules', userScope);
    for (const table of [
      'chapter_context_cache', 'chapter_image_drafts', 'chapter_question_drafts', 'chapter_summaries',
    ]) await get(table, chapterScope);
    await get('chapter_source_corrections', courseScope);
    await get('material_preview_repairs', where('material_id', materialIds));
    await get('wrong_questions', where('question_id', questionIds));
    await get('assistant_messages', where('thread_id', threadIds));
    await get('assistant_practice_drafts', userScope);

    await mkdir(work, { recursive: false });
    const files = [];
    const seen = new Set();
    const include = async (kind, name, required = true) => {
      if (!name || seen.has(`${kind}/${name}`)) return;
      if (path.basename(name) !== name) throw new Error('资料文件名不正确');
      const source = path.join(storage[kind], name);
      try {
        await stat(source);
      } catch (error) {
        if (!required && error.code === 'ENOENT') return;
        throw new Error(`缺少评审资料文件：${name}`);
      }
      const relative = `files/${kind}/${name}`;
      const target = path.join(work, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      files.push({ relative, kind, name, sha256: await hashFile(target) });
      seen.add(`${kind}/${name}`);
    };
    for (const row of rows.course_materials || []) {
      await include('materials', row.stored_name);
      await include('previews', row.preview_name, false);
    }
    for (const row of rows.note_attachments || []) await include('images', row.stored_name);
    for (const row of rows.chapter_images || []) await include('chapterImages', row.filename, false);
    for (const row of rows.course_covers || []) await include('covers', row.filename, false);

    const manifest = {
      format: 1,
      kind: 'shuyoufang-review-migration',
      createdAt: new Date().toISOString(),
      account,
      tables: Object.entries(rows).map(([name, values]) => ({ name, rows: values })),
      files,
    };
    await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest));
    await command('tar', ['-czf', archive, '-C', work, '.'], outputRoot);
    console.log(`迁移包已生成：${archive}`);
    console.log(`包含 ${courses.length} 门课程、${materials.length} 份资料和 ${files.length} 个关联文件。`);
    console.log('该文件包含私密学习数据，请勿上传 GitHub。');
  } finally {
    await db.end();
  }
}

async function insertRows(db, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const values = rows.map((row) => columns.map((column) => scalar(row[column])));
  for (let start = 0; start < values.length; start += 100) {
    const batch = values.slice(start, start + 100);
    await db.query(
      `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(',')}) VALUES ${batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`,
      batch.flat(),
    );
  }
}

// 练习题、答卷、错题和复习安排的编号在不同环境中都可能被占用。
// 这四类记录改由云端重新分配编号，并在导入中更新它们之间的引用。
async function insertRowsWithNewIds(db, table, rows, transform = (row) => row) {
  const mapped = new Map();
  for (const original of rows) {
    const row = transform({ ...original });
    const oldId = row.id;
    delete row.id;
    const columns = Object.keys(row);
    const [result] = await db.query(
      `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      columns.map((column) => scalar(row[column])),
    );
    mapped.set(oldId, result.insertId);
  }
  return mapped;
}

async function importReview(directory) {
  const manifestPath = path.resolve(directory || '');
  const manifest = JSON.parse(await readFile(path.join(manifestPath, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || manifest.kind !== 'shuyoufang-review-migration' || !Array.isArray(manifest.tables))
    throw new Error('迁移包格式不正确');
  manifest.tables = manifest.tables.filter((entry) => !transientTables.has(entry.name));
  const userEntry = manifest.tables.find((entry) => entry.name === 'users');
  if (!userEntry || userEntry.rows.length !== 1 || userEntry.rows[0].account !== manifest.account)
    throw new Error('迁移账号数据不正确');
  for (const file of manifest.files || []) {
    if (!storage[file.kind] || !/^files\/[a-zA-Z]+\/[^/\\]+$/.test(file.relative) || path.basename(file.name) !== file.name)
      throw new Error('迁移包文件不正确');
    if ((await hashFile(path.join(manifestPath, file.relative))) !== file.sha256) throw new Error('迁移包文件校验失败');
  }
  const db = await database();
  const staging = path.join(root, 'storage', `.review-migration-${Date.now()}`);
  try {
    const [sameAccount] = await db.execute('SELECT id FROM users WHERE account=?', [manifest.account]);
    if (sameAccount.length) throw new Error('云端已存在该评审账号；为防止覆盖，未导入任何数据');
    const [tables] = await db.query('SHOW TABLES');
    const existing = new Set(tables.map((row) => Object.values(row)[0]));
    await normalizeMigrationDates(db, manifest.tables);
    for (const entry of manifest.tables) {
      if (!existing.has(entry.name)) throw new Error(`云端缺少数据表：${entry.name}`);
      if (!Array.isArray(entry.rows) || !entry.rows.length) continue;
      if ('id' in entry.rows[0] && !linkedIds.has(entry.name) && !independentIds.has(entry.name)) {
        const ids = entry.rows.map((row) => row.id);
        const [conflict] = await db.query(
          `SELECT id FROM ${identifier(entry.name)} WHERE id IN (${ids.map(() => '?').join(',')}) LIMIT 1`,
          ids,
        );
        if (conflict.length) throw new Error(`云端已有冲突数据（${entry.name}）；未导入任何数据`);
      }
    }
    await mkdir(staging, { recursive: false });
    for (const file of manifest.files || []) {
      const final = path.join(storage[file.kind], file.name);
      try {
        await stat(final);
        throw new Error(`云端已有同名资料文件：${file.name}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const target = path.join(staging, file.kind, file.name);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(manifestPath, file.relative), target);
    }
    const order = [
      'users', 'learner_profiles', 'user_preferences', 'study_days', 'study_records', 'courses',
      'course_chapters', 'course_materials', 'course_chapter_drafts', 'course_context_cache',
      'chapter_context_cache', 'chapter_source_corrections', 'chapter_summaries', 'chapter_question_drafts',
      'chapter_practices', 'practice_questions', 'practice_attempts', 'practice_in_progress',
      'wrong_questions', 'review_schedules', 'learning_plans', 'learning_plan_jobs', 'learning_progress',
      'course_covers', 'course_cover_drafts', 'course_generation_jobs', 'material_import_jobs',
      'material_preview_repairs', 'chapter_images', 'chapter_image_drafts', 'chapter_notes',
      'note_attachments', 'note_ai_jobs', 'reading_bookmarks', 'reading_positions',
      'assistant_threads', 'assistant_messages', 'assistant_practice_drafts',
    ];
    const entries = [...manifest.tables].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    const entry = (name) => entries.find((value) => value.name === name)?.rows || [];
    await db.beginTransaction();
    try {
      for (const value of entries) {
        if (linkedIds.has(value.name)) continue;
        if (independentIds.has(value.name)) await insertRowsWithNewIds(db, value.name, value.rows);
        else await insertRows(db, value.name, value.rows);
      }
      const questionIds = await insertRowsWithNewIds(db, 'practice_questions', entry('practice_questions'));
      await insertRowsWithNewIds(db, 'practice_attempts', entry('practice_attempts'));
      const wrongIds = await insertRowsWithNewIds(db, 'wrong_questions', entry('wrong_questions'), (row) => ({
        ...row,
        question_id: questionIds.get(row.question_id) ?? row.question_id,
      }));
      await insertRowsWithNewIds(db, 'review_schedules', entry('review_schedules'), (row) => ({
        ...row,
        source_id: wrongIds.get(row.source_id) ?? row.source_id,
        wrong_question_id: wrongIds.get(row.wrong_question_id) ?? row.wrong_question_id,
      }));
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    }
    for (const file of manifest.files || []) {
      const from = path.join(staging, file.kind, file.name);
      const to = path.join(storage[file.kind], file.name);
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    }
    console.log(`评审账号 ${manifest.account} 及其课程已导入云端。`);
    console.log('账号密码沿用原账号，不会写入 GitHub。');
  } finally {
    await rm(staging, { recursive: true, force: true });
    await db.end();
  }
}

try {
  if (action === 'export') await exportReview();
  else if (action === 'import') await importReview(process.argv[3]);
  else throw new Error('用法：node server/review-migration.mjs export 旧评审账号；或 node server/review-migration.mjs import 解压后的迁移目录');
} catch (error) {
  console.error(`评审迁移未完成：${error.message}`);
  process.exitCode = 1;
}
