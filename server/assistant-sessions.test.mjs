import 'dotenv/config';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AssistantSessions, parseAssistantAnswer } from './assistant-sessions.js';
import { createAssistantContext, selectAssistantPassages } from './assistant-context.js';
import { readChatStream } from './ai-stream.js';

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
let uid, courseId, chapterId, otherChapter, sessions;
let wait = false,
  broken = false,
  aiCalls = 0,
  practiceCalls = 0,
  blocked = false,
  lastContext;
const waitFor = async (check) => {
  for (let n = 0; n < 100; n++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error('job timeout');
};
const assertCourse = async (user, course, materials, con = db) => {
  const [[row]] = await con.execute('SELECT id FROM courses WHERE id=? AND user_id=?', [
    course,
    user,
  ]);
  if (!row) throw Object.assign(Error('课程不存在'), { status: 404 });
  if (blocked && materials) throw Object.assign(Error('资料已暂停'), { status: 423 });
};
try {
  assert.deepEqual(
    parseAssistantAnswer('解释 [资料2]\n<followups>["为什么？","举例"]</followups>', [
      { name: 'a' },
      { name: 'b' },
    ]),
    { content: '解释 [资料2]', sources: [{ name: 'b' }], followups: ['为什么？', '举例'] },
  );
  assert.equal(parseAssistantAnswer('正文\n<follow').content, '正文');
  const wire =
    'data: ' +
    JSON.stringify({ choices: [{ delta: { content: '中文' } }] }) +
    '\n\ndata: [DONE]\n\n';
  const encoded = new TextEncoder().encode(wire);
  let bytes = 0,
    chunks = '';
  const response = new Response(
    new ReadableStream({
      pull(c) {
        if (bytes >= encoded.length) c.close();
        else c.enqueue(encoded.slice(bytes, ++bytes));
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  assert.equal(
    await readChatStream(response, (s) => {
      chunks += s;
    }),
    '中文',
  );
  assert.equal(chunks, '中文');
  await assert.rejects(
    () =>
      readChatStream(
        new Response('data: {"choices":[{"delta":{"content":"未完成"}}]}\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
        () => {},
      ),
    /中断/,
  );
  assert.equal(
    await readChatStream(
      new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 回答' } }] }), {
        headers: { 'content-type': 'application/json' },
      }),
      () => {},
    ),
    'JSON 回答',
  );
  assert.equal(
    selectAssistantPassages(
      [
        { name: 'a', content: '苹果。' },
        { name: 'b', content: '唯物辩证法与矛盾。' },
      ],
      '讲讲唯物辩证法',
    )[0].name,
    'b',
  );
  const [user] = await db.execute(
    "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'研习功能验证','test','disabled-test-login')",
    ['as_' + Date.now()],
  );
  uid = user.insertId;
  const [course] = await db.execute(
    "INSERT INTO courses(user_id,title) VALUES(?,'研习功能临时课程')",
    [uid],
  );
  courseId = course.insertId;
  const [ch] = await db.execute("INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')", [
    courseId,
  ]);
  chapterId = ch.insertId;
  const [ch2] = await db.execute(
    "INSERT INTO course_chapters(course_id,title) VALUES(?,'第二章')",
    [courseId],
  );
  otherChapter = ch2.insertId;
  sessions = new AssistantSessions(db, {
    assertCourse,
    assertModel: () => {},
    runtime: { assert: () => {} },
    questionSchema: z.object({
      type: z.string(),
      question: z.string(),
      options: z.array(z.string()),
      answer: z.string(),
      analysis: z.string(),
    }),
    context: async (user, course, chapter, question) => {
      lastContext = { user, course, chapter, question };
      return {
        text: '第一章：资料内容',
        preference: '',
        sources: [
          { name: '资料甲', materialId: 1 },
          { name: '资料乙', materialId: 2 },
        ],
      };
    },
    stream: async (messages, model, signal, onChunk) => {
      aiCalls++;
      await onChunk('第一段回答 [资料2]');
      if (wait)
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      signal.throwIfAborted();
      if (broken) throw Error('模拟网络中断');
      await onChunk('\n<followups>["如何理解第一章？","举个例子"]</followups>');
    },
    ask: async () => {
      practiceCalls++;
      return JSON.stringify({
        questions: [
          {
            type: '单选题',
            question: '题目',
            options: ['A.甲', 'B.乙', 'C.丙', 'D.丁'],
            answer: 'A',
            analysis: '源于资料',
          },
        ],
      });
    },
  });
  await sessions.init({ recover: false });
  const created = await sessions.create(uid, { id: randomUUID(), courseId, chapterId });
  const threadId = created.thread.id;
  await assert.rejects(
    () => sessions.detail(uid + 99999, threadId),
    (e) => e.status === 404,
  );
  const draft1 = await sessions.update(uid, threadId, { draft: '草稿一', version: 0 });
  assert.equal(draft1.version, 1);
  await assert.rejects(
    () => sessions.update(uid, threadId, { draft: '旧窗口', version: 0 }),
    (e) => e.status === 409,
  );
  const requestId = randomUUID();
  const answer = await sessions.send(uid, null, threadId, { requestId, question: '章节问题' });
  assert.equal(
    (await sessions.send(uid, null, threadId, { requestId, question: '章节问题' })).id,
    answer.id,
  );
  await waitFor(
    async () =>
      !(await sessions.detail(uid, threadId)).messages.some((m) => m.status === 'running'),
  );
  let detail = await sessions.detail(uid, threadId);
  assert.equal(aiCalls, 1);
  assert.equal(detail.messages.length, 2);
  assert.equal(lastContext.chapter, chapterId);
  assert.equal(detail.messages[1].sources[0].name, '资料乙');
  assert.equal(detail.messages[1].followups.length, 2);
  assert.equal(detail.thread.draft, '');
  await sessions.update(uid, threadId, {
    title: '第一章研习',
    draft: '未发送的另一问题',
    version: detail.thread.draft_version,
  });
  await sessions.send(uid, null, threadId, { requestId: randomUUID(), retryOf: answer.id });
  await waitFor(
    async () =>
      !(await sessions.detail(uid, threadId)).messages.some((m) => m.status === 'running'),
  );
  detail = await sessions.detail(uid, threadId);
  assert.equal(detail.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(detail.thread.draft, '未发送的另一问题');
  const generateInput = { requestId: randomUUID(), chapterId, count: 1, difficulty: '基础' };
  const exercise = await sessions.generatePractice(uid, null, threadId, answer.id, generateInput);
  assert.equal(
    (await sessions.generatePractice(uid, null, threadId, answer.id, generateInput)).id,
    exercise.id,
  );
  await waitFor(
    async () => (await sessions.detail(uid, threadId)).practiceDrafts[0]?.status === 'ready',
  );
  assert.equal(practiceCalls, 1);
  const [[before]] = await db.execute(
    'SELECT COUNT(*) n FROM chapter_practices WHERE course_id=?',
    [courseId],
  );
  assert.equal(before.n, 0);
  const adopted = await sessions.adopt(uid, threadId, exercise.id);
  const adoptedAgain = await sessions.adopt(uid, threadId, exercise.id);
  assert.equal(adopted.practice.id, adoptedAgain.practice.id);
  const [[after]] = await db.execute('SELECT COUNT(*) n FROM chapter_practices WHERE course_id=?', [
    courseId,
  ]);
  assert.equal(after.n, 1);
  const [[progress]] = await db.execute('SELECT completed_at FROM course_chapters WHERE id=?', [
    chapterId,
  ]);
  assert.equal(progress.completed_at, null);
  wait = true;
  const partial = await sessions.send(uid, null, threadId, {
    requestId: randomUUID(),
    question: '可以停止吗',
  });
  await waitFor(async () =>
    (await sessions.detail(uid, threadId)).messages.some((m) => m.id === partial.id && m.content),
  );
  await assert.rejects(
    () => sessions.send(uid, null, threadId, { requestId: randomUUID(), question: '重复并发' }),
    (e) => e.status === 409,
  );
  await sessions.stop(uid, threadId, partial.id);
  await Promise.all([...sessions.tasks]);
  assert.equal((await sessions.detail(uid, threadId)).messages.at(-1).status, 'stopped');
  assert.ok((await sessions.detail(uid, threadId)).messages.at(-1).content.includes('第一段'));
  wait = false;
  broken = true;
  await sessions.send(uid, null, threadId, { requestId: randomUUID(), question: '失败保留' });
  await Promise.all([...sessions.tasks]);
  assert.equal((await sessions.detail(uid, threadId)).messages.at(-1).status, 'failed');
  broken = false;
  blocked = true;
  await assert.rejects(
    () => sessions.send(uid, null, threadId, { requestId: randomUUID(), question: '暂停' }),
    (e) => e.status === 423,
  );
  blocked = false;
  const imported = await sessions.import(uid, {
    courseId,
    messages: [
      { role: 'user', content: '以前的问题' },
      { role: 'assistant', content: '以前的回答' },
    ],
  });
  assert.equal(
    (await sessions.import(uid, { courseId, messages: [{ role: 'user', content: '以前的问题' }] }))
      .id,
    imported.id,
  );
  assert.equal((await sessions.detail(uid, imported.id)).messages.length, 2);
  const scoped = await sessions.create(uid, { courseId, chapterId: otherChapter });
  await db.execute('DELETE FROM course_chapters WHERE id=?', [otherChapter]);
  assert.equal((await sessions.detail(uid, scoped.thread.id)).thread.scope_available, false);
  await assert.rejects(
    () =>
      sessions.send(uid, null, scoped.thread.id, {
        requestId: randomUUID(),
        question: '不存在章节',
      }),
    (e) => e.status === 404,
  );
  await sessions.remove(uid, threadId);
  await assert.rejects(
    () => sessions.detail(uid, threadId),
    (e) => e.status === 404,
  );
  const [[preserved]] = await db.execute(
    'SELECT COUNT(*) n FROM chapter_practices WHERE course_id=?',
    [courseId],
  );
  assert.equal(preserved.n, 1);
  console.log(
    'PASS: streaming, sources, scope, ownership, migration, drafts, idempotency, stop/retry, exercise preview/adoption, progress preservation',
  );
} finally {
  if (sessions) {
    for (const c of sessions.controllers.values()) c.abort();
    await Promise.all([...sessions.tasks]);
  }
  if (uid) await db.execute("DELETE FROM users WHERE id=? AND nickname='研习功能验证'", [uid]);
  await db.end();
}
