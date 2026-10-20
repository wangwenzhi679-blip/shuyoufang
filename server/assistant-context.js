const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function selectAssistantPassages(sections, question, limit = 6) {
  const words = [
    ...new Set(
      (question.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || []).flatMap((word) =>
        /^[\u4e00-\u9fff]+$/.test(word)
          ? [...Array(Math.max(0, word.length - 1))].map((_, i) => word.slice(i, i + 2))
          : [word],
      ),
    ),
  ].filter(
    (w) =>
      ![
        '请问',
        '什么',
        '这个',
        '课程',
        '一下',
        '可以',
        '如何',
        '帮我',
        '根据',
        '资料',
        '刚才',
        '内容',
      ].includes(w),
  );
  const passages = [];
  for (const section of sections) {
    const text = section.content || '';
    for (let start = 0; start < text.length; start += 1400) {
      const content = text.slice(start, start + 1700);
      const lower = content.toLowerCase();
      const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
      passages.push({ ...section, content, score, order: passages.length });
    }
  }
  return passages.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, limit);
}

export function createAssistantContext({
  db,
  assertCourse,
  sliceChapterText,
  selectChapterQuestions,
  applyChapterCorrections,
  readPreferences,
  readChapterSummarySource,
}) {
  return async (userId, courseId, chapterId, question, model, signal) => {
    signal.throwIfAborted();
    await assertCourse(userId, courseId, true);
    const [[course]] = await db.execute('SELECT title FROM courses WHERE id=? AND user_id=?', [
      courseId,
      userId,
    ]);
    if (!course) throw fail('课程不存在', 404);
    const [materials] = await db.execute(
      'SELECT id,original_name,stored_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
      [courseId],
    );
    if (!materials.length) throw fail('请先导入课程资料，再开始研习');
    let sections = materials.map((m) => ({
        materialId: m.id,
        name: m.original_name,
        content: m.extracted_text,
      })),
      chapter;
    if (chapterId) {
      const [chapters] = await db.execute(
        'SELECT id,title,description,source_regions_json FROM course_chapters WHERE course_id=? ORDER BY sort_order,id',
        [courseId],
      );
      const index = chapters.findIndex((ch) => Number(ch.id) === Number(chapterId));
      chapter = chapters[index];
      if (!chapter) throw fail('本对话的章节已删除，请新建对话选择范围', 404);
      const corrections =
        chapter.source_regions_json != null
          ? await applyChapterCorrections(db, courseId, chapterId, [])
          : [];
      const pageSections = readChapterSummarySource
        ? await readChapterSummarySource(chapter, materials, signal, corrections)
        : null;
      sections =
        pageSections ??
        materials
          .map((m) => ({
            materialId: m.id,
            name: m.original_name,
            content: sliceChapterText(m.extracted_text || '', chapter, chapters.slice(index + 1)),
          }))
          .filter((s) => s.content);
      if (!sections.length && pageSections === null)
        sections = selectChapterQuestions(materials, chapter).map((s) => ({
          materialId: s.materialId,
          name: s.materialName,
          content: s.content,
        }));
      sections = await applyChapterCorrections(db, courseId, chapterId, sections);
    }
    const passages = selectAssistantPassages(sections, question);
    if (!passages.length)
      throw fail(
        chapterId
          ? '暂未定位到这一章的资料，请调整章节或补充资料后再提问'
          : '资料尚未识别出可供问答的文字，请补充可读取的资料',
      );
    const { preferences } = await readPreferences(db, userId);
    signal.throwIfAborted();
    return {
      text:
        `课程：${course.title}\n问答范围：${chapter ? chapter.title : '整门课程'}\n以下为检索到的资料片段，可能不完整；资料不足时须明确说明。\n\n` +
        passages
          .map(
            (s, i) =>
              `[资料${i + 1}] ${s.name}${chapter ? ' · ' + chapter.title : ''}\n${s.content}`,
          )
          .join('\n\n'),
      preference:
        '回答长度偏好：' +
        ({
          concise: '简洁，直接给出结论。',
          moderate: '适中，给出必要解释。',
          detailed: '详细，分步骤解释。',
        }[preferences.answerStyle] || '适中。'),
      sources: passages.map((s) => ({
        materialId: s.materialId,
        courseId,
        chapterId: chapterId || null,
        name: s.name,
        chapterTitle: chapter?.title || '',
        excerpt: s.content.slice(0, 550),
      })),
    };
  };
}
