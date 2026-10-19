import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { applyChapterCorrections } from './chapter-corrections.js';
import { hasDamagedFormula } from './material-quality.js';
import path from 'node:path';
import fs from 'node:fs';
import { runPdfTool } from './pdf-tools.mjs';
import { OfficeParser } from 'officeparser';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerMaterialReadingRoutes(
  app,
  { auth, asyncRoute, parseId, getOwnedCourse, db, getOwnedMaterial, uploadRoot, previewRoot },
) {
  app.get(
    '/api/courses/:courseId/chapters/:chapterId/content',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const chapterId = parseId(res, req.params.chapterId);
      if (!courseId || !chapterId) return;
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [chapters] = await db.execute(
        'SELECT id,title,description,sort_order FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
        [course.id],
      );
      const chapterIndex = chapters.findIndex((item) => Number(item.id) === Number(chapterId));
      if (chapterIndex < 0) return res.status(404).json({ message: '章节不存在' });
      const [materials] = await db.execute(
        'SELECT id,original_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
        [course.id],
      );
      const chapter = chapters[chapterIndex];
      const laterChapters = chapters.slice(chapterIndex + 1);
      let contentType = 'section';
      let sections = materials
        .map((material) => ({
          materialId: material.id,
          materialName: material.original_name,
          content: sliceChapterText(material.extracted_text || '', chapter, laterChapters),
        }))
        .filter((section) => section.content);
      if (!sections.length) {
        sections = selectChapterQuestions(materials, chapter);
        contentType = 'question-bank';
      }
      sections = await applyChapterCorrections(db, course.id, chapter.id, sections);
      for (const section of sections) {
        if (!hasDamagedFormula(section.content)) continue;
        const { material } = await getOwnedMaterial(req.user.sub, courseId, section.materialId);
        section.originalRequired = true;
        if (!material || path.extname(material.stored_name).toLowerCase() !== '.pdf') continue;
        try {
          const ast = await OfficeParser.parseOffice(path.join(uploadRoot, material.stored_name), {
            ocr: false,
          });
          const normalize = (value) =>
            String(value || '').replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
          const target = normalize(section.content);
          const phrases = new Set();
          for (let i = 0; i + 14 <= target.length; i += 7) phrases.add(target.slice(i, i + 14));
          const nodeText = (node) => node.text || (node.children || []).map(nodeText).join(' ');
          section.originalPages = ast.content
            .filter((node) => node.type === 'page')
            .flatMap((node, index) => {
              const text = normalize(nodeText(node));
              let hits = 0;
              for (const phrase of phrases) if (text.includes(phrase)) hits++;
              return hits >= 2 ? [index + 1] : [];
            });
        } catch {
          section.originalPages = [];
        }
      }
      res.json({ chapter, sections, contentType, found: sections.length > 0 });
    }),
  );

  app.get(
    '/api/courses/:courseId/materials/:materialId/pages/:page',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      const materialId = parseId(res, req.params.materialId);
      const page = Number(req.params.page);
      if (!courseId || !materialId) return;
      if (!Number.isInteger(page) || page < 1 || page > 2000)
        return res.status(400).json({ message: '页码无效' });
      const { material } = await getOwnedMaterial(req.user.sub, courseId, materialId);
      if (!material || path.extname(material.stored_name).toLowerCase() !== '.pdf')
        return res.status(404).json({ message: 'PDF 资料不存在' });
      const prefix = path.join(previewRoot, `original-${material.id}-${page}`);
      const imagePath = `${prefix}.png`;
      if (!fs.existsSync(imagePath))
        await runPdfTool(
          'pdftoppm',
          [
            '-f',
            String(page),
            '-l',
            String(page),
            '-singlefile',
            '-png',
            '-r',
            '130',
            path.join(uploadRoot, material.stored_name),
            prefix,
          ],
          { timeout: 30_000 },
        );
      if (!fs.existsSync(imagePath))
        return res.status(404).json({ message: '原页无法生成，请打开原文件阅读' });
      res.sendFile(imagePath);
    }),
  );
}
