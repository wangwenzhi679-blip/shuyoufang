import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const tables = { course: 'courses', material: 'course_materials' };
export async function ensureAdminContent(db) {
  for (const table of Object.values(tables)) {
    const [columns] = await db.query(`SHOW COLUMNS FROM ${table}`);
    for (const [name, type] of [
      ['admin_status', "VARCHAR(16) NOT NULL DEFAULT 'active'"],
      ['admin_reason', "VARCHAR(300) NOT NULL DEFAULT ''"],
      ['admin_changed_at', 'DATETIME NULL'],
      ['admin_version', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ])
      if (!columns.some((c) => c.Field === name))
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  await db.query(
    `CREATE TABLE IF NOT EXISTS material_preview_repairs(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,material_id BIGINT UNSIGNED NOT NULL,status VARCHAR(16) NOT NULL,active_key BIGINT UNSIGNED NULL UNIQUE,error_text VARCHAR(300) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(material_id) REFERENCES course_materials(id) ON DELETE CASCADE)`,
  );
  await db.execute(
    "UPDATE material_preview_repairs SET status='failed',active_key=NULL,error_text='服务重启，请重新修复' WHERE status='running'",
  );
}
export function createContentControl(db) {
  async function assertCourse(userId, courseId, materials = false, connection = db) {
    if (!Number.isSafeInteger(Number(courseId)) || Number(courseId) < 1)
      throw fail('课程编号无效', 400);
    const [[course]] = await connection.execute(
      'SELECT admin_status,admin_reason,admin_changed_at FROM courses WHERE id=? AND user_id=?',
      [courseId, userId],
    );
    if (!course) throw fail('课程不存在或无权访问', 404);
    if (course.admin_status === 'paused') throw fail('课程已暂停：' + course.admin_reason, 423);
    if (materials) {
      const [[blocked]] = await connection.execute(
        "SELECT admin_reason FROM course_materials WHERE course_id=? AND admin_status='paused' LIMIT 1",
        [courseId],
      );
      if (blocked)
        throw fail('本课程有暂停资料，暂不能读取章节原文或生成内容：' + blocked.admin_reason, 423);
    }
  }
  async function middleware(req, res, next) {
    try {
      const requestPath = req.path.toLowerCase().replace(/\/+$/, '');
      const match = requestPath.match(/^\/api\/courses\/(\d+)(?:\/|$)/);
      let courseId = match?.[1];
      const directMaterial = requestPath.match(/\/materials\/(\d+)(?:\/|$)/)?.[1];
      const materialId = directMaterial || req.query.materialId;
      if (
        !courseId &&
        [
          '/api/assistant/ask',
          '/api/generation-jobs',
          '/api/learning-plans/generate',
          '/api/learning-plans/adopt',
          '/api/learning-plans',
        ].includes(requestPath) &&
        req.method !== 'GET'
      )
        courseId = req.body?.courseId;
      if (!courseId && /\/api\/generation-jobs\/\d+\/retry$/.test(requestPath)) {
        const [[job]] = await db.execute(
          'SELECT course_id FROM course_generation_jobs WHERE id=? AND user_id=?',
          [requestPath.split('/')[3], req.user.sub],
        );
        courseId = job?.course_id;
      }
      if (!courseId && /^\/api\/notes\/images\/\d+$/.test(requestPath)) {
        const [[image]] = await db.execute(
          'SELECT course_id FROM note_attachments WHERE id=? AND user_id=?',
          [requestPath.split('/')[4], req.user.sub],
        );
        courseId = image?.course_id;
      }
      if (courseId) {
        const derived =
          !directMaterial &&
          (/\/(content|summary|suggest|confirm-draft|generate|organize|adopt)$/.test(requestPath) ||
            requestPath === '/api/assistant/ask' ||
            requestPath.includes('generation-jobs'));
        await assertCourse(req.user.sub, courseId, derived);
        if (materialId && Number(materialId) > 0) {
          const [[material]] = await db.execute(
            'SELECT admin_status,admin_reason FROM course_materials WHERE id=? AND course_id=?',
            [materialId, courseId],
          );
          if (material?.admin_status === 'paused')
            throw fail('资料已暂停：' + material.admin_reason, 423);
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  }
  return { assertCourse, middleware };
}
export function registerAdminContent(
  route,
  app,
  db,
  audit,
  { uploadRoot, previewRoot, repairPreview },
) {
  const safeFile = (root, name) => {
    if (!name || path.basename(name) !== name) throw fail('原文件信息无效');
    return path.join(root, name);
  };
  async function get(source, id, connection = db) {
    if (!Object.hasOwn(tables, source) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)
      throw fail('对象编号无效', 400);
    const [[row]] = await connection.execute(`SELECT * FROM ${tables[source]} WHERE id=?`, [id]);
    if (!row) throw fail('对象不存在', 404);
    return row;
  }
  route('post', '/content/:source/:id/status', async (req, res) => {
    const parsed = z
      .object({
        status: z.enum(['active', 'paused']),
        version: z.number().int().nonnegative(),
        reason: z.string().trim().min(1).max(300),
      })
      .safeParse(req.body);
    if (!parsed.success) throw fail('请填写处理原因', 400);
    const { source, id } = req.params;
    await get(source, id);
    const con = await db.getConnection();
    const cancelled = [];
    let courseId;
    try {
      await con.beginTransaction();
      const row = await get(source, id, con);
      courseId = source === 'course' ? Number(id) : row.course_id;
      await con.execute('SELECT id FROM courses WHERE id=? FOR UPDATE', [courseId]);
      const [changed] = await con.execute(
        `UPDATE ${tables[source]} SET admin_status=?,admin_reason=?,admin_changed_at=NOW(),admin_version=admin_version+1 WHERE id=? AND admin_version=?`,
        [parsed.data.status, parsed.data.reason, id, parsed.data.version],
      );
      if (!changed.affectedRows) throw fail('状态已变化，请刷新后再操作');
      if (parsed.data.status === 'paused') {
        for (const [key, table] of [
          ['course', 'course_generation_jobs'],
          ['note', 'note_ai_jobs'],
          ['plan', 'learning_plan_jobs'],
        ]) {
          const [jobs] = await con.execute(
            `SELECT id FROM ${table} WHERE course_id=? AND status='running' FOR UPDATE`,
            [courseId],
          );
          await con.execute(
            `UPDATE ${table} SET status='cancelled'${key === 'course' ? ',active_key=NULL' : ''},error_text='课程或资料已由管理员暂停' WHERE course_id=? AND status='running'`,
            [courseId],
          );
          cancelled.push(...jobs.map((j) => [key, Number(j.id)]));
        }
      }
      await audit(
        con,
        req.user,
        source + '_' + (parsed.data.status === 'paused' ? 'pause' : 'restore'),
        id,
        'success',
        parsed.data.reason,
      );
      await con.commit();
    } catch (e) {
      await con.rollback();
      throw e;
    } finally {
      con.release();
    }
    for (const [key, id] of cancelled) app.locals.adminTasks?.[key]?.abort(id);
    res.json({ message: parsed.data.status === 'paused' ? '已暂停使用' : '已恢复使用' });
  });
  route('get', '/materials/:id/repair', async (req, res) => {
    await get('material', req.params.id);
    const [[job]] = await db.execute(
      'SELECT id,status,error_text,created_at,updated_at FROM material_preview_repairs WHERE material_id=? ORDER BY id DESC LIMIT 1',
      [req.params.id],
    );
    res.json({ job: job || null });
  });
  route('post', '/materials/:id/repair', async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().min(1).max(300) }).safeParse(req.body);
    if (!parsed.success) throw fail('请填写修复原因', 400);
    const material = await get('material', req.params.id);
    const original = safeFile(uploadRoot, material.stored_name);
    const stat = await fs.stat(original).catch(() => null);
    if (!stat?.isFile()) throw fail('原文件缺失，请学习者重新上传');
    const extension = path.extname(material.original_name).toLowerCase();
    if (
      !['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods'].includes(extension) ||
      !repairPreview
    )
      throw fail('此格式暂不支持预览修复');
    let id;
    const con = await db.getConnection();
    try {
      await con.beginTransaction();
      const [created] = await con.execute(
        "INSERT INTO material_preview_repairs(material_id,status,active_key) VALUES(?,'running',?)",
        [material.id, material.id],
      );
      id = created.insertId;
      await audit(con, req.user, 'preview_repair', material.id, 'success', parsed.data.reason);
      await con.commit();
    } catch (e) {
      await con.rollback();
      if (e.code === 'ER_DUP_ENTRY') throw fail('该资料正在修复，请等待完成');
      throw e;
    } finally {
      con.release();
    }
    res.status(202).json({ jobId: id, message: '预览正在后台修复' });
    const name = 'repair-' + crypto.randomUUID() + '.pdf';
    const output = path.join(previewRoot, name);
    (async () => {
      try {
        await repairPreview(original, output, extension);
        const outputStat = await fs.stat(output);
        if (!outputStat.size) throw fail('未生成有效预览');
        const handle = await fs.open(output, 'r');
        try {
          const buffer = Buffer.alloc(5);
          await handle.read(buffer, 0, 5, 0);
          if (buffer.toString() !== '%PDF-') throw fail('预览格式无效');
        } finally {
          await handle.close();
        }
        const pdf = await PDFDocument.load(await fs.readFile(output));
        if (!pdf.getPageCount()) throw fail('预览没有页面');
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          const [changed] = await connection.execute(
            'UPDATE course_materials SET preview_name=? WHERE id=? AND stored_name=? AND preview_name <=> ?',
            [name, material.id, material.stored_name, material.preview_name],
          );
          if (!changed.affectedRows) throw fail('资料已变化，请重新修复');
          await connection.execute(
            "UPDATE material_preview_repairs SET status='done',active_key=NULL WHERE id=? AND status='running'",
            [id],
          );
          await connection.commit();
        } catch (e) {
          await connection.rollback();
          throw e;
        } finally {
          connection.release();
        }
        // Cache removal is best effort; never delete the committed preview after cleanup errors.
        for (const file of await fs.readdir(previewRoot).catch(() => []))
          if (new RegExp(`^(reading|original)-${Number(material.id)}-\\d+\\.png$`).test(file))
            await fs.unlink(path.join(previewRoot, file)).catch(() => {});
      } catch (e) {
        await fs.unlink(output).catch(() => {});
        await db.execute(
          "UPDATE material_preview_repairs SET status='failed',active_key=NULL,error_text=? WHERE id=? AND status='running'",
          ['预览修复未完成，旧版本保留；请检查原件或转换服务', id],
        );
      }
    })().catch(() => {});
  });
}
