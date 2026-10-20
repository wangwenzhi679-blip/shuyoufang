import crypto from 'node:crypto';
export async function ensureGenerationJobs(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS course_generation_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, course_id BIGINT UNSIGNED NOT NULL,
    chapter_id BIGINT UNSIGNED NULL, kind VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL,
    active_key VARCHAR(100) NULL UNIQUE, input_json JSON NOT NULL, result_json JSON NULL,
    error_text TEXT NULL, dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE)`);
  const [columns] = await db.query('SHOW COLUMNS FROM course_generation_jobs');
  if (!columns.some((column) => column.Field === 'progress_text'))
    await db.query('ALTER TABLE course_generation_jobs ADD COLUMN progress_text VARCHAR(120) NULL');
  await db.execute(
    "UPDATE course_generation_jobs SET status='failed',active_key=NULL,error_text='服务已重启，请重新生成' WHERE status IN ('running','saving')",
  );
}

export function registerGenerationJobs(app, db, auth, wrap, run) {
  const controllers = new Map();
  const activeCourses = new Map();
  const decode = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
  const signature = async (courseId) => {
    const [materials] = await db.execute(
      "SELECT id,original_name,SHA2(COALESCE(extracted_text,''),256) AS hash FROM course_materials WHERE course_id=? ORDER BY id",
      [courseId],
    );
    const [chapters] = await db.execute(
      'SELECT id,title,description,source_regions_json FROM course_chapters WHERE course_id=? ORDER BY id',
      [courseId],
    );
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ materials, chapters }))
      .digest('hex');
  };
  const start = async (userId, input, expectedSignature) => {
    app.locals.runtime?.assert('generation');
    await app.locals.contentControl?.assertCourse(userId, input.courseId, true);
    const courseId = Number(input.courseId),
      chapterId = input.chapterId == null ? null : Number(input.chapterId);
    if (
      !['chapters', 'summary', 'practice'].includes(input.kind) ||
      !Number.isSafeInteger(courseId) ||
      courseId < 1 ||
      (input.kind !== 'chapters' && (!Number.isSafeInteger(chapterId) || chapterId < 1))
    )
      throw Object.assign(new Error('生成条件无效'), { status: 400 });
    const [owned] = await db.execute('SELECT id FROM courses WHERE id=? AND user_id=?', [
      courseId,
      userId,
    ]);
    if (!owned.length) throw Object.assign(new Error('课程不存在'), { status: 404 });
    if (chapterId !== null) {
      const [chapters] = await db.execute(
        'SELECT id FROM course_chapters WHERE id=? AND course_id=?',
        [chapterId, courseId],
      );
      if (!chapters.length) throw Object.assign(new Error('章节不存在'), { status: 404 });
    }
    const currentSignature = await signature(courseId);
    if (expectedSignature && expectedSignature !== currentSignature)
      throw Object.assign(new Error('资料或章节已变化，请学习者重新生成'), { status: 409 });
    const normalized = { ...input, courseId, chapterId, _adminSignature: currentSignature };
    let created;
    try {
      [created] = await db.execute(
        "INSERT INTO course_generation_jobs(user_id,course_id,chapter_id,kind,status,active_key,input_json) VALUES(?,?,?,?,'running',?,?)",
        [
          userId,
          courseId,
          chapterId,
          input.kind,
          `${userId}:${input.kind}:${courseId}:${chapterId || 0}`,
          JSON.stringify(normalized),
        ],
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY')
        throw Object.assign(new Error('已有相同生成任务，请等待完成'), { status: 409 });
      throw e;
    }
    const id = created.insertId,
      controller = new AbortController();
    controllers.set(id, controller);
    activeCourses.set(id, courseId);
    const save = async (connection = db) => {
      controller.signal.throwIfAborted();
      await app.locals.contentControl?.assertCourse(userId, courseId, true, connection);
      // 目录事务可复用此连接，不占住一个连接后再等待另一个连接。
      const [changed] = await connection.execute(
        "UPDATE course_generation_jobs SET status='saving' WHERE id=? AND status='running'",
        [id],
      );
      if (!changed.affectedRows) throw new Error('任务已取消');
    };
    Promise.resolve()
      .then(async () => {
        const [[state]] = await db.execute('SELECT status FROM course_generation_jobs WHERE id=?', [
          id,
        ]);
        if (state?.status !== 'running') throw new Error('任务已停止');
        controller.signal.throwIfAborted();
        return run(userId, normalized, controller.signal, save, async (stage) => {
          controller.signal.throwIfAborted();
          const [progress] = await db.execute(
            "UPDATE course_generation_jobs SET progress_text=? WHERE id=? AND status='running'",
            [stage, id],
          );
          if (!progress.affectedRows) {
            controller.abort(new Error('课程或任务已删除，生成已停止'));
            controller.signal.throwIfAborted();
          }
        });
      })
      .then(async (result) => {
        controller.signal.throwIfAborted();
        await db.execute(
          "UPDATE course_generation_jobs SET status='done',active_key=NULL,result_json=? WHERE id=? AND status IN ('running','saving')",
          [JSON.stringify(result), id],
        );
      })
      .catch(async (e) => {
        await db.execute(
          "UPDATE course_generation_jobs SET status='failed',active_key=NULL,error_text=? WHERE id=? AND status IN ('running','saving')",
          [e.message || '生成失败，请重试', id],
        );
      })
      .catch((e) => console.error('生成任务状态更新失败', e.message))
      .finally(() => {
        controllers.delete(id);
        activeCourses.delete(id);
      });
    return id;
  };
  app.locals.adminTasks ??= {};
  app.locals.adminTasks.course = {
    abortCourse: (courseId) => {
      for (const [id, controller] of controllers)
        if (Number(activeCourses.get(id)) === Number(courseId))
          controller.abort(new Error('课程已删除，生成已停止'));
    },
    abort: (id) => controllers.get(id)?.abort(),
    validate: async (job) => {
      const input = decode(job.input_json);
      if (!input._adminSignature)
        throw Object.assign(new Error('历史任务缺少资料版本，请学习者重新生成'), { status: 409 });
      if (input._adminSignature !== (await signature(job.course_id)))
        throw Object.assign(new Error('资料或章节已变化，请学习者重新生成'), { status: 409 });
    },
    retry: (job) =>
      start(job.user_id, decode(job.input_json), decode(job.input_json)._adminSignature),
  };
  app.get(
    '/api/generation-jobs',
    auth,
    wrap(async (req, res) => {
      const [jobs] = await db.execute(
        'SELECT id,course_id,chapter_id,kind,status,input_json,error_text,progress_text FROM course_generation_jobs WHERE user_id=? AND dismissed=FALSE ORDER BY id DESC',
        [req.user.sub],
      );
      res.json({ jobs: jobs.map((job) => ({ ...job, input: decode(job.input_json) })) });
    }),
  );
  app.post(
    '/api/generation-jobs',
    auth,
    wrap(async (req, res) =>
      res.status(202).json({ jobId: await start(req.user.sub, req.body || {}) }),
    ),
  );
  for (const action of ['cancel', 'retry', 'dismiss'])
    app.post(
      `/api/generation-jobs/:id/${action}`,
      auth,
      wrap(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1)
          return res.status(400).json({ message: '任务编号无效' });
        const [rows] = await db.execute(
          'SELECT * FROM course_generation_jobs WHERE id=? AND user_id=?',
          [id, req.user.sub],
        );
        const job = rows[0];
        if (!job) return res.status(404).json({ message: '任务不存在' });
        if (action === 'cancel') {
          const [updated] = await db.execute(
            "UPDATE course_generation_jobs SET status='cancelled',active_key=NULL,error_text='已取消' WHERE id=? AND status='running'",
            [id],
          );
          if (!updated.affectedRows)
            return res.status(409).json({ message: '任务已完成或正在保存，不能取消' });
          controllers.get(id)?.abort();
        } else if (action === 'retry') {
          if (!['failed', 'cancelled'].includes(job.status))
            return res.status(409).json({ message: '当前任务不能重试' });
          const jobId = await start(req.user.sub, decode(job.input_json));
          await db.execute('UPDATE course_generation_jobs SET dismissed=TRUE WHERE id=?', [id]);
          return res.status(202).json({ jobId });
        } else {
          if (['running', 'saving'].includes(job.status))
            return res.status(409).json({ message: '请先取消生成任务' });
          await db.execute('UPDATE course_generation_jobs SET dismissed=TRUE WHERE id=?', [id]);
        }
        res.json({ ok: true });
      }),
    );
}
