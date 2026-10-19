import { z } from 'zod';
import { chapterSchema } from './request-schemas.mjs';

export const pdfChapterSchema = chapterSchema.extend({
  sourceRegions: z
    .array(
      z.object({
        materialId: z.number().int().positive(),
        startPage: z.number().int().positive(),
        endPage: z.number().int().positive().max(300),
      }),
    )
    .min(1)
    .max(300),
});

// 原图阅读依赖精确页码，不能通过自然语言说明猜测，也不能接受遗漏或越界。
export function validatePdfChapterSources(chapters, sources) {
  const expected = sources.flatMap((source) =>
    Array.from({ length: source.pages }, (_, i) => `${source.materialId}:${i + 1}`),
  );
  const actual = [];
  for (const chapter of chapters) {
    const parsed = pdfChapterSchema.parse(chapter);
    for (const region of parsed.sourceRegions) {
      const source = sources.find((item) => item.materialId === region.materialId);
      if (!source || region.endPage > source.pages || region.startPage > region.endPage)
        throw new Error('AI 返回的 PDF 章节页码越界，请重新生成目录');
      for (let page = region.startPage; page <= region.endPage; page++)
        actual.push(`${region.materialId}:${page}`);
    }
  }
  if (actual.length !== expected.length || actual.some((page, i) => page !== expected[i]))
    throw new Error('AI 返回的 PDF 章节页码存在遗漏、重叠或顺序错误，请重新生成目录');
}
