import fs from 'node:fs/promises';
import path from 'node:path';
import { regionsSchema } from './chapter-summary-source.js';
import { createPdfPageImages } from './pdf-page-images.js';
import { runPdfTool } from './pdf-tools.mjs';

const fail = (message) => Object.assign(new Error(message), { status: 422 });

// Render source pages only: no OCR, transcription request, or generated replacement text.
export function createAssistantPageSource({
  uploadRoot,
  previewRoot,
  renderPage = createPdfPageImages({ uploadRoot, previewRoot, dpi: 130 }),
  readFile = fs.readFile,
  pageCount = async (material, signal) => {
    const { stdout } = await runPdfTool('pdfinfo', [path.join(uploadRoot, material.stored_name)], {
      signal,
      timeout: 30000,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    });
    return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  },
  maxPages = 32,
  maxBytes = 32 * 1024 * 1024,
}) {
  return async (chapter, materials, signal, corrections = [], beforeImages) => {
    signal?.throwIfAborted();
    const groups = new Map();
    if (chapter) {
      let regions = chapter.source_regions_json;
      try {
        if (typeof regions === 'string') regions = JSON.parse(regions);
      } catch {
        regions = null;
      }
      const parsed = regionsSchema.safeParse(regions);
      if (!parsed.success || parsed.data.some((r) => r.startPage > r.endPage))
        throw fail('章节原页范围无效，请重新划分章节');
      for (const region of parsed.data) {
        const pages = groups.get(region.materialId) || new Set();
        for (let page = region.startPage; page <= region.endPage; page++) pages.add(page);
        groups.set(region.materialId, pages);
      }
    } else {
      for (const material of materials) groups.set(Number(material.id), null);
    }
    const plan = [],
      sections = [];
    let count = 0;
    for (const [id, selected] of groups) {
      signal?.throwIfAborted();
      const material = materials.find((item) => Number(item.id) === id);
      if (
        !material?.stored_name ||
        path.basename(material.stored_name) !== material.stored_name ||
        path.extname(material.stored_name).toLowerCase() !== '.pdf'
      )
        throw fail('章节关联的原 PDF 不存在，请重新导入或划分章节');
      const corrected = corrections.find(
        (s) => Number(s.materialId) === id && s.corrected && s.content?.trim(),
      );
      if (corrected) {
        sections.push(corrected);
        continue;
      }
      const total = selected ? selected.size : await pageCount(material, signal);
      if (!Number.isSafeInteger(total) || total < 1)
        throw fail('无法读取原 PDF 页数，请检查原文件');
      count += total;
      if (count > maxPages)
        throw fail(
          `本次图片资料超过 ${maxPages} 页，请新建对话选择较小的章节范围后再提问；原图不会被截断提交`,
        );
      plan.push({
        material,
        pages: selected
          ? [...selected].sort((a, b) => a - b)
          : Array.from({ length: total }, (_, i) => i + 1),
      });
    }
    const parts = [],
      sources = [];
    if (plan.length) await beforeImages?.();
    signal?.throwIfAborted();
    let bytesTotal = 0;
    for (const { material, pages } of plan) {
      for (const page of pages) {
        signal?.throwIfAborted();
        const filename = await renderPage(material, page);
        signal?.throwIfAborted();
        const bytes = await readFile(filename);
        signal?.throwIfAborted();
        bytesTotal += bytes.length;
        if (bytes.length > 12 * 1024 * 1024 || bytesTotal > maxBytes)
          throw fail('本次原页图片过大，请选择较小的章节范围后再提问；原图不会被截断提交');
        const source = {
          materialId: Number(material.id),
          name: material.original_name,
          page,
          excerpt: `原 PDF 第 ${page} 页图片（直接提供给模型，未经 OCR 转录）`,
        };
        sources.push(source);
        parts.push(
          {
            type: 'text',
            text: `[原页${sources.length}] ${material.original_name} · 原 PDF 第 ${page} 页`,
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${bytes.toString('base64')}`, detail: 'high' },
          },
        );
      }
    }
    return { parts, sources, sections };
  };
}

// Preserve multimodal content when adding a question or exercise instructions.
export function assistantSourceContent(context, extra = '') {
  const text = context.text + (extra ? `\n${extra}` : '');
  return context.parts?.length ? [{ type: 'text', text }, ...context.parts] : text;
}
