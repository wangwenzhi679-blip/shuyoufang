import fs from 'node:fs/promises';
import path from 'node:path';
import { runPdfTool } from './pdf-tools.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// 章节原页与分页阅读共用生成任务，不同入口不能同时写入同一缓存文件。
const pending = new Map();

async function completePng(filename) {
  let file;
  try {
    file = await fs.open(filename, 'r');
    const { size } = await file.stat();
    if (size < 32) return false;
    const header = Buffer.alloc(8),
      trailer = Buffer.alloc(12);
    await file.read(header, 0, 8, 0);
    await file.read(trailer, 0, 12, size - 12);
    return header.equals(PNG_SIGNATURE) && trailer.subarray(4, 8).toString('ascii') === 'IEND';
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  } finally {
    await file?.close();
  }
}

export function createPdfPageImages({ uploadRoot, previewRoot, render = runPdfTool, dpi = 130 }) {
  return async (material, page) => {
    if (
      !Number.isSafeInteger(Number(material.id)) ||
      Number(material.id) < 1 ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 2000 ||
      !material.stored_name ||
      path.basename(material.stored_name) !== material.stored_name
    )
      throw Object.assign(new Error('原页参数无效'), { status: 400 });
    const source = path.join(uploadRoot, material.stored_name);
    const image = path.join(previewRoot, `original-${Number(material.id)}-${page}.png`);
    if (pending.has(image)) return pending.get(image);
    const work = (async () => {
      // 缓存不是资料副本：源文件删除或不可读后，不能继续返回残留原页。
      await fs.access(source);
      if (await completePng(image)) return image;
      await fs.mkdir(previewRoot, { recursive: true });
      const directory = await fs.mkdtemp(path.join(previewRoot, 'original-temp-'));
      try {
        const prefix = path.join(directory, 'page');
        await render(
          'pdftoppm',
          [
            '-cropbox',
            '-f',
            String(page),
            '-l',
            String(page),
            '-singlefile',
            '-png',
            '-r',
            String(Number.isInteger(dpi) && dpi >= 72 && dpi <= 300 ? dpi : 130),
            source,
            prefix,
          ],
          { timeout: 30000 },
        );
        const rendered = `${prefix}.png`;
        if (!(await completePng(rendered))) throw new Error('原页图片生成不完整，请重试');
        await fs.access(source);
        // 完整图片才可发布；同页请求共享渲染，不能读到另一个请求写到一半的文件。
        await fs.rename(rendered, image);
        return image;
      } finally {
        if (path.dirname(path.resolve(directory)) === path.resolve(previewRoot))
          await fs.rm(directory, { recursive: true, force: true });
      }
    })();
    pending.set(image, work);
    try {
      return await work;
    } finally {
      if (pending.get(image) === work) pending.delete(image);
    }
  };
}
