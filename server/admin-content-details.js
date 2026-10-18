import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const identifier = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pagination = z.object({
  chapterPage: z.coerce.number().int().min(1).max(100000).default(1),
  materialPage: z.coerce.number().int().min(1).max(100000).default(1),
});
const pageSize = 20;
export function registerAdminContentDetails(route, db, { uploadRoot, previewRoot }) {
  function idOf(req) {
    const parsed = identifier.safeParse(req.params.id);
    if (!parsed.success) throw fail('对象编号无效');
    return parsed.data;
  }
  async function exists(root, name) {
    if (!name || path.basename(name) !== name || /[\\/]/.test(name)) return false;
    try {
      return (await fs.stat(path.join(root, name))).isFile();
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
      throw error;
    }
  }
  async function materialState(row) {
    const { stored_name, preview_name, ...safe } = row;
    const [original, preview] = await Promise.all([
      exists(uploadRoot, stored_name),
      exists(previewRoot, preview_name),
    ]);
    return {
      ...safe,
      original_exists: original,
      preview_status: preview_name ? (preview ? 'ready' : 'missing') : 'not_generated',
    };
  }
  route('get', '/content/course/:id', async (req, res) => {
    const id = idOf(req),
      parsed = pagination.safeParse(req.query);
    if (!parsed.success) throw fail('分页条件不正确');
    const { chapterPage, materialPage } = parsed.data;
    const [[row]] = await db.execute(
      `SELECT c.id,c.title,LEFT(c.description,500) AS description,c.admin_status,c.admin_reason,c.admin_changed_at,c.created_at,u.id AS owner_id,u.account,u.nickname,u.status AS owner_status,
      (SELECT COUNT(*) FROM course_chapters ch WHERE ch.course_id=c.id) AS chapter_count,
      (SELECT COUNT(*) FROM course_materials m WHERE m.course_id=c.id) AS material_count
      FROM courses c JOIN users u ON u.id=c.user_id WHERE c.id=?`,
      [id],
    );
    if (!row) throw fail('课程不存在', 404);
    const { owner_id, account, nickname, owner_status, chapter_count, material_count, ...course } =
      row;
    const [chapters] = await db.execute(
      `SELECT id,title,LEFT(description,500) AS description,completed_at FROM course_chapters WHERE course_id=? ORDER BY sort_order,id LIMIT ${pageSize} OFFSET ${(chapterPage - 1) * pageSize}`,
      [id],
    );
    const [materials] = await db.execute(
      `SELECT id,original_name,size_bytes,admin_status,stored_name,preview_name,CHAR_LENGTH(COALESCE(extracted_text,'')) AS text_length,created_at FROM course_materials WHERE course_id=? ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${(materialPage - 1) * pageSize}`,
      [id],
    );
    res.json({
      course,
      owner: { id: owner_id, account, nickname, status: owner_status },
      chapters: { items: chapters, total: Number(chapter_count), page: chapterPage, pageSize },
      materials: {
        items: await Promise.all(materials.map(materialState)),
        total: Number(material_count),
        page: materialPage,
        pageSize,
      },
    });
  });
  route('get', '/content/material/:id', async (req, res) => {
    const id = idOf(req);
    const [[row]] = await db.execute(
      `SELECT m.id,m.course_id,m.original_name,m.mime_type,m.size_bytes,m.admin_status,m.admin_reason,m.admin_changed_at,m.created_at,m.stored_name,m.preview_name,
      CHAR_LENGTH(COALESCE(m.extracted_text,'')) AS text_length,LEFT(COALESCE(m.extracted_text,''),2000) AS text_excerpt,
      c.title AS course_title,c.admin_status AS course_status,u.id AS owner_id,u.account,u.nickname,u.status AS owner_status
      FROM course_materials m JOIN courses c ON c.id=m.course_id JOIN users u ON u.id=c.user_id WHERE m.id=?`,
      [id],
    );
    if (!row) throw fail('资料不存在', 404);
    const { owner_id, account, nickname, owner_status, course_title, course_status, ...material } =
      row;
    const [[repair]] = await db.execute(
      'SELECT id,status,error_text,created_at,updated_at FROM material_preview_repairs WHERE material_id=? ORDER BY id DESC LIMIT 1',
      [id],
    );
    res.json({
      material: await materialState(material),
      owner: { id: owner_id, account, nickname, status: owner_status },
      course: { id: material.course_id, title: course_title, admin_status: course_status },
      repair: repair
        ? {
            ...repair,
            error_text: repair.status === 'failed' ? '预览修复未完成，请检查原件或转换服务。' : '',
          }
        : null,
    });
  });
}
