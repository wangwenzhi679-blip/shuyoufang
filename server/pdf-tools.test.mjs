import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePdfTool } from './pdf-tools.mjs';

test('PDF 工具优先使用明确配置的路径，支持含空格的目录', () => {
  assert.equal(
    resolvePdfTool('pdfinfo', {
      env: { PDFINFO_PATH: 'C:\\PDF Tools\\pdfinfo.exe', POPPLER_BIN: 'D:\\poppler' },
      platform: 'win32',
      exists: () => false,
    }),
    'C:\\PDF Tools\\pdfinfo.exe',
  );
});

test('Windows 后台服务可从配置目录或桌面运行时定位 Poppler', () => {
  const available = new Set(['D:\\PDF Tools\\pdftoppm.exe']);
  assert.equal(
    resolvePdfTool('pdftoppm', {
      env: { POPPLER_BIN: 'D:\\PDF Tools', Path: 'C:\\Windows' },
      platform: 'win32',
      exists: (filename) => available.has(filename),
    }),
    'D:\\PDF Tools\\pdftoppm.exe',
  );
  const bundled =
    'C:\\Users\\fixture\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdfinfo.exe';
  assert.equal(
    resolvePdfTool('pdfinfo', {
      env: {},
      platform: 'win32',
      home: 'C:\\Users\\fixture',
      exists: (filename) => filename === bundled,
    }),
    bundled,
  );
});

test('系统 PATH 查找跨平台工作，没有可用工具时交由系统处理', () => {
  assert.equal(
    resolvePdfTool('pdfinfo', {
      env: { PATH: '/usr/local/bin:/usr/bin' },
      platform: 'linux',
      exists: (filename) => filename === '/usr/bin/pdfinfo',
    }),
    '/usr/bin/pdfinfo',
  );
  assert.equal(
    resolvePdfTool('pdftoppm', { env: {}, platform: 'linux', exists: () => false }),
    'pdftoppm',
  );
  assert.throws(() => resolvePdfTool('shell'), /不支持/);
});
