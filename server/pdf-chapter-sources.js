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
  const pageOrder = new Map(expected.map((page, index) => [page, index]));
  let covered = -1,
    lastChapter = -1;
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const parsed = pdfChapterSchema.parse(chapter);
    for (const region of parsed.sourceRegions) {
      const source = sources.find((item) => item.materialId === region.materialId);
      if (!source || region.endPage > source.pages || region.startPage > region.endPage)
        throw new Error('AI 返回的 PDF 章节页码越界，请重新生成目录');
      for (let page = region.startPage; page <= region.endPage; page++) {
        const key = `${region.materialId}:${page}`;
        const index = pageOrder.get(key);
        if (index === covered + 1) covered = index;
        // 两篇课文可能在同一原页交接。只允许新章首部共用前章最后一页，不能重复整段。
        else if (!(index === covered && chapterIndex !== lastChapter && page === region.startPage))
          throw new Error(
            `AI 返回的 PDF 章节页码存在遗漏、重叠或顺序错误：预期 ${expected[covered + 1] || '全部页面已分配'}，实际 ${key}。仅相邻章节可共享一张交界页，请保留标题并修正页码`,
          );
        lastChapter = chapterIndex;
      }
    }
  }
  if (covered !== expected.length - 1)
    throw new Error(
      `AI 返回的 PDF 章节页码存在遗漏：缺少资料ID:物理页码 ${expected.slice(covered + 1, covered + 9).join('、')}。请保留标题并补齐末尾页面`,
    );
}
