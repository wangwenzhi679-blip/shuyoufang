import { z } from 'zod';

// 集中维护接口输入及 AI 结果的结构约束；导入本模块不会连接数据库或启动服务。
export const grades = ['初一', '初二', '初三', '高一', '高二', '高三'];
export const emailSchema = z.string().trim().toLowerCase().email('请输入正确的邮箱地址').max(254);
export const accountSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{8,16}$/, '账号为 8—16 位字母、数字或下划线');
export const passwordSchema = z.string().min(8, '密码为 8—16 位').max(16, '密码为 8—16 位');
export const codeSchema = z.string().regex(/^\d{6}$/, '请输入 6 位验证码');
export const idSchema = z.coerce.number().int().positive('参数错误');
export const courseSchema = z.object({
  title: z.string().trim().min(1, '请输入课程名称').max(100, '课程名称不超过 100 个字'),
  description: z.string().trim().max(500, '课程简介不超过 500 个字').optional().default(''),
});
export const chapterSchema = z.object({
  title: z.string().trim().min(1, '请输入章节名称').max(120, '章节名称不超过 120 个字'),
  description: z.string().trim().max(500, '章节说明不超过 500 个字').optional().default(''),
});
export const questionTypes = ['单选题', '多选题', '判断题', '填空题', '简答题'];
export const questionItemSchema = z.object({
  type: z.enum(questionTypes),
  question: z.string().trim().min(1, '题干不能为空').max(2000),
  options: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
  answer: z.string().trim().min(1, '答案不能为空').max(1000),
  analysis: z.string().trim().min(1, '解析不能为空').max(2000),
});
export const questionCountsSchema = z
  .array(z.object({ type: z.enum(questionTypes), count: z.coerce.number().int().min(1).max(10) }))
  .min(1, '请至少选择一种题型')
  .max(5);
export const questionGenerateSchema = z
  .object({
    chapterId: idSchema,
    questionCounts: questionCountsSchema,
    difficulty: z.enum(['基础', '适中', '提高']).default('适中'),
    requirements: z.string().trim().max(500).optional().default(''),
    persist: z.boolean().optional().default(true),
  })
  .superRefine((value, context) => {
    const total = value.questionCounts.reduce((sum, item) => sum + item.count, 0);
    if (total > 20)
      context.addIssue({
        code: 'custom',
        message: '一次最多生成 20 道题',
        path: ['questionCounts'],
      });
  });
export const practiceSchema = z.object({
  title: z.string().trim().min(1, '请输入练习名称').max(120),
  questions: z.array(questionItemSchema).min(1, '请至少保留一道题').max(20),
});
export const practiceAttemptSchema = z.object({
  requestId: z.string().uuid().optional(),
  answers: z
    .array(
      z.object({
        questionIndex: z.coerce.number().int().min(0).max(19),
        answer: z.union([z.string().max(2000), z.array(z.string().max(20)).max(8)]),
        correct: z.boolean(),
      }),
    )
    .max(20),
  correctCount: z.coerce.number().int().min(0).max(20),
  totalCount: z.coerce.number().int().min(1).max(20),
});
export const practiceProgressSchema = z.object({
  answers: z
    .record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(20)).max(8)]))
    .refine(
      (value) =>
        Object.keys(value).length <= 20 &&
        Object.keys(value).every((key) => /^(?:[0-9]|1[0-9])$/.test(key)),
      '答题进度格式不正确',
    ),
});
export const chapterSummaryResultSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  knowledgePoints: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        explanation: z.string().trim().min(1).max(500),
      }),
    )
    .min(2)
    .max(10),
});
