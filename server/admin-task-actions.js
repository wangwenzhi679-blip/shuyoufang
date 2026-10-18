import { z } from 'zod';
import { jobDiagnostic } from './admin-job-diagnostic.mjs';

const jobTables = {
  course: 'course_generation_jobs',
  note: 'note_ai_jobs',
  plan: 'learning_plan_jobs',
};
const actionSchema = z.object({ reason: z.string().trim().min(1).max(300) });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function ensureAdminTasks(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS admin_task_retries (
    source VARCHAR(12) NOT NULL,
    old_id BIGINT UNSIGNED NOT NULL,
    new_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(source,old_id)
  )`);
}

export function registerAdminTasks(route, app, db, audit, safeError) {
  async function loadJob(source, id) {
    if (!Object.hasOwn(jobTables, source) || !Number.isSafeInteger(id) || id < 1) {
      throw fail('任务编号无效');
    }
    const [[job]] = await db.execute(
      `SELECT j.*,u.account,u.status AS user_status,c.title AS course_title
       FROM ${jobTables[source]} j
       JOIN users u ON u.id=j.user_id
       LEFT JOIN courses c ON c.id=j.course_id
       WHERE j.id=?`,
      [id],
    );
    if (!job) throw fail('任务不存在', 404);
    return job;
  }

  async function getRetryBlockReason(source, job, retry) {
    if (job.status !== 'failed') return '仅失败任务可以重试';
    if (job.user_status !== 'active') return '所属账号已停用';
    if (!job.course_title) return '课程已删除';
    if (retry) return retry.new_id ? '该任务已经重试，请查看关联任务' : '重试正在处理';

    const runner = app.locals.adminTasks?.[source];
    let reason = '';
    try {
      app.locals.runtime?.assert('generation');
      await app.locals.contentControl?.assertCourse(job.user_id, job.course_id, true);
      await runner?.validate(job);
    } catch (error) {
      reason = error.message;
    }
    return runner?.retry ? reason : '此任务暂不支持管理员重试';
  }

  async function cancelJob(source, id, actor, reason) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const releaseActiveKey = source === 'course' ? ',active_key=NULL' : '';
      const [result] = await connection.execute(
        `UPDATE ${jobTables[source]} SET status='cancelled'${releaseActiveKey},error_text=?
         WHERE id=? AND status='running'`,
        ['已由管理员取消：' + reason, id],
      );
      if (!result.affectedRows) throw fail('任务已结束或正在保存，请刷新查看', 409);
      await audit(connection, actor, 'task_cancel', `${source}:${id}`, 'success', reason);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    app.locals.adminTasks?.[source]?.abort(id);
  }

  async function retryJob(source, id, job, actor, reason) {
    app.locals.runtime?.assert('generation');
    if (job.status !== 'failed') throw fail('仅失败任务可以重试', 409);
    if (job.user_status !== 'active' || !job.course_title) throw fail('账号或课程不可用', 409);
    const runner = app.locals.adminTasks?.[source];
    if (!runner?.retry) throw fail('该任务暂不支持重试', 409);
    await app.locals.contentControl?.assertCourse(job.user_id, job.course_id, true);
    await runner.validate(job);

    // Reserve the original job before starting work; the unique key prevents duplicate retries.
    try {
      await db.execute('INSERT INTO admin_task_retries(source,old_id) VALUES(?,?)', [source, id]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw fail('该任务已发起重试，请查看关联任务', 409);
      throw error;
    }

    let newId;
    try {
      newId = await runner.retry(job);
    } catch (error) {
      await db.execute(
        'DELETE FROM admin_task_retries WHERE source=? AND old_id=? AND new_id IS NULL',
        [source, id],
      );
      await audit(db, actor, 'task_retry', `${source}:${id}`, 'failed', '重试未创建');
      throw error;
    }
    await db.execute('UPDATE admin_task_retries SET new_id=? WHERE source=? AND old_id=?', [
      newId,
      source,
      id,
    ]);
    await audit(
      db,
      actor,
      'task_retry',
      `${source}:${id}`,
      'success',
      `新任务 ${source}:${newId}；${reason}`,
    );
    return newId;
  }

  route('get', '/jobs/:source/:id', async (req, res) => {
    const source = req.params.source;
    const id = Number(req.params.id);
    const job = await loadJob(source, id);
    const [[retry]] = await db.execute(
      'SELECT new_id FROM admin_task_retries WHERE source=? AND old_id=?',
      [source, id],
    );
    const retryReason = await getRetryBlockReason(source, job, retry);
    res.json({
      job: {
        id,
        source,
        kind: job.kind || (source === 'note' ? 'notes' : 'plan'),
        status: job.status,
        account: job.account,
        course_title: job.course_title,
        chapter_id: job.chapter_id,
        created_at: job.created_at,
        updated_at: job.updated_at || null,
        progress: job.progress_text || '',
        error_summary: safeError(job.status, job.error_text),
        diagnostic: jobDiagnostic(job),
        canCancel: job.status === 'running',
        canRetry: !retryReason,
        retryReason,
        newJobId: retry?.new_id || null,
      },
    });
  });

  route('post', '/jobs/:source/:id/:action', async (req, res) => {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) throw fail('请填写处理原因');
    const source = req.params.source;
    const id = Number(req.params.id);
    const job = await loadJob(source, id);
    const { action } = req.params;
    if (!['cancel', 'retry'].includes(action)) throw fail('操作无效');
    const { reason } = parsed.data;
    if (action === 'cancel') {
      await cancelJob(source, id, req.user, reason);
      return res.json({ message: '任务已取消' });
    }
    const newId = await retryJob(source, id, job, req.user, reason);
    res
      .status(202)
      .json({ message: '已创建重试任务，结果由学习者查看和采用', jobId: newId, source });
  });
}
