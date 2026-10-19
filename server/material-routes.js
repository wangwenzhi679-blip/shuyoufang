import { saveMaterials } from './material-import.js';
import { renderOfficePdf } from './pdf-browser.js';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { OfficeParser } from 'officeparser';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerMaterialRoutes(
  app,
  {
    auth,
    asyncRoute,
    parseId,
    getOwnedCourse,
    upload,
    processMaterial,
    normalizeUploadedName,
    db,
    previewRoot,
    getOwnedMaterial,
    validationError,
    removeMaterialFiles,
    uploadRoot,
    importJobs,
  },
) {
  app.post(
    '/api/courses/:courseId/materials',
    auth,
    asyncRoute(async (req, res, next) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      req.uploadCourse = course;
      next();
    }),
    upload.array('files', 5),
    asyncRoute(async (req, res) => {
      const course = req.uploadCourse;
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ message: '请选择 PDF、Word 或 PPT 文件' });
      const parsedFiles = [];
      try {
        if (req.query?.background === '1') {
          const job = await importJobs.enqueue(req.user.sub, course.id, files, req.body?.importKey);
          return res.status(202).json({ job });
        }
        for (const file of files) {
          const { extractedText, previewName } = await processMaterial(
            file.path,
            file.originalname,
          );
          parsedFiles.push({
            file,
            extractedText,
            previewName,
            originalName: normalizeUploadedName(file.originalname),
          });
        }
        const materials = await saveMaterials(db, course.id, parsedFiles);
        res.status(201).json({ materials });
      } catch (error) {
        for (const file of files) fs.rmSync(file.path, { force: true });
        for (const item of parsedFiles)
          if (item.previewName)
            fs.rmSync(path.join(previewRoot, item.previewName), { force: true });
        throw error;
      }
    }),
  );

  app.get(
    '/api/courses/:courseId/materials/:materialId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const materialId = parseId(res, req.params.materialId);
      if (!courseId || !materialId) return;
      const { material } = await getOwnedMaterial(req.user.sub, courseId, materialId);
      if (!material) return res.status(404).json({ message: '资料不存在或无权访问' });
      res.json({
        material: {
          id: material.id,
          original_name: material.original_name,
          mime_type: material.mime_type,
          size_bytes: Number(material.size_bytes),
          extracted_text: material.extracted_text,
          created_at: material.created_at,
        },
      });
    }),
  );

  app.put(
    '/api/courses/:courseId/materials/:materialId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const materialId = parseId(res, req.params.materialId);
      if (!courseId || !materialId) return;
      const parsed = z
        .object({
          originalName: z
            .string()
            .trim()
            .min(1, '请输入资料名称')
            .max(255, '资料名称不能超过 255 个字'),
        })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const { material } = await getOwnedMaterial(req.user.sub, courseId, materialId);
      if (!material) return res.status(404).json({ message: '资料不存在或无权访问' });
      await db.execute('UPDATE course_materials SET original_name=? WHERE id=?', [
        parsed.data.originalName,
        material.id,
      ]);
      res.json({ material: { id: material.id, original_name: parsed.data.originalName } });
    }),
  );

  app.delete(
    '/api/courses/:courseId/materials/:materialId',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const materialId = parseId(res, req.params.materialId);
      if (!courseId || !materialId) return;
      const { course, material } = await getOwnedMaterial(req.user.sub, courseId, materialId);
      if (!course || !material) return res.status(404).json({ message: '资料不存在或无权访问' });
      const [deleted] = await db.execute('DELETE FROM course_materials WHERE id=?', [material.id]);
      if (!deleted.affectedRows) return res.status(404).json({ message: '资料已删除' });
      // 删除资料后立即中止使用旧资料的生成，避免旧结果重新写回目录。
      app.locals?.adminTasks?.course?.abortCourse?.(course.id);
      await db.execute('DELETE FROM course_chapter_drafts WHERE course_id=?', [course.id]);
      const cleanupFailed = removeMaterialFiles([material]);
      res.json({ deleted: true, cleanupFailed });
    }),
  );

  app.get(
    '/api/courses/:courseId/materials/:materialId/file',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const materialId = parseId(res, req.params.materialId);
      if (!courseId || !materialId) return;
      const { material } = await getOwnedMaterial(req.user.sub, courseId, materialId);
      if (!material) return res.status(404).json({ message: '资料不存在或无权访问' });
      const filePath = path.join(uploadRoot, material.stored_name);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: '原始文件不存在' });
      res.type(material.mime_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(material.original_name)}`,
      );
      res.sendFile(filePath);
    }),
  );

  app.get(
    '/api/courses/:courseId/materials/:materialId/preview',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const materialId = parseId(res, req.params.materialId);
      if (!courseId || !materialId) return;
      const { material } = await getOwnedMaterial(req.user.sub, courseId, materialId);
      if (!material) return res.status(404).json({ message: '资料不存在或无权访问' });
      let previewName = material.preview_name;
      const extension = path.extname(material.original_name).toLowerCase();
      if (!previewName && extension !== '.pdf') {
        const sourcePath = path.join(uploadRoot, material.stored_name);
        const ast = await OfficeParser.parseOffice(sourcePath, {
          extractAttachments: true,
          ocr: true,
          ocrConfig: { language: 'chi_sim+eng', preserveLayout: false },
        });
        const pdfResult = await renderOfficePdf(ast);
        previewName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
        fs.writeFileSync(path.join(previewRoot, previewName), Buffer.from(pdfResult.value));
        await db.execute('UPDATE course_materials SET preview_name=? WHERE id=?', [
          previewName,
          material.id,
        ]);
      }
      const previewPath = previewName
        ? path.join(previewRoot, previewName)
        : path.join(uploadRoot, material.stored_name);
      if (!fs.existsSync(previewPath))
        return res.status(404).json({ message: '该资料的原样预览尚未生成，请重新导入资料' });
      res.type('application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(`${path.parse(material.original_name).name}.pdf`)}`,
      );
      res.sendFile(previewPath);
    }),
  );
}
