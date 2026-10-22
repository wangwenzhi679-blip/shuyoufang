import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createVideoProcessor } from './video-processing.js';

const metadata = (codec = 'h264') => ({
  format: { format_name: 'matroska,webm' },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: codec,
      pix_fmt: 'yuv420p',
      width: 320,
      height: 180,
    },
    { index: 1, codec_type: 'audio', codec_name: 'aac' },
  ],
});
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-processing-test-'));
  const source = path.join(directory, 'input.video');
  await writeFile(source, 'original');
  try {
    await run(source, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('兼容编码仅无损换封装，索引前置，封面取第一帧不跳过开头', async () => {
  await fixture(async (source) => {
    const calls = [];
    const processVideo = createVideoProcessor({
      run: async (file, args, options) => {
        calls.push([file, args, options]);
        if (file === 'ffprobe') return { stdout: JSON.stringify(metadata()) };
        await writeFile(args.at(-1), 'output');
        return { stdout: '' };
      },
    });
    const result = await processVideo(source);
    assert.deepEqual(await readFile(source, 'utf8'), 'original');
    assert(calls[1][1].includes('+faststart'));
    assert(!calls[1][1].includes('libx264'));
    assert(calls[2][1].includes('-frames:v'));
    assert.equal(calls[2][1][calls[2][1].indexOf('-frames:v') + 1], '1');
    assert(!calls[2][1].includes('-ss'));
    assert.equal(result.mime, 'video/mp4');
    await result.cleanup();
  });
});

test('不兼容编码转成H264并限制线程，失败与取消清理临时产物', async () => {
  await fixture(async (source, directory) => {
    const calls = [];
    const processor = createVideoProcessor({
      run: async (file, args) => {
        if (file === 'ffprobe') return { stdout: JSON.stringify(metadata('hevc')) };
        calls.push(args);
        await writeFile(args.at(-1), 'output');
        return { stdout: '' };
      },
    });
    const result = await processor(source);
    assert(calls[0].includes('libx264'));
    assert(calls[0].includes('yuv420p'));
    assert.equal(calls[0][calls[0].indexOf('-threads') + 1], '2');
    await result.cleanup();
    const broken = createVideoProcessor({
      run: async () => {
        throw Object.assign(Error('missing'), { code: 'ENOENT' });
      },
    });
    await assert.rejects(broken(source), /安装 FFmpeg/);
    assert.deepEqual(await readdir(directory), ['input.video']);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(processor(source, { signal: controller.signal }), { name: 'AbortError' });
  });
});

test(
  '真实MKV转换与开头封面，验证MP4索引位于媒体数据之前',
  { skip: !process.env.FFMPEG_TEST_PATH },
  async () => {
    const execute = promisify(execFile),
      ffmpeg = process.env.FFMPEG_TEST_PATH;
    await fixture(async (source) => {
      await execute(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=320x180:rate=24',
          '-t',
          '1',
          '-an',
          '-c:v',
          'mpeg4',
          '-f',
          'matroska',
          '-y',
          source,
        ],
        { windowsHide: true },
      );
      const processor = createVideoProcessor({
        ffmpeg,
        run: async (file, args, options) =>
          file === 'ffprobe'
            ? {
                stdout: JSON.stringify({
                  ...metadata('mpeg4'),
                  streams: [metadata('mpeg4').streams[0]],
                }),
              }
            : execute(file, args, options),
      });
      const result = await processor(source),
        bytes = await readFile(result.video),
        poster = await readFile(result.poster);
      const boxes = [];
      for (let p = 0; p + 8 <= bytes.length; ) {
        const length = bytes.readUInt32BE(p);
        if (length < 8) break;
        boxes.push(bytes.toString('ascii', p + 4, p + 8));
        p += length;
      }
      assert(boxes.indexOf('moov') < boxes.indexOf('mdat'));
      assert.equal(poster[0], 255);
      assert.equal(poster[1], 216);
      await result.cleanup();
    });
  },
);
