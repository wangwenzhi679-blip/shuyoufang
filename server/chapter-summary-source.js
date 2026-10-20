import path from 'node:path';
import { z } from 'zod';
import { extractPdfText } from './pdf-text-worker.mjs';

const regionsSchema = z
  .array(
    z.object({
      materialId: z.number().int().positive(),
      startPage: z.number().int().positive().max(300),
      endPage: z.number().int().positive().max(300),
    }),
  )
  .min(1)
  .max(300);

// Physical page mappings are authoritative: never substitute title matches or the whole book.
export function createChapterSummarySource({ uploadRoot, readPdfText = extractPdfText }) {
  return async (chapter, materials, signal, corrections = [], onProgress) => {
    signal?.throwIfAborted();
    let regions = chapter.source_regions_json;
    if (regions == null) return null;
    try {
      regions = typeof regions === 'string' ? JSON.parse(regions) : regions;
    } catch {
      throw Object.assign(new Error('章节原页范围无效，请重新划分章节'), { status: 422 });
    }
    const parsed = regionsSchema.safeParse(regions);
    if (!parsed.success || parsed.data.some((r) => r.startPage > r.endPage))
      throw Object.assign(new Error('章节原页范围无效，请重新划分章节'), { status: 422 });
    const groups = new Map();
    for (const region of parsed.data) {
      const pages = groups.get(region.materialId) || new Set();
      for (let page = region.startPage; page <= region.endPage; page++) pages.add(page);
      groups.set(region.materialId, pages);
    }
    const sections = [];
    for (const [id, pages] of groups) {
      signal?.throwIfAborted();
      const corrected = corrections.find(
        (section) => Number(section.materialId) === id && section.corrected,
      );
      if (corrected?.content?.trim()) {
        sections.push(corrected);
        continue;
      }
      const material = materials.find((m) => Number(m.id) === id);
      if (
        !material ||
        !material.stored_name ||
        path.basename(material.stored_name) !== material.stored_name ||
        path.extname(material.stored_name).toLowerCase() !== '.pdf'
      )
        throw Object.assign(new Error('章节关联的原 PDF 不存在，请重新导入或划分章节'), {
          status: 422,
        });
      const content = await readPdfText(path.join(uploadRoot, material.stored_name), {
        signal,
        pageNumbers: [...pages].sort((a, b) => a - b),
        onProgress,
      });
      signal?.throwIfAborted();
      if (!content.trim())
        throw Object.assign(
          new Error('本章原页没有可用文字，请检查扫描清晰度、OCR 识别结果或补充本章文字后重试'),
          { status: 422 },
        );
      sections.push({ materialId: id, name: material.original_name, content });
    }
    return sections;
  };
}
