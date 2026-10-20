import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hasDamagedFormula } from './material-quality.js';
import { extractPdfText } from './pdf-text-worker.mjs';
import { recognizePdfImages } from './pdf-ocr-worker.mjs';
import { createPdfPageImages } from './pdf-page-images.js';

// One OCR job at a time limits memory on small servers. Waiting/cancelling one job cannot cancel another.
let occupied = false;
const queue = [];
async function acquire(signal) {
  signal?.throwIfAborted();
  if (occupied)
    await new Promise((resolve, reject) => {
      const item = {
        resolve: () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        },
      };
      const abort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      queue.push(item);
    });
  occupied = true;
  return () => {
    const next = queue.shift();
    if (next) next.resolve();
    else occupied = false;
  };
}

export const needsOcr = (text) =>
  hasDamagedFormula(text) || (String(text || '').match(/[\p{L}\p{N}]/gu) || []).length < 24;

export function createPdfOcrReader({
  cacheRoot,
  readPdfText = extractPdfText,
  recognize = recognizePdfImages,
  renderPage,
}) {
  return async (filename, { signal, pageNumbers, onProgress } = {}) => {
    const originalStat = await fs.stat(filename);
    const native = await readPdfText(filename, { signal, pageNumbers, returnPages: true });
    if (typeof native === 'string') return native; // Compatibility with injected import readers.
    if (!native.some((item) => needsOcr(item.text)))
      return native.map((item) => item.text).join('\n\n');
    await onProgress?.('正在识别本章扫描页文字');
    const release = await acquire(signal);
    let snapshotDirectory;
    try {
      signal?.throwIfAborted();
      const bytes = await fs.readFile(filename);
      const currentStat = await fs.stat(filename);
      if (currentStat.mtimeMs !== originalStat.mtimeMs || currentStat.size !== originalStat.size)
        throw Object.assign(new Error('原 PDF 已变化，请重新生成'), { status: 409 });
      const hash = createHash('sha256').update(bytes).digest('hex');
      const root = path.join(cacheRoot, `tesseract7-chi-sim-220dpi-v3-${hash}`);
      await fs.mkdir(root, { recursive: true });
      const results = new Map(native.map((item) => [item.page, item.text]));
      const missing = [];
      for (const item of native) {
        signal?.throwIfAborted();
        if (!needsOcr(item.text)) continue;
        try {
          const cached = JSON.parse(
            await fs.readFile(path.join(root, `${item.page}.json`), 'utf8'),
          );
          if (
            cached.page === item.page &&
            typeof cached.text === 'string' &&
            !hasDamagedFormula(cached.text)
          ) {
            results.set(item.page, cached.text);
            continue;
          }
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
        missing.push(item.page);
        results.delete(item.page);
      }
      if (missing.length && !renderPage) {
        snapshotDirectory = await fs.mkdtemp(path.join(root, 'snapshot-'));
        await fs.writeFile(path.join(snapshotDirectory, 'source.pdf'), bytes);
      }
      const render =
        renderPage ||
        createPdfPageImages({
          uploadRoot: snapshotDirectory,
          previewRoot: path.join(root, 'images'),
          dpi: 220,
        });
      let completed = 0;
      for (let offset = 0; offset < missing.length; offset += 4) {
        const images = [];
        await onProgress?.(
          `正在准备识别原页 ${offset + 1}-${Math.min(offset + 4, missing.length)}/${missing.length}`,
        );
        for (const page of missing.slice(offset, offset + 4)) {
          signal?.throwIfAborted();
          // A source-hash-specific rendering avoids stale reader images if the file was replaced.
          const image = await render(
            { id: 1, stored_name: renderPage ? path.basename(filename) : 'source.pdf' },
            page,
          );
          images.push({ page, filename: image });
        }
        if (images.length)
          await recognize(images, {
            signal,
            onPage: async (result) => {
              signal?.throwIfAborted();
              if (
                !missing.includes(result.page) ||
                results.has(result.page) ||
                typeof result.text !== 'string' ||
                hasDamagedFormula(result.text) ||
                (result.text.trim() && Number.isFinite(result.confidence) && result.confidence < 30)
              )
                throw Object.assign(new Error('OCR 识别置信度过低或文字无效，请检查原页清晰度'), {
                  status: 422,
                });
              results.set(result.page, result.text);
              const temporary = path.join(root, `${result.page}-${randomUUID()}.tmp`);
              try {
                await fs.writeFile(temporary, JSON.stringify(result));
                signal?.throwIfAborted();
                await fs.rename(temporary, path.join(root, `${result.page}.json`));
              } finally {
                await fs.rm(temporary, { force: true });
              }
              await onProgress?.(`本章文字识别 ${++completed}/${missing.length} 页`);
            },
          });
        signal?.throwIfAborted();
        if (images.some((image) => !results.has(image.page)))
          throw new Error('OCR 识别遗漏页面，请重试');
      }
      const finalStat = await fs.stat(filename);
      if (finalStat.mtimeMs !== originalStat.mtimeMs || finalStat.size !== originalStat.size)
        throw Object.assign(new Error('原 PDF 已变化，请重新生成'), { status: 409 });
      return native
        .map((item) =>
          results.get(item.page)?.trim()
            ? `【原 PDF 第 ${item.page} 页】\n${results.get(item.page)}`
            : '',
        )
        .filter(Boolean)
        .join('\n\n');
    } finally {
      try {
        if (
          snapshotDirectory &&
          path.resolve(snapshotDirectory).startsWith(path.resolve(cacheRoot) + path.sep)
        )
          await fs.rm(snapshotDirectory, { recursive: true, force: true });
      } finally {
        release();
      }
    }
  };
}
