import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { applyChapterCorrections } from './chapter-corrections.js';
import { registerReading } from './reading.js';
import path from 'node:path';
import fs from 'node:fs';
import { runPdfTool } from './pdf-tools.mjs';
import { createPdfPageImages } from './pdf-page-images.js';
import { registerLearningNotes } from './learning-notes.js';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerReadingAdapters(
  app,
  {
    getOwnedMaterial,
    previewRoot,
    uploadRoot,
    db,
    auth,
    asyncRoute,
    askDeepSeek,
    getAiModel,
    readChapterSummarySource,
  },
) {
  const readOriginalPage = createPdfPageImages({ uploadRoot, previewRoot });
  const readPreviewPage = createPdfPageImages({ uploadRoot: previewRoot, previewRoot });
  async function readingPdfPath(req) {
    const { material } = await getOwnedMaterial(
      req.user.sub,
      Number(req.params.courseId),
      Number(req.params.materialId),
    );
    if (!material) throw Object.assign(new Error('资料不存在'), { status: 404 });
    const file = material.preview_name
      ? path.join(previewRoot, material.preview_name)
      : path.join(uploadRoot, material.stored_name);
    if (path.extname(file).toLowerCase() !== '.pdf' || !fs.existsSync(file))
      throw Object.assign(new Error('请先从资料库生成原样预览'), { status: 400 });
    return { file, material };
  }

  registerReading(
    app,
    db,
    auth,
    asyncRoute,
    async (req) => {
      const { file } = await readingPdfPath(req);
      const { stdout } = await runPdfTool('pdfinfo', [file], { timeout: 10000 });
      const count = Number(stdout.match(/Pages:\s+(\d+)/)?.[1]);
      if (!count) throw new Error('无法读取PDF页数');
      return { pages: count };
    },
    async (req) => {
      const page = Number(req.params.page);
      if (!Number.isInteger(page) || page < 1 || page > 2000)
        throw Object.assign(new Error('页码无效'), { status: 400 });
      const { material } = await readingPdfPath(req);
      return material.preview_name
        ? readPreviewPage({ ...material, stored_name: material.preview_name }, page)
        : readOriginalPage(material, page);
    },
  );

  const askNotes = (messages, signal, options) =>
    askDeepSeek(
      messages,
      undefined,
      signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
      options,
    );
  askNotes.modelKey = getAiModel;
  registerLearningNotes(
    app,
    db,
    auth,
    asyncRoute,
    askNotes,
    async (courseId, chapterId, options = {}) => {
      const [chapters] = await db.execute(
        'SELECT id,title,description,sort_order,source_regions_json FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
        [courseId],
      );
      const index = chapters.findIndex((ch) => Number(ch.id) === Number(chapterId));
      if (index < 0) return '';
      const [materials] = await db.execute(
        'SELECT id,original_name,stored_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
        [courseId],
      );
      const corrections =
        chapters[index].source_regions_json != null
          ? await applyChapterCorrections(db, courseId, chapterId, [])
          : [];
      const pageSections = readChapterSummarySource
        ? await readChapterSummarySource(
            chapters[index],
            materials,
            options.signal,
            corrections,
            options.onProgress,
          )
        : null;
      let sections =
        pageSections ??
        materials
          .map((m) => ({
            materialId: m.id,
            name: m.original_name,
            content: sliceChapterText(
              m.extracted_text || '',
              chapters[index],
              chapters.slice(index + 1),
            ),
          }))
          .filter((s) => s.content);
      if (!sections.length && pageSections === null)
        sections = selectChapterQuestions(materials, chapters[index]).map((s) => ({
          materialId: s.materialId,
          name: s.materialName,
          content: s.content,
        }));
      sections = await applyChapterCorrections(db, courseId, chapterId, sections);
      return sections.map((s) => `【${s.name}】\n${s.content}`).join('\n\n');
    },
  );
}
