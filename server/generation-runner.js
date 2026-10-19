import { registerGenerationJobs } from './generation-jobs.js';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerGenerationRunner(
  app,
  {
    db,
    auth,
    asyncRoute,
    contentControl,
    generationSignal,
    chaptersSuggest,
    summaryGenerate,
    questionsGenerate,
    practiceCreate,
  },
) {
  registerGenerationJobs(
    app,
    db,
    auth,
    asyncRoute,
    async (userId, input, signal, beginSave, updateProgress) => {
      const invoke = async (handler, body) => {
        let status = 200,
          result;
        const response = {
          status(code) {
            status = code;
            return this;
          },
          json(value) {
            result = value;
            return this;
          },
        };
        await contentControl.assertCourse(userId, input.courseId, true);
        await handler(
          {
            params: { courseId: input.courseId, chapterId: input.chapterId },
            user: { sub: userId },
            body,
            generationSignal: signal,
            beginSave,
            updateProgress,
          },
          response,
        );
        if (status >= 400)
          throw Object.assign(new Error(result?.message || '生成失败'), { status });
        return result;
      };
      if (input.kind === 'chapters')
        return invoke(chaptersSuggest, { requirements: input.requirements || '' });
      if (input.kind === 'summary')
        return invoke(summaryGenerate, { requirements: input.requirements || '' });
      const generated = await invoke(questionsGenerate, {
        ...input.settings,
        chapterId: input.chapterId,
        persist: false,
      });
      await beginSave();
      const [chapters] = await db.execute(
        'SELECT title FROM course_chapters WHERE id=? AND course_id=?',
        [input.chapterId, input.courseId],
      );
      if (!chapters.length) throw new Error('章节已删除');
      return invoke(practiceCreate, {
        title: chapters[0].title + '练习',
        questions: generated.questions,
      });
    },
  );
}
