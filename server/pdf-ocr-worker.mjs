import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function recognizePdfImages(
  images,
  {
    signal,
    onPage,
    langPath = process.env.OCR_LANG_PATH || fileURLToPath(new URL('./', import.meta.url)),
    timeoutMs = 180000,
  } = {},
) {
  signal?.throwIfAborted();
  for (const lang of ['chi_sim']) {
    try {
      await fs.access(path.join(langPath, `${lang}.traineddata`));
    } catch {
      throw Object.assign(
        new Error('本机 OCR 语言包缺失，请安装 chi_sim 语言包或配置 OCR_LANG_PATH'),
        { status: 503 },
      );
    }
  }
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { images, langPath },
      execArgv: [],
    });
    let doneReceived = false;
    let settled = false,
      writes = Promise.resolve();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason || new Error('OCR 已取消'));
    const timer = setTimeout(
      () =>
        finish(
          Object.assign(new Error('本章 OCR 识别超时，已完成页面已缓存，请重试'), { status: 502 }),
        ),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message) => {
      if (settled) return;
      if (message.error) {
        finish(Object.assign(new Error(`OCR 识别失败：${message.error}`), { status: 502 }));
        return;
      }
      if (message.page) {
        writes = writes.then(() => {
          signal?.throwIfAborted();
          return onPage(message);
        });
        writes.catch(finish);
      }
      if (message.done) {
        doneReceived = true;
        writes.then(() => finish(), finish);
      }
    });
    worker.once('error', finish);
    worker.once('exit', (code) => {
      if (!settled)
        writes.then(
          () => finish(!doneReceived ? new Error(`OCR 进程提前退出（${code}）`) : undefined),
          finish,
        );
    });
  });
}

if (!isMainThread) {
  let engine;
  try {
    const { createWorker } = await import('tesseract.js');
    engine = await createWorker('chi_sim', 1, {
      langPath: workerData.langPath,
      gzip: false,
      cacheMethod: 'none',
      errorHandler: () => {},
    });
    for (const image of workerData.images) {
      const { data } = await engine.recognize(image.filename);
      parentPort.postMessage({ page: image.page, text: data.text, confidence: data.confidence });
    }
    parentPort.postMessage({ done: true });
  } catch (error) {
    parentPort.postMessage({ error: error.message || String(error) });
  } finally {
    await engine?.terminate();
  }
}
