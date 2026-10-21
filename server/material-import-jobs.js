import path from 'node:path';
import fs from 'node:fs/promises';
import { insertMaterials } from './material-import.js';

const decode = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// 文件接收完成后持久化队列，解析不再依附浏览器请求；重启后继续未完成任务。
export class MaterialImportJobs {
  constructor({
    db,
    uploadRoot,
    previewRoot,
    processMaterial,
    normalizeUploadedName,
    getOwnedCourse,
  }) {
    Object.assign(this, {
      db,
      uploadRoot,
      previewRoot,
      processMaterial,
      normalizeUploadedName,
      getOwnedCourse,
    });
    this.busy = false;
    this.controllers = new Map();
  }

  async init() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS material_import_jobs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL, course_id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'queued', progress_text VARCHAR(300) NOT NULL DEFAULT '',
      progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
      files_json JSON NOT NULL, result_json JSON NULL, error_text VARCHAR(500) NULL,
      request_key VARCHAR(100) NULL,
      dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_import_queue(status,id),
      UNIQUE KEY uniq_import_request(user_id,course_id,request_key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )`);
    const [columns] = await this.db.query(
      "SHOW COLUMNS FROM material_import_jobs LIKE 'progress_percent'",
    );
    if (!columns.length)
      await this.db.query(
        'ALTER TABLE material_import_jobs ADD COLUMN progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0',
      );
    await this.db.execute(
      "UPDATE material_import_jobs SET status='queued',progress_percent=0,progress_text='等待继续导入' WHERE status='running'",
    );
    this.timer = setInterval(() => this.kick(), 1500);
    this.timer.unref();
    this.kick();
  }

  kick() {
    this.run().catch((error) => console.error('资料导入队列暂不可用', error.message));
  }

  async enqueue(userId, courseId, files, requestKey) {
    if (requestKey && !/^[A-Za-z0-9.-]{1,100}$/.test(requestKey)) throw fail('导入请求编号无效');
    const storedFiles = files.map((file) => ({
      filename: file.filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    }));
    const [result] = await this.db.execute(
      'INSERT IGNORE INTO material_import_jobs(user_id,course_id,files_json,progress_text,request_key) VALUES(?,?,?,?,?)',
      [userId, courseId, JSON.stringify(storedFiles), '等待导入资料', requestKey || null],
    );
    if (!result.affectedRows) {
      const [[existing]] = await this.db.execute(
        'SELECT id,course_id,status,progress_text,progress_percent FROM material_import_jobs WHERE user_id=? AND course_id=? AND request_key=?',
        [userId, courseId, requestKey || null],
      );
      if (!existing) throw fail('课程或导入任务已失效', 409);
      for (const file of storedFiles)
        if (path.basename(file.filename) === file.filename)
          await fs.rm(path.join(this.uploadRoot, file.filename), { force: true });
      return existing;
    }
    this.kick();
    return {
      id: result.insertId,
      course_id: courseId,
      status: 'queued',
      progress_percent: 0,
      progress_text: '等待导入资料',
    };
  }

  async courseFiles(courseId, userId) {
    const [jobs] = await this.db.execute(
      'SELECT files_json FROM material_import_jobs WHERE course_id=? AND user_id=?',
      [courseId, userId],
    );
    return jobs
      .flatMap((job) => decode(job.files_json))
      .filter((file) => path.basename(file.filename) === file.filename)
      .map((file) => ({ stored_name: file.filename, preview_name: null }));
  }

  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (true) {
        const [[job]] = await this.db.execute(
          "SELECT * FROM material_import_jobs WHERE status='queued' ORDER BY id LIMIT 1",
        );
        if (!job) break;
        const [claimed] = await this.db.execute(
          "UPDATE material_import_jobs SET status='running',error_text=NULL WHERE id=? AND status='queued'",
          [job.id],
        );
        if (claimed.affectedRows) await this.processJob(job);
      }
    } finally {
      this.busy = false;
    }
  }

  async processJob(job) {
    const parsedFiles = [];
    const controller = new AbortController();
    this.controllers.set(job.id, { courseId: job.course_id, controller });
    let checking = false;
    const watch = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const [[current]] = await this.db.execute(
          'SELECT status FROM material_import_jobs WHERE id=?',
          [job.id],
        );
        if (!current || current.status !== 'running')
          controller.abort(new Error('课程或导入任务已删除，导入已停止'));
      } catch {
        /* 临时数据库错误不改变任务状态。 */
      } finally {
        checking = false;
      }
    }, 2000);
    watch.unref();
    let connection;
    let progressUpdates = Promise.resolve();
    const report = (percent, text) => {
      // 串行保存进度，完成事务前等待写入，防止迟到的进度覆盖完成状态。
      progressUpdates = progressUpdates
        .then(() =>
          this.db.execute(
            "UPDATE material_import_jobs SET progress_percent=?,progress_text=? WHERE id=? AND status='running'",
            [Math.min(99, Math.max(0, Math.floor(percent))), text, job.id],
          ),
        )
        .catch(() => {});
    };
    try {
      if (!(await this.getOwnedCourse(job.user_id, job.course_id)))
        throw fail('课程已删除或不可访问', 404);
      const files = decode(job.files_json);
      for (const [index, stored] of files.entries()) {
        controller.signal.throwIfAborted();
        if (path.basename(stored.filename) !== stored.filename) throw fail('资料文件名无效');
        const file = { ...stored, path: path.join(this.uploadRoot, stored.filename) };
        const label = `正在整理第 ${index + 1}/${files.length} 份资料`;
        report((index / files.length) * 99, label);
        let previousPercent = -1;
        const { extractedText, previewName } = await this.processMaterial(
          file.path,
          file.originalname,
          {
            signal: controller.signal,
            onProgress: ({ completed, total }) => {
              if (
                controller.signal.aborted ||
                !Number.isFinite(total) ||
                total <= 0 ||
                !Number.isFinite(completed) ||
                completed < 0 ||
                completed > total
              )
                return;
              const percent = Math.floor(((index + completed / total) / files.length) * 99);
              if (percent <= previousPercent) return;
              previousPercent = percent;
              report(percent, `${label} · 已读取 ${completed}/${total} 页`);
            },
          },
        );
        controller.signal.throwIfAborted();
        parsedFiles.push({
          file,
          extractedText,
          previewName,
          originalName: this.normalizeUploadedName(file.originalname),
        });
        report(((index + 1) / files.length) * 99, label);
      }
      report(99, '解析完成，正在保存资料');
      await progressUpdates;
      connection = await this.db.getConnection();
      await connection.beginTransaction();
      // 资料写入与任务完成一起提交，避免重启重试重复导入同一批文件。
      const [current] = await connection.execute(
        "SELECT id FROM material_import_jobs WHERE id=? AND status='running' FOR UPDATE",
        [job.id],
      );
      if (!current.length) throw fail('导入任务已失效', 409);
      const materials = await insertMaterials(connection, job.course_id, parsedFiles);
      await connection.execute(
        "UPDATE material_import_jobs SET status='done',progress_percent=100,progress_text='资料导入完成',result_json=?,error_text=NULL WHERE id=?",
        [JSON.stringify({ materials }), job.id],
      );
      await connection.commit();
    } catch (error) {
      await progressUpdates;
      if (connection) await connection.rollback();
      // 保留上传原文件供失败任务重试，只清理本轮创建的预览。
      for (const item of parsedFiles)
        if (item.previewName && path.basename(item.previewName) === item.previewName)
          await fs
            .rm(path.join(this.previewRoot, item.previewName), { force: true })
            .catch(() => {});
      await this.db.execute(
        "UPDATE material_import_jobs SET status='failed',error_text=?,progress_text='资料导入失败' WHERE id=?",
        [String(error.message || '资料导入失败').slice(0, 500), job.id],
      );
    } finally {
      clearInterval(watch);
      this.controllers.delete(job.id);
      connection?.release();
    }
  }

  cancelCourse(courseId) {
    for (const task of this.controllers.values())
      if (Number(task.courseId) === Number(courseId))
        task.controller.abort(new Error('课程已删除，导入已停止'));
  }
}

export function registerMaterialImportJobs(app, { db, auth, asyncRoute, importJobs }) {
  app.get(
    '/api/material-import-jobs',
    auth,
    asyncRoute(async (req, res) => {
      const [jobs] = await db.execute(
        `SELECT j.id,j.course_id,j.status,j.progress_text,
      CASE WHEN j.status='done' THEN 100 ELSE j.progress_percent END AS progress_percent,
      j.error_text,j.created_at,c.title AS course_title
      FROM material_import_jobs j JOIN courses c ON c.id=j.course_id
      WHERE j.user_id=? AND j.dismissed=FALSE ORDER BY j.id DESC`,
        [req.user.sub],
      );
      res.json({ jobs });
    }),
  );
  app.post(
    '/api/material-import-jobs/:id/retry',
    auth,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw fail('任务编号无效');
      const [result] = await db.execute(
        "UPDATE material_import_jobs SET status='queued',progress_percent=0,error_text=NULL,progress_text='等待重新导入' WHERE id=? AND user_id=? AND status='failed'",
        [id, req.user.sub],
      );
      if (!result.affectedRows) throw fail('任务不存在或当前无法重试', 409);
      importJobs.kick();
      res.json({ queued: true });
    }),
  );
  app.post(
    '/api/material-import-jobs/:id/dismiss',
    auth,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw fail('任务编号无效');
      await db.execute(
        "UPDATE material_import_jobs SET dismissed=TRUE WHERE id=? AND user_id=? AND status='done'",
        [id, req.user.sub],
      );
      res.json({ dismissed: true });
    }),
  );
}
