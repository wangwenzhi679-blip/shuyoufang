import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 只提取 PDF 自带文字，不构建版面 AST、不解码插图，也不启动整本 OCR。
// 独立线程使解析和取消不会阻塞网站请求。
export function extractPdfText(filename, { signal, timeoutMs = 120000, pageNumbers } = {}) {
  signal?.throwIfAborted();
  if (
    pageNumbers !== undefined &&
    (!Array.isArray(pageNumbers) ||
      !pageNumbers.length ||
      pageNumbers.length > 300 ||
      pageNumbers.some((page) => !Number.isInteger(page) || page < 1))
  )
    throw new Error('PDF 章节页码无效');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { filename, pageNumbers },
      execArgv: [],
    });
    let settled = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(text);
    };
    const abort = () => finish(signal.reason || new Error('导入已停止'));
    const timer = setTimeout(
      () => finish(new Error('PDF 文字提取超时，请检查文件后重试')),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (result) =>
      result.error ? finish(new Error(result.error)) : finish(null, result.text),
    );
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`PDF 提取进程意外退出（${code}）`));
    });
  });
}

if (!isMainThread) {
  let document;
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    document = await getDocument({
      data: new Uint8Array(await fs.readFile(workerData.filename)),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      cMapUrl: fileURLToPath(
        new URL('./node_modules/pdfjs-dist/cmaps/', import.meta.url),
      ).replaceAll('\\', '/'),
      cMapPacked: true,
      standardFontDataUrl: fileURLToPath(
        new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url),
      ).replaceAll('\\', '/'),
      verbosity: 0,
    }).promise;
    const pages = [];
    const numbers =
      workerData.pageNumbers || Array.from({ length: document.numPages }, (_, index) => index + 1);
    if (numbers.some((number) => number > document.numPages))
      throw new Error('PDF 章节页码超出原资料范围，请重新划分章节');
    for (const number of numbers) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join(''),
      );
      page.cleanup();
    }
    parentPort.postMessage({ text: pages.join('\n\n') });
  } catch (error) {
    const message =
      error.name === 'PasswordException'
        ? 'PDF 已加密或需要密码，请先解除文件密码后重新导入'
        : error.name === 'InvalidPDFException'
          ? 'PDF 文件结构无效或已损坏，请确认文件能正常打开后重新导入'
          : error.code === 'ENOENT'
            ? '原 PDF 文件不存在，请重新上传后重试'
            : error.message || 'PDF 无法读取，请检查文件后重试';
    parentPort.postMessage({ error: message });
  } finally {
    await document?.destroy();
  }
}
