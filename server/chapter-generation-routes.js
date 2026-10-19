import { chapterSchema, chapterSummaryResultSchema } from './request-schemas.mjs';
import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { applyChapterCorrections } from './chapter-corrections.js';
import { prepareLongContext } from './long-context.js';
import { z } from 'zod';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerChapterGenerationRoutes(
  app,
  {
    generationSignal,
    parseId,
    getOwnedCourse,
    db,
    askDeepSeek,
    serviceSettings,
    auth,
    asyncRoute,
    buildVisionPages,
    validationError,
  },
) {
  const summaryGenerate = async (req, res) => {
    const signal = generationSignal(req, res);
    const courseId = parseId(res, req.params.courseId);
    const chapterId = parseId(res, req.params.chapterId);
    if (!courseId || !chapterId) return;
    const input = z
      .object({ requirements: z.string().trim().max(500).optional().default('') })
      .safeParse(req.body || {});
    if (!input.success) return res.status(400).json({ message: '整理要求不能超过 500 字' });
    const course = await getOwnedCourse(req.user.sub, courseId);
    if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
    const [chapters] = await db.execute(
      'SELECT id,title,description,sort_order FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
      [course.id],
    );
    const chapterIndex = chapters.findIndex((item) => Number(item.id) === Number(chapterId));
    if (chapterIndex < 0) return res.status(404).json({ message: '章节不存在' });
    const chapter = chapters[chapterIndex];
    const [materials] = await db.execute(
      'SELECT id,original_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
      [course.id],
    );
    if (!materials.length)
      return res.status(400).json({ message: '请先导入学习资料，再生成章节总结' });
    let sections = materials
      .map((material) => ({
        materialId: material.id,
        name: material.original_name,
        content: sliceChapterText(
          material.extracted_text || '',
          chapter,
          chapters.slice(chapterIndex + 1),
        ),
      }))
      .filter((section) => section.content);
    let sourceType = 'chapter-text';
    if (!sections.length) {
      sections = selectChapterQuestions(materials, chapter).map((item) => ({
        materialId: item.materialId,
        name: item.materialName,
        content: item.content,
      }));
      sourceType = 'question-bank';
    }
    sections = await applyChapterCorrections(db, course.id, chapter.id, sections);
    if (!sections.length)
      return res
        .status(400)
        .json({ message: '暂未找到与本章相关的资料内容，请调整章节名称或补充资料' });
    const sources = [...new Set(sections.map((section) => section.name))];
    const context = await prepareLongContext(
      sections.map((section) => `【${section.name}】\n${section.content}`).join('\n\n'),
      (messages, partSignal) => askDeepSeek(messages, undefined, partSignal),
      signal,
      {
        db,
        courseId,
        chapterId: chapter.id,
        model: serviceSettings.snapshot('ai').baseUrl + '|' + serviceSettings.snapshot('ai').model,
        onProgress: req.updateProgress,
      },
    );
    const raw = await askDeepSeek(
      [
        {
          role: 'system',
          content:
            '你是严谨的个人课程学习助手。仅依据给出的当前章节资料整理，不补充资料外知识。参考用户的整理要求，但要求与资料冲突时以资料为准。若资料是相关题目而非教材正文，应概括这些题目涉及的考查内容，不要声称题目提供了完整的理论讲解。只输出 JSON，不要 Markdown。格式：{"summary":"一段简明的本章摘要","knowledgePoints":[{"title":"知识点名称","explanation":"简短解释"}]}。摘要不超过500字，知识点建议3至6个，每个知识点必须具体且易于复习。',
        },
        {
          role: 'user',
          content: `课程：${course.title}\n当前章节：${chapter.title}\n资料类型：${sourceType === 'question-bank' ? '与本章匹配的题库原题' : '本章原文'}\n用户整理要求：${input.data.requirements || '无特殊要求'}\n\n资料内容：\n${context}`,
        },
      ],
      undefined,
      signal,
    );
    signal.throwIfAborted();
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    let generated;
    try {
      generated = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ message: 'AI 返回的章节总结格式无效，请重新生成' });
    }
    const parsed = chapterSummaryResultSchema.safeParse(generated);
    if (!parsed.success)
      return res.status(502).json({ message: 'AI 返回的章节总结不符合要求，请重新生成' });
    await req.beginSave?.();
    await db.execute(
      `INSERT INTO chapter_summaries(course_id,chapter_id,summary_text,knowledge_points_json,source_names_json) VALUES(?,?,?,?,?)
    ON DUPLICATE KEY UPDATE summary_text=VALUES(summary_text),knowledge_points_json=VALUES(knowledge_points_json),source_names_json=VALUES(source_names_json),updated_at=CURRENT_TIMESTAMP`,
      [
        course.id,
        chapter.id,
        parsed.data.summary,
        JSON.stringify(parsed.data.knowledgePoints),
        JSON.stringify(sources),
      ],
    );
    const [rows] = await db.execute(
      'SELECT id,updated_at FROM chapter_summaries WHERE chapter_id=?',
      [chapter.id],
    );
    res.json({
      summary: {
        id: Number(rows[0].id),
        chapterId: Number(chapter.id),
        summary: parsed.data.summary,
        knowledgePoints: parsed.data.knowledgePoints,
        sources,
        updatedAt: rows[0].updated_at,
      },
    });
  };

  app.post('/api/courses/:courseId/chapters/:chapterId/summary', auth, asyncRoute(summaryGenerate));

  const chaptersSuggest = async (req, res) => {
    const signal = generationSignal(req, res);
    const courseId = parseId(res, req.params.courseId);
    if (!courseId) return;
    const input = z
      .object({ requirements: z.string().trim().max(500).optional().default('') })
      .safeParse(req.body || {});
    if (!input.success) return res.status(400).json({ message: '整理要求不能超过 500 字' });
    const course = await getOwnedCourse(req.user.sub, courseId);
    if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
    const [materials] = await db.execute(
      'SELECT original_name,stored_name,preview_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
      [course.id],
    );
    if (!materials.length)
      return res.status(400).json({ message: '请先导入学习资料，再生成章节目录' });
    const context = await prepareLongContext(
      materials
        .map(
          (item) =>
            `【${item.original_name}】\n${item.extracted_text || '（未识别到可复制文字，请结合资料页面图片整理）'}`,
        )
        .join('\n\n'),
      (messages, partSignal) => askDeepSeek(messages, undefined, partSignal),
      signal,
      {
        db,
        courseId: course.id,
        purpose: 'outline',
        model: serviceSettings.snapshot('ai').baseUrl + '|' + serviceSettings.snapshot('ai').model,
        validateFormulas: false,
        onProgress: req.updateProgress,
      },
    );
    const vision = await buildVisionPages(materials);
    const raw = await askDeepSeek(
      [
        {
          role: 'system',
          content:
            '你是课程结构设计助手。仅依据资料文字和页面图像生成单层章节目录，不补充资料外的知识。参考用户的整理要求，但要求与资料冲突时以资料为准。图片可能含公式、图表和扫描文字。只输出 JSON，不要 Markdown。格式：{"chapters":[{"title":"不超过120字","description":"不超过500字"}]}',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `课程名称：${course.title}\n用户整理要求：${input.data.requirements || '无特殊要求'}\n\n资料文字：\n${context}`,
            },
            ...vision.parts,
          ],
        },
      ],
      undefined,
      signal,
    );
    signal.throwIfAborted();
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    let suggested;
    try {
      suggested = JSON.parse(jsonText);
    } catch {
      return res.status(502).json({ message: 'AI 返回的章节目录格式无效，请重试' });
    }
    const parsed = z
      .object({ chapters: z.array(chapterSchema).min(1, 'AI 未生成章节').max(20, '章节数量过多') })
      .safeParse(suggested);
    if (!parsed.success)
      return res.status(502).json({ message: 'AI 返回的章节目录不符合要求，请重试' });
    await req.beginSave?.();
    await db.execute('DELETE FROM course_chapter_drafts WHERE course_id=?', [course.id]);
    for (const [index, chapter] of parsed.data.chapters.entries())
      await db.execute(
        'INSERT INTO course_chapter_drafts(course_id,title,description,sort_order) VALUES(?,?,?,?)',
        [course.id, chapter.title, chapter.description, index + 1],
      );
    const [chapterDrafts] = await db.execute(
      'SELECT id,title,description,sort_order,created_at FROM course_chapter_drafts WHERE course_id=? ORDER BY sort_order,id',
      [course.id],
    );
    res.status(201).json({ chapterDrafts });
  };

  app.post('/api/courses/:courseId/chapters/suggest', auth, asyncRoute(chaptersSuggest));

  app.post(
    '/api/courses/:courseId/chapters/confirm-draft',
    auth,
    asyncRoute(async (req, res) => {
      const courseId = parseId(res, req.params.courseId);
      if (!courseId) return;
      const parsed = z
        .object({
          chapters: z.array(chapterSchema).min(1, '请保留至少一个章节').max(20, '章节数量过多'),
          replaceExisting: z.boolean().optional().default(false),
        })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [existing] = await db.execute(
        'SELECT id FROM course_chapters WHERE course_id=? LIMIT 1',
        [course.id],
      );
      if (existing.length && !parsed.data.replaceExisting)
        return res.status(409).json({ message: '当前已有章节，请确认替换后再采用新目录' });
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        if (existing.length)
          await connection.execute('DELETE FROM course_chapters WHERE course_id=?', [course.id]);
        for (const [index, chapter] of parsed.data.chapters.entries())
          await connection.execute(
            'INSERT INTO course_chapters(course_id,title,description,sort_order) VALUES(?,?,?,?)',
            [course.id, chapter.title, chapter.description, index + 1],
          );
        await connection.execute('DELETE FROM course_chapter_drafts WHERE course_id=?', [
          course.id,
        ]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      const [chapters] = await db.execute(
        'SELECT id,course_id,title,description,sort_order,created_at,updated_at,completed_at FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
        [course.id],
      );
      res.json({ chapters });
    }),
  );
  return { summaryGenerate, chaptersSuggest };
}
