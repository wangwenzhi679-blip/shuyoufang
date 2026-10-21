import { formatExtractedText } from './material-text.mjs';
import { renderOfficePdf } from './pdf-browser.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { runPdfTool } from './pdf-tools.mjs';
import { OfficeParser } from 'officeparser';
import { createPdfOutlineReader } from './pdf-outline.js';
import { extractPdfText } from './pdf-text-worker.mjs';
import { createChapterSummarySource } from './chapter-summary-source.js';
import { createPdfOcrReader } from './pdf-ocr.js';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function createMaterialService({
  previewRoot,
  uploadRoot,
  runtime,
  db,
  visionRoot,
  parseOffice = (...args) => OfficeParser.parseOffice(...args),
  readPdfText = extractPdfText,
}) {
  const supportedMaterialExtensions = new Set(['.pdf', '.docx', '.pptx']);

  const normalizeUploadedName = (name) => {
    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      return /[\u4e00-\u9fff]/.test(decoded) ? decoded : name;
    } catch {
      return name;
    }
  };

  function removeMaterialFiles(materials) {
    let cleanupFailed = false;
    for (const material of materials) {
      if (material.id)
        for (const name of fs.readdirSync(previewRoot)) {
          if (new RegExp(`^(?:reading|original)-${Number(material.id)}-\\d+\\.png$`).test(name)) {
            try {
              fs.rmSync(path.join(previewRoot, name), { force: true });
            } catch {
              cleanupFailed = true;
            }
          }
        }
      for (const filePath of [
        path.join(uploadRoot, material.stored_name),
        material.preview_name && path.join(previewRoot, material.preview_name),
      ].filter(Boolean)) {
        try {
          fs.rmSync(filePath, { force: true });
        } catch (error) {
          cleanupFailed = true;
          console.error('课程资料文件清理失败', filePath, error);
        }
      }
    }
    return cleanupFailed;
  }

  const upload = {
    array: () => (req, res, next) => {
      const limits = runtime.snapshot();
      req.uploadLimits = limits;
      return multer({
        storage: multer.diskStorage({
          destination: (req, file, done) => done(null, uploadRoot),
          filename: (req, file, done) =>
            done(
              null,
              `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`,
            ),
        }),
        limits: { fileSize: limits.uploadMB * 1024 * 1024, files: limits.uploadCount },
        fileFilter: (req, file, done) =>
          done(
            null,
            supportedMaterialExtensions.has(path.extname(file.originalname).toLowerCase()),
          ),
      }).array('files', limits.uploadCount)(req, res, next);
    },
  };

  async function processMaterial(filePath, sourceName, { signal, onProgress } = {}) {
    // PDF 章节直接识别原页图片；导入只取原有文字，避免逐图 OCR 拖住整个队列。
    const isPdf = path.extname(sourceName).toLowerCase() === '.pdf';
    signal?.throwIfAborted();
    if (isPdf)
      return {
        extractedText: formatExtractedText(await readPdfText(filePath, { signal, onProgress })),
        previewName: null,
      };
    const ast = await parseOffice(filePath, {
      extractAttachments: !isPdf,
      ocr: !isPdf,
      ocrConfig: { language: 'chi_sim+eng', preserveLayout: false },
    });
    const textResult = await ast.to('text', { includeImages: 'none' });
    const extractedText = formatExtractedText(textResult.value);
    // 原样 PDF 预览在首次打开阅读时生成，不阻塞资料导入。
    return { extractedText, previewName: null };
  }

  async function buildVisionPages(
    materials,
    maxPages = Number(process.env.VISION_MAX_PAGES || 12),
  ) {
    const parts = [];
    const references = [];
    const temporaryFiles = [];
    try {
      for (const material of materials) {
        if (parts.length >= maxPages) break;
        let sourcePath = material.preview_name
          ? path.join(previewRoot, material.preview_name)
          : path.join(uploadRoot, material.stored_name);
        if (!material.preview_name && path.extname(sourcePath).toLowerCase() !== '.pdf') {
          try {
            const ast = await OfficeParser.parseOffice(sourcePath, { extractAttachments: true });
            const pdf = await renderOfficePdf(ast);
            const previewName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
            sourcePath = path.join(previewRoot, previewName);
            fs.writeFileSync(sourcePath, Buffer.from(pdf.value));
            await db.execute('UPDATE course_materials SET preview_name=? WHERE stored_name=?', [
              previewName,
              material.stored_name,
            ]);
          } catch {
            continue;
          }
        }
        if (!fs.existsSync(sourcePath)) continue;
        const prefix = path.join(visionRoot, `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
        try {
          await runPdfTool(
            'pdftoppm',
            [
              '-f',
              '1',
              '-l',
              String(Math.min(4, maxPages - parts.length)),
              '-jpeg',
              '-r',
              '130',
              sourcePath,
              prefix,
            ],
            { timeout: 30_000 },
          );
          const pages = fs
            .readdirSync(visionRoot)
            .filter((name) => name.startsWith(path.basename(prefix)) && name.endsWith('.jpg'))
            .sort();
          for (const page of pages) {
            if (parts.length >= maxPages) break;
            const pagePath = path.join(visionRoot, page);
            temporaryFiles.push(pagePath);
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${fs.readFileSync(pagePath).toString('base64')}`,
                detail: 'low',
              },
            });
            const pageNumber = Number((page.match(/-(\d+)\.jpg$/) || [])[1]) || parts.length;
            references.push(`${material.original_name} · 第 ${pageNumber} 页`);
          }
        } catch {
          /* A text-only answer remains available if page rendering is unavailable. */
        }
      }
      return { parts, references };
    } finally {
      for (const filePath of temporaryFiles) fs.rmSync(filePath, { force: true });
    }
  }
  const preparePdfOutline = createPdfOutlineReader({
    db,
    uploadRoot,
    tempRoot: visionRoot,
    // 给问答等操作保留一个并发名额；仍受平台总并发限制约束。
    concurrency: () => Math.max(1, Math.min(4, (runtime?.snapshot().aiConcurrency || 4) - 1)),
  });
  return {
    normalizeUploadedName,
    removeMaterialFiles,
    upload,
    processMaterial,
    buildVisionPages,
    preparePdfOutline,
    readChapterSummarySource: createChapterSummarySource({
      uploadRoot,
      readPdfText: createPdfOcrReader({
        cacheRoot: path.join(previewRoot || path.resolve('storage', 'previews'), 'ocr-text'),
        readPdfText,
      }),
    }),
  };
}
