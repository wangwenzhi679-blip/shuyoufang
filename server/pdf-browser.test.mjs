import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { withPdfBrowser } from './pdf-browser.js';

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shuyoufang-qa-pdf-'));
const configuredPath = fileURLToPath(import.meta.url);
const fallbackPath = fileURLToPath(new URL('./pdf-browser.js', import.meta.url));
const attempts = [];
let closed = 0;
const browser = {
  close: async () => {
    closed++;
  },
};
const launcher = {
  executablePath: async () => fallbackPath,
  launch: async (options) => {
    attempts.push(options.executablePath);
    assert.ok(options.userDataDir.startsWith(profileRoot + path.sep));
    assert.ok(fs.existsSync(options.userDataDir));
    if (options.executablePath === configuredPath) throw new Error('启动失败');
    return browser;
  },
};
try {
  assert.equal(
    await withPdfBrowser(async () => 'PDF', { launcher, configuredPath, profileRoot }),
    'PDF',
  );
  assert.deepEqual(attempts, [configuredPath, fallbackPath]);
  assert.equal(closed, 1);
  assert.deepEqual(fs.readdirSync(profileRoot), []);
  attempts.length = 0;
  await assert.rejects(
    withPdfBrowser(
      async () => {
        throw new Error('文档渲染失败');
      },
      { launcher, configuredPath: fallbackPath, profileRoot },
    ),
    /文档渲染失败/,
  );
  assert.equal(attempts.length, 1); // 内容错误不能通过换浏览器掩盖。
  assert.equal(closed, 2);
  assert.deepEqual(fs.readdirSync(profileRoot), []);
  await assert.rejects(
    withPdfBrowser(async () => {}, {
      launcher: {
        ...launcher,
        launch: async () => {
          throw new Error('启动失败');
        },
      },
      configuredPath,
      profileRoot,
    }),
    (error) => error.status === 503 && error.message.includes('Markdown'),
  );
  assert.deepEqual(fs.readdirSync(profileRoot), []);
  console.log(
    'PASS PDF browser: startup fallback, render errors preserved, friendly unavailable response, profiles cleaned',
  );
} finally {
  fs.rmSync(profileRoot, { recursive: true, force: true });
}
