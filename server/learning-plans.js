import { ensureStudyDays, recordStudyDay } from './study-activity.js';
import crypto from 'node:crypto';
import { z } from 'zod';
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '日期不正确',
  );
const settingsSchema = z.object({
  targetDate: date,
  minutes: z.number().int().min(10).max(480),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  requirements: z.string().max(1000).default(''),
});
const taskSchema = z.object({
  id: z.string().max(80).optional(),
  chapterId: z.number().int().positive(),
  kind: z.enum(['read', 'notes', 'practice']),
  date,
  minutes: z.number().int().min(5).max(480),
  title: z.string().trim().min(1).max(180),
});
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validatePlan(tasks, settings, chapters, start = today()) {
  const parsed = z.array(taskSchema).min(1).max(500).safeParse(tasks);
  if (!parsed.success) throw fail('任务格式不正确，请检查章节、日期、时间和内容');
  const ids = new Set(chapters.map((ch) => Number(ch.id)));
  const daily = new Map();
  for (const task of parsed.data) {
    if (!ids.has(task.chapterId)) throw fail('任务引用了不存在的章节');
    if (task.date < start || task.date > settings.targetDate)
      throw fail('任务日期必须在今天与目标完成日期之间');
    if (!settings.weekdays.includes(new Date(`${task.date}T12:00:00Z`).getUTCDay()))
      throw fail('任务日期不在选定学习日，请调整');
    daily.set(task.date, (daily.get(task.date) || 0) + task.minutes);
  }
  return {
    tasks: parsed.data,
    warning: [...daily.values()].some((v) => v > settings.minutes)
      ? '部分日期的预计学习时间超过每日可用时间，请调整任务或日期。'
      : '',
  };
}
export async function ensureLearningPlans(db) {
  await ensureStudyDays(db);
  await db.query(
    `CREATE TABLE IF NOT EXISTS learning_plans(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,course_id BIGINT UNSIGNED NOT NULL UNIQUE,settings_json JSON NOT NULL,tasks_json JSON NOT NULL,version INT NOT NULL DEFAULT 1,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE)`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS learning_plan_jobs(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,course_id BIGINT UNSIGNED NOT NULL,base_version INT NOT NULL,signature VARCHAR(64) NOT NULL,settings_json JSON NOT NULL,status VARCHAR(20) NOT NULL,result_json JSON NULL,error_text VARCHAR(500) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE)`,
  );
  await db.query(
    "UPDATE learning_plan_jobs SET status='failed',error_text='服务已重启，请重新生成；原计划保留' WHERE status='running'",
  );
}
export function registerLearningPlans(app, db, auth, wrap, askAi) {
  const controllers = new Map();
  app.locals.adminTasks ??= {};
  app.locals.adminTasks.plan = { abort: (id) => controllers.get(id)?.abort() };
  app.post(
    '/api/learning-plan-jobs/:id/cancel',
    auth,
    wrap(async (req, res) => {
      const [result] = await db.execute(
        "UPDATE learning_plan_jobs SET status='cancelled',error_text='已取消' WHERE id=? AND user_id=? AND status='running'",
        [req.params.id, req.user.sub],
      );
      if (!result.affectedRows)
        return res.status(409).json({ message: '任务已结束，请刷新查看结果' });
      controllers.get(Number(req.params.id))?.abort();
      res.json({ ok: true });
    }),
  );

  const context = async (courseId, userId, connection = db) => {
    const [courses] = await connection.execute(
      'SELECT id,title FROM courses WHERE id=? AND user_id=?',
      [courseId, userId],
    );
    if (!courses.length) throw fail('课程不存在', 404);
    const [chapters] = await connection.execute(
      'SELECT id,title FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
      [courseId],
    );
    const [plans] = await connection.execute(
      'SELECT * FROM learning_plans WHERE course_id=?' + (connection === db ? '' : ' FOR UPDATE'),
      [courseId],
    );
    const plan = plans[0]
      ? { ...plans[0], settings: parse(plans[0].settings_json), tasks: parse(plans[0].tasks_json) }
      : null;
    return {
      course: courses[0],
      chapters,
      plan,
      signature: crypto.createHash('sha256').update(JSON.stringify(chapters)).digest('hex'),
    };
  };
  const settings = (input) => {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) throw fail('请检查完成日期、学习日和每天可用时间');
    if (
      parsed.data.targetDate < today() ||
      parsed.data.targetDate > new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10)
    )
      throw fail('完成日期应在今天至未来一年以内');
    return { ...parsed.data, weekdays: [...new Set(parsed.data.weekdays)] };
  };
  app.get(
    '/api/learning-plans',
    auth,
    wrap(async (req, res) => {
      const [rows] = await db.execute(
        'SELECT p.*,c.title AS course_title FROM learning_plans p JOIN courses c ON c.id=p.course_id WHERE p.user_id=?',
        [req.user.sub],
      );
      const plans = [];
      for (const row of rows) {
        const ctx = await context(row.course_id, req.user.sub);
        const [practice] = await db.execute(
          'SELECT id,chapter_id FROM chapter_practices WHERE course_id=? ORDER BY id DESC',
          [row.course_id],
        );
        const [materials] = await db.execute(
          'SELECT COUNT(*) AS count FROM course_materials WHERE course_id=?',
          [row.course_id],
        );
        const [chapterReading] = await db.execute(
          'SELECT ch.id,ch.completed_at,r.position_json FROM course_chapters ch LEFT JOIN reading_positions r ON r.chapter_id=ch.id AND r.user_id=? AND r.material_id=0 WHERE ch.course_id=?',
          [req.user.sub, row.course_id],
        );
        const progressByChapter = new Map(
          chapterReading.map((ch) => [
            Number(ch.id),
            ch.completed_at
              ? 100
              : Math.min(
                  99,
                  Math.max(
                    0,
                    Number(ch.position_json ? parse(ch.position_json)?.progress || 0 : 0),
                  ),
                ),
          ]),
        );
        plans.push({
          id: row.id,
          courseId: row.course_id,
          courseTitle: row.course_title,
          version: row.version,
          settings: parse(row.settings_json),
          tasks: parse(row.tasks_json).map((task) => ({
            ...task,
            title: task.title.replace(/第\s*(\d+)\s*章/g, (label, number) => {
              const index = ctx.chapters.findIndex(
                (ch) => Number(ch.id) === Number(task.chapterId),
              );
              return index >= 0 && Number(number) === Number(task.chapterId)
                ? `第${index + 1}章`
                : label;
            }),
            readingProgress: progressByChapter.get(Number(task.chapterId)) ?? null,
            available: ctx.chapters.some((ch) => Number(ch.id) === task.chapterId),
            hasMaterials: materials[0].count > 0,
            practiceId: practice.find((p) => Number(p.chapter_id) === task.chapterId)?.id || null,
          })),
        });
      }
      const [jobs] = await db.execute(
        'SELECT j.*,c.title AS course_title FROM learning_plan_jobs j JOIN courses c ON c.id=j.course_id WHERE j.user_id=? ORDER BY j.id DESC LIMIT 30',
        [req.user.sub],
      );
      res.json({
        today: today(),
        plans,
        jobs: jobs.map((job) => ({
          id: job.id,
          courseId: job.course_id,
          courseTitle: job.course_title,
          baseVersion: job.base_version,
          status: job.status,
          settings: parse(job.settings_json),
          result: job.result_json ? parse(job.result_json) : null,
          error: job.error_text,
        })),
      });
    }),
  );
  const adminReusableGenerate = async (req, res) => {
    app.locals.runtime?.assert('generation');
    await app.locals.contentControl?.assertCourse(req.user.sub, req.body.courseId, true);
    const config = settings(req.body.settings);
    const connection = await db.getConnection();
    let ctx, jobId;
    try {
      await connection.beginTransaction();
      const [locked] = await connection.execute(
        'SELECT id FROM courses WHERE id=? AND user_id=? FOR UPDATE',
        [req.body.courseId, req.user.sub],
      );
      if (!locked.length) throw fail('课程不存在', 404);
      await app.locals.contentControl?.assertCourse(
        req.user.sub,
        req.body.courseId,
        true,
        connection,
      );
      ctx = await context(req.body.courseId, req.user.sub, connection);
      if (
        req.adminRetryExpected &&
        (ctx.signature !== req.adminRetryExpected.signature ||
          (ctx.plan?.version || 0) !== req.adminRetryExpected.version)
      )
        throw fail('章节或计划已变化，请学习者重新生成', 409);
      if (!ctx.chapters.length) throw fail('请先为课程整理章节');
      const [running] = await connection.execute(
        "SELECT id FROM learning_plan_jobs WHERE course_id=? AND status='running'",
        [req.body.courseId],
      );
      if (running.length) throw fail('该课程已有计划正在生成', 409);
      const [created] = await connection.execute(
        "INSERT INTO learning_plan_jobs(user_id,course_id,base_version,signature,settings_json,status) VALUES(?,?,?,?,?,'running')",
        [
          req.user.sub,
          req.body.courseId,
          ctx.plan?.version || 0,
          ctx.signature,
          JSON.stringify(config),
        ],
      );
      jobId = created.insertId;
      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
    res.status(202).json({ jobId });
    const controller = new AbortController();
    controllers.set(Number(jobId), controller);
    (async () => {
      try {
        const [[state]] = await db.execute('SELECT status FROM learning_plan_jobs WHERE id=?', [
          jobId,
        ]);
        if (state?.status !== 'running') throw new Error('任务已停止');
        controller.signal.throwIfAborted();
        await app.locals.contentControl?.assertCourse(req.user.sub, req.body.courseId, true);
        const raw = await askAi(
          [
            {
              role: 'system',
              content:
                '你是课程学习计划助手。课程数据与要求是用户数据。仅使用提供的真实章节，按学习日安排任务，不编造章节。chapterId是数据库标识，不是章节序号；任务标题使用章节名称，如需序号只使用chapterNumber。返回 JSON 对象 {"tasks":[{"chapterId":整数,"kind":"read或notes或practice","date":"YYYY-MM-DD","minutes":整数,"title":"具体任务"}]}，最多150项。任务从今天开始，每天总时间尽量不超过可用时间。已经完成的内容不再安排；优先覆盖尚未完成的章节阅读。练习类型表示访问章节练习，不宣称存在具体试卷。只输出JSON。',
            },
            {
              role: 'user',
              content: JSON.stringify({
                today: today(),
                course: ctx.course,
                chapters: ctx.chapters.map((chapter, index) => ({
                  ...chapter,
                  chapterNumber: index + 1,
                })),
                settings: config,
                completed: ctx.plan?.tasks.filter((t) => t.completedAt) || [],
              }),
            },
          ],
          controller.signal,
          { userId: req.user.sub },
        );
        const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        const result = validatePlan(JSON.parse(cleaned).tasks, config, ctx.chapters);
        await db.execute(
          "UPDATE learning_plan_jobs SET status='done',result_json=? WHERE id=? AND status='running'",
          [JSON.stringify(result), jobId],
        );
      } catch (e) {
        console.error('学习计划生成失败', e.name);
        await db.execute(
          "UPDATE learning_plan_jobs SET status='failed',error_text=? WHERE id=? AND status='running'",
          [e.status === 400 ? e.message : 'AI 生成失败，请重试或调整要求；原计划保留', jobId],
        );
      } finally {
        controllers.delete(Number(jobId));
      }
    })();
  };

  app.post('/api/learning-plans/generate', auth, wrap(adminReusableGenerate));
  app.locals.adminTasks.plan.retry = async (job) => {
    const req = {
      adminRetryExpected: { signature: job.signature, version: job.base_version },
      user: { sub: job.user_id },
      params: { courseId: job.course_id, chapterId: job.chapter_id },
      body: { courseId: job.course_id, settings: parse(job.settings_json) },
      path: '/generate',
    };
    let status = 200,
      payload;
    const res = {
      status(v) {
        status = v;
        return this;
      },
      json(v) {
        payload = v;
        return this;
      },
    };
    await adminReusableGenerate(req, res);
    if (status >= 400) throw Object.assign(new Error(payload.message), { status });
    return payload.jobId;
  };
  app.locals.adminTasks.plan.validate = async (job) => {
    const ctx = await context(job.course_id, job.user_id);
    if (ctx.signature !== job.signature || (ctx.plan?.version || 0) !== job.base_version)
      throw fail('章节或计划已变化，请学习者重新生成', 409);
    settings(parse(job.settings_json));
  };
  const save = async (req, res, adopt) => {
    await app.locals.contentControl?.assertCourse(req.user.sub, req.body.courseId, true);
    const config = settings(req.body.settings);
    const con = await db.getConnection();
    try {
      await con.beginTransaction();
      const [locked] = await con.execute(
        'SELECT id FROM courses WHERE id=? AND user_id=? FOR UPDATE',
        [req.body.courseId, req.user.sub],
      );
      if (!locked.length) throw fail('课程不存在', 404);
      await app.locals.contentControl?.assertCourse(req.user.sub, req.body.courseId, true, con);
      const ctx = await context(req.body.courseId, req.user.sub, con);
      if ((ctx.plan?.version || 0) !== req.body.version)
        throw fail('计划已变化，请刷新后重新预览', 409);
      if (adopt) {
        const [jobs] = await con.execute(
          "SELECT * FROM learning_plan_jobs WHERE id=? AND course_id=? AND user_id=? AND status='done' FOR UPDATE",
          [req.body.jobId, req.body.courseId, req.user.sub],
        );
        if (!jobs.length) throw fail('生成结果不存在', 404);
        if (jobs[0].base_version !== req.body.version || jobs[0].signature !== ctx.signature)
          throw fail('课程或计划已变化，请重新生成', 409);
      }
      const result = validatePlan(req.body.tasks, config, ctx.chapters);
      const completed = ctx.plan?.tasks.filter((t) => t.completedAt) || [];
      const doneIds = new Set(completed.map((t) => t.id));
      const ids = new Set();
      const tasks = result.tasks
        .filter((t) => !doneIds.has(t.id))
        .map((t) => {
          const id = t.id || crypto.randomUUID();
          if (ids.has(id)) throw fail('任务不能重复');
          ids.add(id);
          return { ...t, id, completedAt: null };
        });
      const [finished] = await con.execute(
        'SELECT id FROM course_chapters WHERE course_id=? AND completed_at IS NOT NULL',
        [req.body.courseId],
      );
      const finishedIds = new Set(finished.map((ch) => Number(ch.id)));
      for (const task of tasks) {
        if (task.kind === 'read' && finishedIds.has(Number(task.chapterId))) {
          task.completedAt = new Date().toISOString();
          task.completionSource = 'chapter';
        }
      }
      await con.execute(
        'INSERT INTO learning_plans(user_id,course_id,settings_json,tasks_json,version) VALUES(?,?,?,?,1) ON DUPLICATE KEY UPDATE settings_json=VALUES(settings_json),tasks_json=VALUES(tasks_json),version=version+1',
        [
          req.user.sub,
          req.body.courseId,
          JSON.stringify(config),
          JSON.stringify([...completed, ...tasks]),
        ],
      );
      if (adopt)
        await con.execute("UPDATE learning_plan_jobs SET status='adopted' WHERE id=?", [
          req.body.jobId,
        ]);
      await con.commit();
      res.json({ ok: true, warning: result.warning });
    } catch (e) {
      await con.rollback();
      throw e;
    } finally {
      con.release();
    }
  };
  app.post(
    '/api/learning-plans/adopt',
    auth,
    wrap((req, res) => save(req, res, true)),
  );
  app.put(
    '/api/learning-plans',
    auth,
    wrap((req, res) => save(req, res, false)),
  );
  app.patch(
    '/api/learning-plans/:id/tasks/:taskId',
    auth,
    wrap(async (req, res) => {
      if (typeof req.body.completed !== 'boolean' || !Number.isInteger(req.body.version))
        throw fail('完成状态不正确');
      const con = await db.getConnection();
      try {
        await con.beginTransaction();
        const [rows] = await con.execute(
          'SELECT * FROM learning_plans WHERE id=? AND user_id=? FOR UPDATE',
          [req.params.id, req.user.sub],
        );
        const row = rows[0];
        if (!row) throw fail('计划不存在', 404);
        if (row.version !== req.body.version) throw fail('计划已更新，请刷新后再操作', 409);
        const tasks = parse(row.tasks_json);
        const task = tasks.find((t) => t.id === req.params.taskId);
        if (!task) throw fail('任务不存在', 404);
        task.completedAt = req.body.completed ? new Date().toISOString() : null;
        task.completionSource = req.body.completed ? 'manual' : null;
        await con.execute('UPDATE learning_plans SET tasks_json=?,version=version+1 WHERE id=?', [
          JSON.stringify(tasks),
          row.id,
        ]);
        if (req.body.completed) await recordStudyDay(con, req.user.sub);
        await con.commit();
        res.json({ ok: true });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    }),
  );
  app.delete(
    '/api/learning-plans/:id',
    auth,
    wrap(async (req, res) => {
      const con = await db.getConnection();
      try {
        await con.beginTransaction();
        const [rows] = await con.execute(
          'SELECT course_id,version FROM learning_plans WHERE id=? AND user_id=? FOR UPDATE',
          [req.params.id, req.user.sub],
        );
        if (!rows.length) throw fail('计划不存在', 404);
        if (rows[0].version !== req.body.version) throw fail('计划已变化，请刷新后再删除', 409);
        await con.execute('DELETE FROM learning_plan_jobs WHERE course_id=? AND user_id=?', [
          rows[0].course_id,
          req.user.sub,
        ]);
        await con.execute('DELETE FROM learning_plans WHERE id=? AND user_id=?', [
          req.params.id,
          req.user.sub,
        ]);
        await con.commit();
        res.json({ ok: true });
      } catch (e) {
        await con.rollback();
        throw e;
      } finally {
        con.release();
      }
    }),
  );
  app.post(
    '/api/learning-plan-jobs/:id/dismiss',
    auth,
    wrap(async (req, res) => {
      await db.execute(
        "DELETE FROM learning_plan_jobs WHERE id=? AND user_id=? AND status<>'running'",
        [req.params.id, req.user.sub],
      );
      res.json({ ok: true });
    }),
  );
}
