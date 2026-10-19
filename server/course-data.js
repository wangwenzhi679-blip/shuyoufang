import { idSchema } from './request-schemas.mjs';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function createCourseData({ contentControl, db }) {
  const parseId = (res, value) => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) {
      res.status(400).json({ message: '参数错误' });
      return null;
    }
    return parsed.data;
  };

  async function getOwnedCourse(userId, courseId) {
    await contentControl.assertCourse(userId, courseId);
    const [rows] = await db.execute(
      'SELECT id,user_id,title,description,created_at,updated_at FROM courses WHERE id=? AND user_id=? LIMIT 1',
      [courseId, userId],
    );
    return rows[0] || null;
  }

  async function getCourseMaterials(courseId) {
    const [rows] = await db.execute(
      'SELECT id,course_id,admin_status,admin_reason,admin_changed_at,original_name,mime_type,size_bytes,preview_name,CHAR_LENGTH(extracted_text) AS text_length,created_at FROM course_materials WHERE course_id=? ORDER BY created_at,id',
      [courseId],
    );
    return rows.map((material) => ({
      ...material,
      size_bytes: Number(material.size_bytes),
      text_length: Number(material.text_length),
    }));
  }

  async function getOwnedMaterial(userId, courseId, materialId) {
    const course = await getOwnedCourse(userId, courseId);
    const [[state]] = await db.execute(
      'SELECT admin_status,admin_reason FROM course_materials WHERE id=? AND course_id=?',
      [materialId, courseId],
    );
    if (state?.admin_status === 'paused')
      throw Object.assign(new Error('资料已暂停：' + state.admin_reason), { status: 423 });

    if (!course) return { course: null, material: null };
    const [rows] = await db.execute(
      'SELECT id,course_id,original_name,stored_name,mime_type,size_bytes,preview_name,extracted_text,created_at FROM course_materials WHERE id=? AND course_id=? LIMIT 1',
      [materialId, courseId],
    );
    return { course, material: rows[0] || null };
  }
  return { parseId, getOwnedCourse, getCourseMaterials, getOwnedMaterial };
}
