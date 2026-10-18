import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

async function cleanProfile(profile, remainingRetries = 3) {
  try {
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  } catch (error) {
    if (remainingRetries > 0 && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) {
      // Windows 的浏览器子进程可能晚于主进程释放文件，不影响已生成的 PDF。
      setTimeout(() => cleanProfile(profile, remainingRetries - 1), 10000).unref();
    } else {
      console.warn('PDF 临时目录清理失败，请检查导出服务文件权限');
    }
  }
}

// 每次导出使用独立的 E 盘配置目录，不借用用户正在使用的浏览器。
export async function withPdfBrowser(
  render,
  {
    launcher = puppeteer,
    configuredPath = process.env.PDF_RENDERER_EXECUTABLE,
    profileRoot = path.resolve('storage', 'pdf-browser'),
  } = {},
) {
  fs.mkdirSync(profileRoot, { recursive: true });
  let bundledPath;
  try {
    bundledPath = await launcher.executablePath();
  } catch {
    bundledPath = null;
  }
  const candidates = [
    ...new Set(
      [
        configuredPath,
        bundledPath,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ].filter((file) => typeof file === 'string' && fs.existsSync(file)),
    ),
  ];

  for (const executablePath of candidates) {
    const profile = fs.mkdtempSync(path.join(profileRoot, 'export-'));
    let browser;
    try {
      try {
        browser = await launcher.launch({
          executablePath,
          headless: true,
          userDataDir: profile,
          timeout: 15000,
          // Windows Edge 默认会通过兼容层重启自己，使自动化误判为进程已退出。
          args:
            path.basename(executablePath).toLowerCase() === 'msedge.exe'
              ? ['--edge-skip-compat-layer-relaunch']
              : [],
        });
      } catch {
        // 一个浏览器启动失败时继续尝试现有浏览器，不中断导出。
        continue;
      }
      return await render(browser);
    } finally {
      try {
        if (browser) await browser.close();
      } catch {
        console.warn('PDF 浏览器关闭异常');
      } finally {
        await cleanProfile(profile);
      }
    }
  }
  const error = new Error('PDF 导出服务暂时无法启动，请稍后重试；也可以先导出 Markdown');
  error.status = 503;
  throw error;
}

export async function renderOfficePdf(ast) {
  const html = await ast.to('html', {
    includeImages: 'image-only',
    maxInlineImageBytes: Infinity,
    htmlConfig: { standalone: true, sourceAttributes: false },
  });
  return withPdfBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const inline = /^(data:|blob:|about:)/.test(request.url());
      (inline ? request.continue() : request.abort()).catch(() => {});
    });
    await page.setContent(html.value, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return {
      value: await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    };
  });
}
