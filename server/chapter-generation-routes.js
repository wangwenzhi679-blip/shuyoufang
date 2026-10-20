import {
  chapterSchema,
  chapterSummaryResultSchema,
  MAX_CHAPTER_DRAFTS,
} from './request-schemas.mjs';
import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { applyChapterCorrections } from './chapter-corrections.js';
import { prepareLongContext } from './long-context.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { pdfChapterSchema, validatePdfChapterSources } from './pdf-chapter-sources.js';

// 只纳入会影响生成结果的资料字段；预览文件可在阅读时创建，不应使任务失效。
const materialVersion = (materials) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        materials.map((item) => [
          Number(item.id),
          item.original_name,
          item.stored_name,
          item.extracted_text || '',
        ]),
      ),
    )
    .digest('hex');

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
    getAiModel,
    auth,
    asyncRoute,
    buildVisionPages,
    preparePdfOutline,
    readChapterSummarySource,
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
      'SELECT id,title,description,sort_order,source_regions_json FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
      [course.id],
    );
    const chapterIndex = chapters.findIndex((item) => Number(item.id) === Number(chapterId));
    if (chapterIndex < 0) return res.status(404).json({ message: '章节不存在' });
    const chapter = chapters[chapterIndex];
    const [materials] = await db.execute(
      'SELECT id,original_name,stored_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
      [course.id],
    );
    if (!materials.length)
      return res.status(400).json({ message: '请先导入学习资料，再生成章节总结' });
    await req.updateProgress?.('正在读取本章资料');
    const corrections =
      chapter.source_regions_json != null
        ? await applyChapterCorrections(db, course.id, chapter.id, [])
        : [];
    const pageSections = readChapterSummarySource
      ? await readChapterSummarySource(chapter, materials, signal, corrections)
      : null;
    let sections =
      pageSections ??
      materials
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
    if (!sections.length && pageSections === null) {
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
      (messages, partSignal, options) => askDeepSeek(messages, undefined, partSignal, options),
      signal,
      {
        db,
        courseId,
        chapterId: chapter.id,
        model: getAiModel
          ? await getAiModel()
          : serviceSettings.snapshot('ai').baseUrl + '|' + serviceSettings.snapshot('ai').model,
        onProgress: req.updateProgress,
      },
    );
    const messages = [
      {
        role: 'system',
        content:
          '你是严谨的个人课程学习助手。仅依据给出的当前章节资料整理，不补充资料外知识。参考用户的整理要求，但要求与资料冲突时以资料为准。若资料是相关题目而非教材正文，应概括这些题目涉及的考查内容，不要声称题目提供了完整的理论讲解。只输出 JSON，不要 Markdown。格式：{"summary":"一段简明的本章摘要","knowledgePoints":[{"title":"知识点名称","explanation":"简短解释"}]}。摘要不超过500字，知识点建议3至6个，每个知识点必须具体且易于复习。',
      },
      {
        role: 'user',
        content: `课程：${course.title}\n当前章节：${chapter.title}\n资料类型：${sourceType === 'question-bank' ? '与本章匹配的题库原题' : '本章原文'}\n用户整理要求：${input.data.requirements || '无特殊要求'}\n\n资料内容：\n${context}`,
      },
    ];
    let parsed;
    for (let attempt = 0; attempt < 2; attempt++) {
      await req.updateProgress?.(attempt ? '正在修复总结格式' : '正在生成章节总结');
      try {
        const raw = await askDeepSeek(
          attempt
            ? [
                ...messages,
                {
                  role: 'user',
                  content:
                    '上次输出不完整或格式不符。请重新输出完整 JSON：summary 为不超过500字的字符串，knowledgePoints 为3至6个对象，每项含字符串 title 和 explanation（解释不超过300字）。不要输出分析过程。',
                },
              ]
            : messages,
          undefined,
          signal,
          { maxOutputTokens: attempt ? 4096 : 3072, thinking: false, jsonObject: true },
        );
        signal.throwIfAborted();
        let generated;
        try {
          generated = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '');
        } catch {
          generated = null;
        }
        parsed = chapterSummaryResultSchema.safeParse(generated);
        if (parsed.success) break;
      } catch (error) {
        signal.throwIfAborted();
        // Do not repeat paid calls on authentication, network or configuration failures.
        if (!['AI_OUTPUT_LIMIT', 'AI_EMPTY_RESPONSE'].includes(error.code)) throw error;
      }
    }
    if (!parsed?.success)
      return res
        .status(502)
        .json({ message: 'AI 返回的章节总结仍不完整或格式不符，请检查模型设置后重试' });
    signal.throwIfAborted();
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
    // 逐页图片识别可能包含多个批次；单次模型请求仍受服务自身超时限制。
    const signal = generationSignal(req, res, { timeoutMs: 30 * 60 * 1000 });
    const courseId = parseId(res, req.params.courseId);
    if (!courseId) return;
    const input = z
      .object({ requirements: z.string().trim().max(500).optional().default('') })
      .safeParse(req.body || {});
    if (!input.success) return res.status(400).json({ message: '整理要求不能超过 500 字' });
    const course = await getOwnedCourse(req.user.sub, courseId);
    if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
    const [materials] = await db.execute(
      'SELECT id,original_name,stored_name,preview_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
      [course.id],
    );
    if (!materials.length)
      return res.status(400).json({ message: '请先导入学习资料，再生成章节目录' });
    const sourceVersion = materialVersion(materials);
    // 文件显示名称可被用户重命名，处理方式以保存时保留的真实扩展名为准。
    const isPdf = (material) => /\.pdf$/i.test(material.stored_name || material.original_name);
    const pdfMaterials = materials.filter(isPdf);
    const textMaterials = materials.filter((material) => !isPdf(material));
    const model = getAiModel
      ? await getAiModel()
      : serviceSettings.snapshot('ai').baseUrl + '|' + serviceSettings.snapshot('ai').model;
    let pdfSources = [];
    const imageOutline = pdfMaterials.length
      ? await preparePdfOutline(pdfMaterials, {
          onSources: (sources) => {
            pdfSources = sources;
          },
          courseId: course.id,
          model,
          signal,
          onProgress: req.updateProgress,
          ask: (messages, partSignal, options) =>
            askDeepSeek(messages, undefined, partSignal, options),
        })
      : '';
    const sourceText = [
      imageOutline,
      textMaterials
        .map(
          (item) =>
            `【${item.original_name}】\n${item.extracted_text || '（未识别到可复制文字，请结合资料页面图片整理）'}`,
        )
        .join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
    await req.updateProgress?.(
      pdfMaterials.length ? 'PDF 图片识别已完成，正在汇总章节目录' : '正在汇总课程资料',
    );
    const context = await prepareLongContext(
      sourceText,
      (messages, partSignal, options) => askDeepSeek(messages, undefined, partSignal, options),
      signal,
      {
        db,
        courseId: course.id,
        purpose: 'outline',
        model,
        maxContextChars: pdfMaterials.length ? 30000 : 18000,
        validateFormulas: false,
        onProgress: req.updateProgress,
      },
    );
    const vision = textMaterials.length ? await buildVisionPages(textMaterials) : { parts: [] };
    const messages = [
      {
        role: 'system',
        content: `你是课程结构设计助手。仅依据资料文字、逐页图片分区摘要和页面图像生成单层章节目录，不补充资料外的知识。PDF 已按原页码识别上下重叠区域，汇总时合并重叠内容，按原资料顺序组织章节；description简短写明资料名及原PDF页码范围。每份PDF的第一页到最后一页必须全部分配：第一段startPage必须为1，最后一段endPage必须等于该PDF总页数，中间连续覆盖，相邻两章允许共用一张交界原页，不能大段重叠。封面、版权、目录、空白和后记只能并入相邻章节，不要单独成章，不能因此丢掉页码。参考用户的整理要求，但要求与资料冲突时以资料为准。按资料真实结构组织，最多${MAX_CHAPTER_DRAFTS}章。只输出 JSON，不要 Markdown。格式：{"chapters":[{"title":"原文标题，不超过120字","description":"简短说明，尽量不超过80字","sourceRegions":[{"materialId":资料数字ID,"startPage":原PDF起始数字页码,"endPage":原PDF结束数字页码}]}]}。有PDF时每章必须包含sourceRegions，数字字段不能写字符串。没有PDF时省略sourceRegions。`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `PDF图片章节映射要求：${pdfSources.length ? JSON.stringify(pdfSources) + '。每章增加sourceRegions数组，每项为{materialId,startPage,endPage}。按顺序完整分配上述PDF全部页码，禁止遗漏、越界和大段重叠，相邻两章可共用一张交界原页。页码为原PDF物理页码，不是印刷页码。章节正文将直接显示这些页的图片。封面、版权、目录、空白和附录不要单独成章，应并入相邻章节，仍须覆盖它们的物理页码；同页跨两篇课文时，两章可共用这一页以保持原文完整；保持用户指定的划分粒度。' : '无PDF'}\n课程名称：${course.title}\n用户整理要求：${input.data.requirements || '无特殊要求'}\n\n资料文字：\n${context}\n\n再次核对本次要求：${input.data.requirements || '按资料真实结构划分'}。必须保持用户指定的章节粒度，不得为了修正页码擅自合并章节。`,
          },
          ...vision.parts,
        ],
      },
    ];
    let parsed;
    const directoryHash = pdfSources.length
      ? createHash('sha256')
          .update(
            JSON.stringify({
              version: 'pdf-directory-v3',
              model,
              title: course.title,
              requirements: input.data.requirements,
              sourceText,
              pdfSources,
            }),
          )
          .digest('hex')
      : null;
    let cachedDirectory = false;
    if (directoryHash) {
      const [rows] = await db.execute(
        'SELECT result_text FROM course_context_cache WHERE course_id=? AND purpose=? AND content_hash=?',
        [course.id, 'pdf-directory-v3', directoryHash],
      );
      if (rows.length)
        try {
          parsed = z
            .object({ chapters: z.array(pdfChapterSchema).min(1).max(MAX_CHAPTER_DRAFTS) })
            .safeParse(JSON.parse(rows[0].result_text));
          if (parsed.success) {
            validatePdfChapterSources(parsed.data.chapters, pdfSources);
            cachedDirectory = true;
          }
        } catch {
          parsed = undefined;
        }
    }
    let validationMessage = 'AI 返回的章节目录格式无效';
    let previousAnswer;
    for (let attempt = 0; !parsed?.success && attempt < 2; attempt++) {
      signal.throwIfAborted();
      await req.updateProgress?.(attempt ? '正在校验并修复章节页码' : '正在生成章节目录与页码映射');
      let raw;
      try {
        raw = await askDeepSeek(
          attempt
            ? [
                ...messages,
                ...(previousAnswer ? [{ role: 'assistant', content: previousAnswer }] : []),
                {
                  role: 'user',
                  content: `请重新输出完整JSON。上次校验失败：${validationMessage}。PDF每章必须包含sourceRegions数组，每项只含数字materialId、startPage、endPage。按资料顺序覆盖所有物理页，不遗漏，仅允许相邻两章共用一张交界页。每份PDF首段startPage必须改为1，末段endPage必须等于该资料总页数；封面、目录、空白页并入首尾相邻章节，不新增无关标题。请逐项修正上面列出的缺页。`,
                },
              ]
            : messages,
          undefined,
          signal,
          { maxOutputTokens: attempt ? 32768 : 16384, thinking: false, jsonObject: true },
        );
      } catch (error) {
        if (!attempt && ['AI_OUTPUT_LIMIT', 'AI_EMPTY_RESPONSE'].includes(error.code)) {
          validationMessage =
            error.code === 'AI_OUTPUT_LIMIT'
              ? '输出被截断，请精简章节说明并返回完整JSON'
              : '没有返回目录内容，请返回完整JSON';
          continue;
        }
        throw error;
      }
      previousAnswer = raw;
      signal.throwIfAborted();
      try {
        const suggested = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '');
        parsed = z
          .object({
            chapters: z
              .array(pdfSources.length ? pdfChapterSchema : chapterSchema)
              .min(1)
              .max(MAX_CHAPTER_DRAFTS),
          })
          .safeParse(suggested);
        if (!parsed.success) {
          validationMessage = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')
            .slice(0, 1500);
          continue;
        }
        if (pdfSources.length) validatePdfChapterSources(parsed.data.chapters, pdfSources);
        break;
      } catch (error) {
        parsed = undefined;
        validationMessage = error instanceof SyntaxError ? 'JSON格式错误' : error.message;
      }
    }
    if (!parsed?.success)
      return res.status(502).json({ message: `AI 章节页码校验未通过：${validationMessage}` });
    signal.throwIfAborted();
    if (directoryHash && !cachedDirectory)
      await db.execute(
        'INSERT INTO course_context_cache(course_id,purpose,content_hash,result_text) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),result_text=VALUES(result_text),updated_at=CURRENT_TIMESTAMP',
        [course.id, 'pdf-directory-v3', directoryHash, JSON.stringify(parsed.data)],
      );
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // 锁定课程使保存与采用串行；失败时保留旧草稿，不留下半份目录。
      const [owned] = await connection.execute(
        'SELECT id FROM courses WHERE id=? AND user_id=? FOR UPDATE',
        [course.id, req.user.sub],
      );
      if (!owned.length) throw Object.assign(new Error('课程已删除或不可访问'), { status: 404 });
      const [currentMaterials] = await connection.execute(
        'SELECT id,original_name,stored_name,preview_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id FOR UPDATE',
        [course.id],
      );
      if (materialVersion(currentMaterials) !== sourceVersion)
        throw Object.assign(new Error('资料已变化，本次结果未保存，请按最新资料重新生成'), {
          status: 409,
        });
      signal.throwIfAborted();
      await req.beginSave?.(connection);
      await connection.execute('DELETE FROM course_chapter_drafts WHERE course_id=?', [course.id]);
      for (const [index, chapter] of parsed.data.chapters.entries()) {
        signal.throwIfAborted();
        await connection.execute(
          'INSERT INTO course_chapter_drafts(course_id,title,description,sort_order,source_regions_json) VALUES(?,?,?,?,?)',
          [
            course.id,
            chapter.title,
            chapter.description,
            index + 1,
            chapter.sourceRegions?.length ? JSON.stringify(chapter.sourceRegions) : null,
          ],
        );
      }
      signal.throwIfAborted();
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
          chapters: z
            .array(chapterSchema.extend({ id: z.coerce.number().int().positive().optional() }))
            .min(1, '请保留至少一个章节')
            .max(MAX_CHAPTER_DRAFTS, '章节数量过多')
            .refine((chapters) => {
              const ids = chapters.filter((chapter) => chapter.id).map((chapter) => chapter.id);
              return new Set(ids).size === ids.length;
            }, '不能重复采用同一章节草稿'),
          replaceExisting: z.boolean().optional().default(false),
        })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [owned] = await connection.execute(
          'SELECT id FROM courses WHERE id=? AND user_id=? FOR UPDATE',
          [course.id, req.user.sub],
        );
        if (!owned.length) throw Object.assign(new Error('课程已删除或不可访问'), { status: 404 });
        const [existing] = await connection.execute(
          'SELECT id FROM course_chapters WHERE course_id=? LIMIT 1',
          [course.id],
        );
        if (existing.length && !parsed.data.replaceExisting)
          throw Object.assign(new Error('当前已有章节，请确认替换后再采用新目录'), { status: 409 });
        if (existing.length)
          await connection.execute('DELETE FROM course_chapters WHERE course_id=?', [course.id]);
        const [savedDrafts] = await connection.execute(
          'SELECT id,source_regions_json FROM course_chapter_drafts WHERE course_id=? FOR UPDATE',
          [course.id],
        );
        const draftSources = new Map(
          savedDrafts.map((draft) => [Number(draft.id), draft.source_regions_json]),
        );
        if (
          savedDrafts.some((draft) => draft.source_regions_json) &&
          parsed.data.chapters.some((chapter) => !chapter.id)
        )
          throw Object.assign(new Error('图片章节缺少草稿编号，请刷新后重新采用'), { status: 409 });
        for (const [index, chapter] of parsed.data.chapters.entries()) {
          if (chapter.id && !draftSources.has(chapter.id))
            throw Object.assign(new Error('章节草稿已更新，请刷新后重新采用'), { status: 409 });
          const sourceRegions = draftSources.get(chapter.id);
          await connection.execute(
            'INSERT INTO course_chapters(course_id,title,description,sort_order,source_regions_json) VALUES(?,?,?,?,?)',
            [
              course.id,
              chapter.title,
              chapter.description,
              index + 1,
              sourceRegions
                ? typeof sourceRegions === 'string'
                  ? sourceRegions
                  : JSON.stringify(sourceRegions)
                : null,
            ],
          );
        }
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
