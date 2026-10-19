import { idSchema } from './request-schemas.mjs';
import { readPreferences } from './user-account.js';
import { prepareLongContext } from './long-context.js';
import { z } from 'zod';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function registerAssistantRoutes(
  app,
  {
    auth,
    serviceSettings,
    asyncRoute,
    validationError,
    getOwnedCourse,
    db,
    generationSignal,
    askDeepSeek,
    accountModels,
    contentControl,
  },
) {
  app.get('/api/assistant/models', auth, (req, res) => {
    const config = serviceSettings.snapshot('ai');
    res.json({
      models: [
        { id: 'configured', label: config.name + ' · ' + config.model },
        ...(new URL(config.baseUrl).hostname === 'api.deepseek.com'
          ? [
              { id: 'deepseek-flash', label: 'DeepSeek Flash' },
              { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
            ]
          : []),
      ],
    });
  });

  app.post(
    '/api/assistant/ask',
    auth,
    asyncRoute(async (req, res) => {
      const parsed = z
        .object({
          courseId: idSchema,
          question: z.string().trim().min(1, '请输入问题').max(1000, '问题不能超过 1000 个字'),
          model: z
            .enum(['configured', 'deepseek-flash', 'deepseek-v4-pro'])
            .optional()
            .default('configured'),
          history: z
            .array(
              z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string().trim().min(1).max(4000),
              }),
            )
            .max(12)
            .optional()
            .default([]),
        })
        .safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);
      const course = await getOwnedCourse(req.user.sub, parsed.data.courseId);
      if (!course) return res.status(404).json({ message: '课程不存在或无权访问' });
      const [materials] = await db.execute(
        'SELECT original_name,stored_name,preview_name,extracted_text FROM course_materials WHERE course_id=? ORDER BY created_at,id',
        [course.id],
      );
      if (!materials.length)
        return res.status(400).json({ message: '请先为这门课程导入资料，再向 AI 提问' });
      if (!serviceSettings.configured('ai'))
        return res.status(503).json({ message: 'AI 服务尚未配置或已暂停，暂时无法回答' });
      const signal = generationSignal(req, res);
      const context = await prepareLongContext(
        materials
          .map((item) => `【${item.original_name}】\n${item.extracted_text || '（未识别到文字）'}`)
          .join('\n\n'),
        (messages, partSignal) => askDeepSeek(messages, parsed.data.model, partSignal),
        signal,
        {
          db,
          courseId: course.id,
          model:
            serviceSettings.snapshot('ai').baseUrl +
            '|' +
            serviceSettings.snapshot('ai').model +
            '|' +
            parsed.data.model,
          validateFormulas: false,
        },
      );
      const messages = [
        {
          role: 'system',
          content:
            '你是课程学习助手。仅依据给出的课程资料回答，不编造。你正在与学生连续聊天：记住此前问答，并且每次只回答当前这个问题，不要同时抛出多个新问题。回答使用简明中文；资料不足时明确说明。资料要点不是逐字原文，不用于声称引用具体题号或完整题干；未识别的公式或符号不得猜测补全。',
        },
        { role: 'user', content: `课程：${course.title}\n\n课程资料：\n${context}` },
        ...parsed.data.history,
        { role: 'user', content: parsed.data.question },
      ];
      const { preferences } = await readPreferences(db, req.user.sub);
      messages[0].content +=
        ' 回答长度偏好：' +
        {
          concise: '简洁，优先直接给结论。',
          moderate: '适中，给出必要解释。',
          detailed: '详细，分步骤解释并提供资料内的例子。',
        }[preferences.answerStyle];
      if (!accountModels().some((model) => model.id === parsed.data.model))
        return res.status(400).json({ message: '该模型已停用，请重新选择' });
      const answer = await askDeepSeek(messages, parsed.data.model, signal);
      await contentControl.assertCourse(req.user.sub, course.id, true);
      res.json({ answer, sources: materials.map((item) => item.original_name) });
    }),
  );
}
