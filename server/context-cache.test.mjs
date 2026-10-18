import 'dotenv/config';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { prepareLongContext, ensureLongContextCache } from './long-context.js';
const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid;
try {
  await ensureLongContextCache(db);
  const [u] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'缓存测试','test','disabled-test-login')",
    ['cache_' + Date.now()],
  );
  uid = u.insertId;
  const [c] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'缓存课程')", [uid]);
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')", [
    c.insertId,
  ]);
  const [other] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'第二章')",
    [c.insertId],
  );
  let calls = 0;
  const stages = [];
  const ask = async () => {
    calls++;
    return '本段要点，包含末尾概念。';
  };
  const options = {
    db,
    courseId: c.insertId,
    chapterId: ch.insertId,
    onProgress: (stage) => stages.push(stage),
  };
  const text = '资料段落。\n'.repeat(5000);
  const first = await prepareLongContext(text, ask, undefined, options);
  assert.ok(calls > 1);
  const firstCalls = calls;
  assert.equal(await prepareLongContext(text, ask, undefined, options), first);
  assert.equal(calls, firstCalls);
  assert.ok(stages.some((s) => s.includes('已复用')));
  assert.ok(stages.some((s) => s.includes('0/')));
  assert.ok(stages.some((s) => s.includes('资料整理完成')));
  await prepareLongContext(text + '新增知识点', ask, undefined, options);
  assert.ok(calls > firstCalls);
  const changedCalls = calls;
  await prepareLongContext(text + '新增知识点', ask, undefined, {
    ...options,
    chapterId: other.insertId,
  });
  assert.ok(calls > changedCalls);
  const beforeFailure = calls;
  await assert.rejects(() =>
    prepareLongContext(text + '失败输入', async () => '', undefined, options),
  );
  await prepareLongContext(text + '新增知识点', ask, undefined, options);
  assert.equal(calls, beforeFailure);
  await db.execute('DELETE FROM course_chapters WHERE id=?', [ch.insertId]);
  const [remaining] = await db.execute(
    'SELECT chapter_id FROM chapter_context_cache WHERE chapter_id=?',
    [ch.insertId],
  );
  assert.equal(remaining.length, 0);
  const courseOptions = { db, courseId: c.insertId, purpose: 'outline', model: 'test-outline' };
  const outlineMessages = [];
  const outlineAsk = async (messages) => {
    outlineMessages.push(messages);
    return messages[1].content.includes('最后一章') ? '最后一章：尾部知识' : '第一章：开头知识';
  };
  const book = text + '\n最后一章：尾部知识';
  const outline = await prepareLongContext(book, outlineAsk, undefined, courseOptions);
  assert.ok(outline.includes('最后一章'));
  assert.ok(outlineMessages.every((m) => m[0].content.includes('章节标题')));
  const outlineCalls = outlineMessages.length;
  assert.equal(await prepareLongContext(book, outlineAsk, undefined, courseOptions), outline);
  assert.equal(outlineMessages.length, outlineCalls);
  await prepareLongContext(book, outlineAsk, undefined, { ...courseOptions, purpose: 'knowledge' });
  assert.ok(outlineMessages.length > outlineCalls);
  const beforeChange = outlineMessages.length;
  await prepareLongContext(book + '新增资料', outlineAsk, undefined, courseOptions);
  assert.ok(outlineMessages.length > beforeChange);
  const beforeModel = outlineMessages.length;
  await prepareLongContext(book + '新增资料', outlineAsk, undefined, {
    ...courseOptions,
    model: 'another-model',
  });
  assert.ok(outlineMessages.length > beforeModel);
  const [courseCache] = await db.execute(
    'SELECT purpose FROM course_context_cache WHERE course_id=?',
    [c.insertId],
  );
  assert.equal(courseCache.length, 2);
  await db.execute('DELETE FROM courses WHERE id=?', [c.insertId]);
  const [afterDelete] = await db.execute(
    'SELECT course_id FROM course_context_cache WHERE course_id=?',
    [c.insertId],
  );
  assert.equal(afterDelete.length, 0);
  console.log(
    'PASS course context: last chapter coverage, title preservation prompt, persistent reuse, purpose/model/content isolation and cascade cleanup',
  );
  console.log(
    'PASS: persistent reuse, changed-content miss, chapter isolation, progress stages, failed result not cached and cascade cleanup',
  );
} finally {
  if (uid) await db.execute('DELETE FROM users WHERE id=?', [uid]);
  await db.end();
}
