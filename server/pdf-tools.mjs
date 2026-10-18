import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const supportedTools = new Set(['pdfinfo', 'pdftoppm']);

export function resolvePdfTool(tool, options = {}) {
  if (!supportedTools.has(tool)) throw new Error('不支持的 PDF 工具');

  const {
    env = process.env,
    platform = process.platform,
    home = homedir(),
    exists = existsSync,
  } = options;
  const configuredPath = env[`${tool.toUpperCase()}_PATH`]?.trim();
  if (configuredPath) return configuredPath;

  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const executable = windows ? `${tool}.exe` : tool;
  const searchPath = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1] || '';
  const directories = [env.POPPLER_BIN, ...searchPath.split(windows ? ';' : ':')];

  // Background tasks may not inherit the desktop host's bundled tools in PATH.
  if (windows) {
    directories.push(
      paths.join(
        home,
        '.cache',
        'codex-runtimes',
        'codex-primary-runtime',
        'dependencies',
        'native',
        'poppler',
        'Library',
        'bin',
      ),
    );
  }
  for (const directory of directories) {
    if (!directory?.trim()) continue;
    const candidate = paths.join(directory.trim().replace(/^"|"$/g, ''), executable);
    if (exists(candidate)) return candidate;
  }
  return tool;
}

export async function runPdfTool(tool, args, options) {
  try {
    return await executeFile(resolvePdfTool(tool), args, options);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw Object.assign(
      new Error('PDF 阅读工具不可用，请安装 Poppler 或配置 POPPLER_BIN 后重启后端'),
      {
        status: 503,
      },
    );
  }
}
