import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const active = new Set();

export async function ensureMobileThreads(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS mobile_learning_threads (
    id CHAR(36) PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,title VARCHAR(100) NOT NULL DEFAULT '新的对话',
    closed BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,INDEX mobile_threads_user(user_id,updated_at)
  )`);
  const [columns] = await db.query("SHOW COLUMNS FROM mobile_learning_answers LIKE 'thread_id'");
  if (!columns.length)
    await db.query(`ALTER TABLE mobile_learning_answers
    ADD COLUMN thread_id CHAR(36) NULL,ADD COLUMN sequence_no BIGINT UNSIGNED NULL,
    ADD INDEX mobile_thread_messages(thread_id,sequence_no),
    ADD CONSTRAINT fk_mobile_answer_thread FOREIGN KEY(thread_id) REFERENCES mobile_learning_threads(id) ON DELETE CASCADE`);
}
export async function ownedMobileThread(db, userId, id) {
  if (!z.string().uuid().safeParse(id).success) throw fail('对话编号不正确');
  const [[thread]] = await db.execute(
    'SELECT id,title,closed FROM mobile_learning_threads WHERE id=? AND user_id=?',
    [id, userId],
  );
  if (!thread) throw fail('对话不存在或无权访问', 404);
  return thread;
}
export async function withMobileThread(db, userId, id, action) {
  if (!id) return action(); // Compatibility with earlier APK versions.
  const thread = await ownedMobileThread(db, userId, id);
  if (thread.closed) throw fail('该对话已关闭，请从对话列表重新打开', 409);
  if (active.has(id)) throw fail('当前对话正在回答，请稍候', 409);
  active.add(id);
  try {
    return await action();
  } finally {
    active.delete(id);
  }
}
export async function insertThreadAnswer(db, userId, threadId, values, question) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[thread]] = await connection.execute(
      'SELECT id,title,closed FROM mobile_learning_threads WHERE id=? AND user_id=? FOR UPDATE',
      [threadId, userId],
    );
    if (!thread || thread.closed) throw fail('对话已关闭或删除，无法保存回答', 409);
    const [[last]] = await connection.execute(
      'SELECT COALESCE(MAX(sequence_no),0) value FROM mobile_learning_answers WHERE thread_id=?',
      [threadId],
    );
    await connection.execute(
      'INSERT INTO mobile_learning_answers(id,user_id,question_text,answer_text,analysis_text,request_text,thread_id,sequence_no) VALUES(?,?,?,?,?,?,?,?)',
      [...values, threadId, Number(last.value) + 1],
    );
    await connection.execute(
      'UPDATE mobile_learning_threads SET title=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND user_id=?',
      [
        thread.title === '新的对话' ? (question || '图片题目').slice(0, 36) : thread.title,
        threadId,
        userId,
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
async function adoptHistory(db, userId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
    const [[legacy]] = await connection.execute(
      'SELECT id FROM mobile_learning_answers WHERE user_id=? AND thread_id IS NULL LIMIT 1',
      [userId],
    );
    if (legacy) {
      const [[existing]] = await connection.execute(
        "SELECT id FROM mobile_learning_threads WHERE user_id=? AND title='历史对话' AND closed=FALSE ORDER BY created_at LIMIT 1",
        [userId],
      );
      const id = existing?.id || randomUUID();
      if (!existing)
        await connection.execute(
          "INSERT INTO mobile_learning_threads(id,user_id,title) VALUES(?,?,'历史对话')",
          [id, userId],
        );
      await connection.execute(
        'UPDATE mobile_learning_answers SET thread_id=? WHERE user_id=? AND thread_id IS NULL',
        [id, userId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
export function registerMobileThreads(app, { db, auth, asyncRoute }) {
  app.get(
    '/api/mobile/threads',
    auth,
    asyncRoute(async (req, res) => {
      await adoptHistory(db, req.user.sub);
      const [items] = await db.execute(
        'SELECT id,title,closed,created_at,updated_at FROM mobile_learning_threads WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 200',
        [req.user.sub],
      );
      res.json({ items: items.map((item) => ({ ...item, closed: Boolean(item.closed) })) });
    }),
  );
  app.post(
    '/api/mobile/threads',
    auth,
    asyncRoute(async (req, res) => {
      const id = randomUUID();
      await db.execute(
        "INSERT INTO mobile_learning_threads(id,user_id,title) VALUES(?,?,'新的对话')",
        [id, req.user.sub],
      );
      res.status(201).json({ id, title: '新的对话', closed: false });
    }),
  );
  app.patch(
    '/api/mobile/threads/:id',
    auth,
    asyncRoute(async (req, res) => {
      const parsed = z.object({ closed: z.boolean() }).strict().safeParse(req.body);
      if (!parsed.success) throw fail('对话状态不正确');
      await ownedMobileThread(db, req.user.sub, req.params.id);
      if (active.has(req.params.id)) throw fail('对话正在回答，完成后再关闭', 409);
      await db.execute(
        'UPDATE mobile_learning_threads SET closed=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND user_id=?',
        [parsed.data.closed, req.params.id, req.user.sub],
      );
      res.json({ success: true });
    }),
  );
  app.delete(
    '/api/mobile/threads/:id',
    auth,
    asyncRoute(async (req, res) => {
      await ownedMobileThread(db, req.user.sub, req.params.id);
      if (active.has(req.params.id)) throw fail('对话正在回答，完成后再删除', 409);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          'SELECT id FROM mobile_learning_threads WHERE id=? AND user_id=? FOR UPDATE',
          [req.params.id, req.user.sub],
        );
        const [messages] = await connection.execute(
          'SELECT id FROM mobile_learning_answers WHERE thread_id=? AND user_id=?',
          [req.params.id, req.user.sub],
        );
        await connection.execute('DELETE FROM mobile_learning_threads WHERE id=? AND user_id=?', [
          req.params.id,
          req.user.sub,
        ]);
        await connection.commit();
        res.json({ success: true, answerIds: messages.map((item) => item.id) });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
  );
}
