import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (chapter) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([chapter.course_title, chapter.title]))
    .digest('hex');
const id = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw fail('配图参数无效');
  return n;
};

export class ChapterImageEditor {
  constructor(manager) {
    this.manager = manager;
    this.db = manager.db;
  }
  async init() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS chapter_image_drafts (
   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,chapter_id BIGINT UNSIGNED NOT NULL,
   content_hash CHAR(64) NOT NULL,base_filename VARCHAR(90) NULL,instructions VARCHAR(500) NOT NULL DEFAULT '',
   status VARCHAR(16) NOT NULL DEFAULT 'queued',filename VARCHAR(90) NULL,error_text VARCHAR(200) NOT NULL DEFAULT '',
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,INDEX draft_jobs(status,id))`);
    await this.db.execute(
      "UPDATE chapter_image_drafts SET status='failed',error_text='服务重启，生成中断，可重新生成' WHERE status='running'",
    );
  }
  async chapter(chapterId, db = this.db, lock = false) {
    const [[chapter]] = await db.execute(
      `SELECT ch.id,ch.title,c.id course_id,c.user_id,c.title course_title FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=?${lock ? ' FOR UPDATE' : ''}`,
      [id(chapterId)],
    );
    if (!chapter) throw fail('章节已不存在', 404);
    return chapter;
  }
  async list(userId, query = {}) {
    const q = String(query.q || '').trim(),
      page = Number(query.page || 1);
    if (q.length > 80 || !Number.isSafeInteger(page) || page < 1 || page > 100000)
      throw fail('搜索或页码无效');
    const where = q ? ' AND (c.title LIKE ? OR ch.title LIKE ?)' : '',
      args = q ? [userId, '%' + q + '%', '%' + q + '%'] : [userId];
    const [[count]] = await this.db.execute(
      'SELECT COUNT(*) total FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE c.user_id=?' +
        where,
      args,
    );
    const [items] = await this.db.query(
      `SELECT ch.id,ch.title,c.id course_id,c.title course_title,i.filename IS NOT NULL has_image,i.status image_status,i.filename revision,d.id draft_id,d.status draft_status FROM course_chapters ch JOIN courses c ON c.id=ch.course_id LEFT JOIN chapter_images i ON i.chapter_id=ch.id LEFT JOIN chapter_image_drafts d ON d.id=(SELECT MAX(d2.id) FROM chapter_image_drafts d2 WHERE d2.chapter_id=ch.id) WHERE c.user_id=?${where} ORDER BY c.id DESC,ch.sort_order,ch.id LIMIT 6 OFFSET ?`,
      [...args, (page - 1) * 6],
    );
    return { items, total: Number(count.total), page };
  }
  async state(chapterId) {
    const chapter = await this.chapter(chapterId);
    const [[image]] = await this.db.execute(
      'SELECT status,filename FROM chapter_images WHERE chapter_id=?',
      [chapter.id],
    );
    const [[draft]] = await this.db.execute(
      'SELECT id,status,error_text FROM chapter_image_drafts WHERE chapter_id=? ORDER BY id DESC LIMIT 1',
      [chapter.id],
    );
    return {
      title: chapter.title,
      course_title: chapter.course_title,
      has_image: Boolean(image?.filename),
      image_status: image?.status || null,
      revision: image?.filename || '',
      draft_id: draft?.id || null,
      draft_status: draft?.status || null,
      draft_error: draft?.error_text || '',
    };
  }
  async generate(chapterId, input, actor, audit) {
    if (input?.acknowledgeCost !== true) throw fail('请确认重新生成按实际调用计费');
    if (typeof input.instructions !== 'string' || input.instructions.trim().length > 500)
      throw fail('配图要求请控制在500字以内');
    const m = this.manager;
    if (!m.config.enabled || !m.config.apiKey) throw fail('请先启用并配置章节自动配图');
    if (!m.runtime.snapshot().generationEnabled) throw fail('AI 生成已暂停');
    const con = await this.db.getConnection();
    let draftId;
    try {
      await con.beginTransaction();
      const chapter = await this.chapter(chapterId, con, true);
      await m.assertCourse(chapter.user_id, chapter.course_id, true);
      const [[pending]] = await con.execute(
        "SELECT id FROM chapter_image_drafts WHERE chapter_id=? AND status IN ('queued','running','ready') LIMIT 1",
        [chapter.id],
      );
      if (pending) throw fail('已有配图正在生成或等待采用，请先处理该结果', 409);
      const [[current]] = await con.execute(
        'SELECT filename,status FROM chapter_images WHERE chapter_id=?',
        [chapter.id],
      );
      if (current && ['queued', 'running'].includes(current.status))
        throw fail('首次配图正在生成，请完成后再更换', 409);
      const [created] = await con.execute(
        'INSERT INTO chapter_image_drafts(chapter_id,content_hash,base_filename,instructions) VALUES(?,?,?,?)',
        [chapter.id, hash(chapter), current?.filename || null, input.instructions.trim()],
      );
      draftId = created.insertId;
      await audit(con, actor, 'image_generate', chapter.id, 'success', '提交章节配图重新生成任务');
      await con.commit();
    } catch (error) {
      await con.rollback();
      throw error;
    } finally {
      con.release();
    }
    m.pump().catch(() => {});
    return { id: draftId, status: 'queued' };
  }
  async claim() {
    const [[draft]] = await this.db.query(
      "SELECT * FROM chapter_image_drafts WHERE status='queued' ORDER BY id LIMIT 1",
    );
    if (!draft) return null;
    const [result] = await this.db.execute(
      "UPDATE chapter_image_drafts SET status='running' WHERE id=? AND status='queued'",
      [draft.id],
    );
    return result.affectedRows ? draft : null;
  }
  async run(draft) {
    const m = this.manager;
    let saved;
    try {
      const chapter = await this.chapter(draft.chapter_id);
      await m.assertCourse(chapter.user_id, chapter.course_id, true);
      if (hash(chapter) !== draft.content_hash) throw fail('章节名称已变化，请按新主题重新生成');
      if (!m.config.enabled || !m.config.apiKey || !m.runtime.snapshot().generationEnabled)
        throw fail('配图服务已暂停，请恢复后重新生成');
      const signal = AbortSignal.timeout(120000);
      const prompt =
        m.prompt(chapter) +
        '\n学习者本次填写的绘画要求（仅用于调整插画）：' +
        JSON.stringify(draft.instructions || '保持原有淡彩水墨风格，尝试新的构图。');
      const image = await m.runtime.run(async () => {
        const current = await this.chapter(draft.chapter_id);
        await m.assertCourse(current.user_id, current.course_id, true);
        if (hash(current) !== draft.content_hash) throw fail('章节名称已变化，请按新主题重新生成');
        if (!m.config.enabled || !m.config.apiKey || !m.runtime.snapshot().generationEnabled)
          throw fail('配图服务已暂停，请恢复后重新生成');
        const selectedConfig = await m.generationConfig(current.user_id);
        if (!(await m.reserve())) throw fail('今日配图额度已用完，请明天重新生成');
        if (!m.config.enabled || !m.runtime.snapshot().generationEnabled)
          throw fail('配图服务已暂停，请恢复后重新生成');
        return m.generateImage(selectedConfig, prompt, { fetcher: m.fetcher, signal });
      }, signal);
      const latest = await this.chapter(draft.chapter_id);
      if (hash(latest) !== draft.content_hash) throw fail('章节名称已变化，请按新主题重新生成');
      saved = crypto.randomUUID() + '.' + image.extension;
      await fs.writeFile(path.join(m.root, saved), image.buffer);
      const [updated] = await this.db.execute(
        "UPDATE chapter_image_drafts SET status='ready',filename=?,error_text='' WHERE id=? AND status='running'",
        [saved, draft.id],
      );
      if (!updated.affectedRows) await fs.unlink(path.join(m.root, saved)).catch(() => {});
    } catch (error) {
      if (saved) await fs.unlink(path.join(m.root, saved)).catch(() => {});
      const message = error.status
        ? error.message
        : ['TimeoutError', 'AbortError'].includes(error.name)
          ? '配图生成超时，请重新生成'
          : '配图生成失败，请检查服务后重新生成';
      await this.db.execute(
        "UPDATE chapter_image_drafts SET status='failed',error_text=? WHERE id=? AND status='running'",
        [message.slice(0, 200), draft.id],
      );
    }
  }
  async adopt(draftId, actor, audit) {
    const con = await this.db.getConnection();
    let oldFile;
    try {
      await con.beginTransaction();
      // Chapter lock serializes draft creation and adoption for the same chapter.
      const [[found]] = await con.execute(
        'SELECT chapter_id FROM chapter_image_drafts WHERE id=?',
        [id(draftId)],
      );
      if (!found) throw fail('待采用配图不存在', 404);
      const chapter = await this.chapter(found.chapter_id, con, true);
      const [[draft]] = await con.execute(
        'SELECT * FROM chapter_image_drafts WHERE id=? FOR UPDATE',
        [id(draftId)],
      );
      if (draft.status !== 'ready' || !draft.filename)
        throw fail('这张配图目前不可采用，请刷新查看', 409);
      if (hash(chapter) !== draft.content_hash) throw fail('章节名称已变化，请重新生成配图', 409);
      const [[current]] = await con.execute(
        'SELECT filename,status FROM chapter_images WHERE chapter_id=? FOR UPDATE',
        [chapter.id],
      );
      if (current && ['queued', 'running'].includes(current.status))
        throw fail('章节配图仍在生成，请稍后采用', 409);
      if ((current?.filename || null) !== draft.base_filename)
        throw fail('当前配图已改变，请刷新后重新生成', 409);
      try {
        await fs.access(path.join(this.manager.root, draft.filename));
      } catch {
        throw fail('预览图片文件缺失，请重新生成', 409);
      }
      await con.execute(
        "INSERT INTO chapter_images(chapter_id,course_id,user_id,content_hash,status,filename) VALUES(?,?,?,?,'done',?) ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),status='done',filename=VALUES(filename),attempts=0,error_text='',retry_at=NULL",
        [chapter.id, chapter.course_id, chapter.user_id, draft.content_hash, draft.filename],
      );
      await con.execute("UPDATE chapter_image_drafts SET status='adopted' WHERE id=?", [draft.id]);
      await audit(con, actor, 'image_adopt', chapter.id, 'success', '采用新的章节配图');
      await con.commit();
      oldFile = current?.filename;
    } catch (error) {
      await con.rollback();
      throw error;
    } finally {
      con.release();
    }
    if (oldFile) await fs.unlink(path.join(this.manager.root, oldFile)).catch(() => {});
    return { message: '新配图已采用' };
  }
  async discard(draftId, actor, audit) {
    const con = await this.db.getConnection();
    let filename;
    try {
      await con.beginTransaction();
      const [[draft]] = await con.execute(
        'SELECT * FROM chapter_image_drafts WHERE id=? FOR UPDATE',
        [id(draftId)],
      );
      if (!draft) throw fail('待采用配图不存在', 404);
      if (!['ready', 'failed'].includes(draft.status))
        throw fail('任务状态已改变，请刷新查看', 409);
      await con.execute(
        "UPDATE chapter_image_drafts SET status='discarded',filename=NULL WHERE id=?",
        [draft.id],
      );
      await audit(
        con,
        actor,
        'image_discard',
        draft.chapter_id,
        'success',
        '放弃候选配图，保留原图',
      );
      await con.commit();
      filename = draft.filename;
    } catch (error) {
      await con.rollback();
      throw error;
    } finally {
      con.release();
    }
    if (filename) await fs.unlink(path.join(this.manager.root, filename)).catch(() => {});
    return { message: '已保留原图' };
  }
  async file(chapterId, draftId) {
    await this.chapter(chapterId);
    let row;
    if (draftId) {
      [[row]] = await this.db.execute(
        "SELECT filename FROM chapter_image_drafts WHERE id=? AND chapter_id=? AND status='ready'",
        [id(draftId), id(chapterId)],
      );
    } else {
      [[row]] = await this.db.execute(
        "SELECT filename FROM chapter_images WHERE chapter_id=? AND status='done'",
        [id(chapterId)],
      );
    }
    if (!row?.filename || !/^[a-f0-9-]+\.(png|jpg)$/.test(row.filename))
      throw fail('配图尚未生成或已失效', 404);
    return path.join(this.manager.root, row.filename);
  }
  register(app, auth, wrap) {
    app.get(
      '/api/chapter-illustrations',
      auth,
      wrap(async (req, res) => res.json(await this.list(req.user.sub, req.query))),
    );
    const base = '/api/courses/:courseId/chapters/:chapterId/illustration';
    const audit = (db, actor, action, target, result, detail) =>
      db.execute(
        'INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,?,?,?,?,?)',
        [
          actor.sub,
          actor.account || '学习用户',
          actor.role || 'student',
          action,
          String(target),
          result,
          detail,
        ],
      );
    const owned = async (req) => {
      await this.manager.scope(req.user.sub, req.params.courseId, req.params.chapterId);
      if (req.params.id) {
        const [[draft]] = await this.db.execute(
          'SELECT chapter_id FROM chapter_image_drafts WHERE id=?',
          [id(req.params.id)],
        );
        if (!draft || Number(draft.chapter_id) !== Number(req.params.chapterId))
          throw fail('配图不存在或无权访问', 404);
      }
    };
    const route = (method, suffix, handler) =>
      app[method](
        base + suffix,
        auth,
        wrap(async (req, res) => {
          await owned(req);
          return handler(req, res);
        }),
      );
    route('get', '/draft', async (req, res) => res.json(await this.state(req.params.chapterId)));
    route('get', '/preview', async (req, res) => {
      const file = await this.file(req.params.chapterId, req.query.draft);
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.sendFile(file);
    });
    route('post', '/regenerate', async (req, res) =>
      res.status(202).json(await this.generate(req.params.chapterId, req.body, req.user, audit)),
    );
    route('post', '/drafts/:id/adopt', async (req, res) =>
      res.json(await this.adopt(req.params.id, req.user, audit)),
    );
    route('post', '/drafts/:id/discard', async (req, res) =>
      res.json(await this.discard(req.params.id, req.user, audit)),
    );
  }
}
