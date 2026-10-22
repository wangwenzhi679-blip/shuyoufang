import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
let active = false;

export function videoEncoding(streams) {
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (
    !video ||
    !Number.isFinite(video.width) ||
    !Number.isFinite(video.height) ||
    video.width < 1 ||
    video.height < 1
  )
    throw fail('文件中没有可播放的视频画面');
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    video,
    audio,
    copyVideo:
      video.codec_name === 'h264' &&
      video.pix_fmt === 'yuv420p' &&
      video.width <= 1920 &&
      video.height <= 1080,
    copyAudio: !audio || audio.codec_name === 'aac',
  };
}

// Bounded CPU usage, no shell interpolation or external URL protocols. One job per server.
export function createVideoProcessor({
  run = execute,
  ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe = process.env.FFPROBE_PATH || 'ffprobe',
} = {}) {
  return async (source, { signal } = {}) => {
    signal?.throwIfAborted();
    if (active) throw fail('另一个视频正在优化，请稍后再上传', 429);
    active = true;
    let directory;
    try {
      directory = await mkdtemp(path.join(path.dirname(source), 'video-processing-'));
      const options = { signal, windowsHide: true, timeout: 900000, maxBuffer: 1024 * 1024 };
      const { stdout } = await run(
        ffprobe,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          source,
        ],
        { ...options, timeout: 30000 },
      );
      const metadata = JSON.parse(stdout);
      if (!/(?:^|,)(?:mov|mp4|matroska|webm)(?:,|$)/.test(metadata.format?.format_name || ''))
        throw fail('请选择真实有效的 MP4、WebM 或 MKV 视频');
      const encoding = videoEncoding(metadata.streams || []);
      const video = path.join(directory, 'stream.mp4'),
        poster = path.join(directory, 'first-frame.jpg');
      await run(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          source,
          '-map',
          `0:${encoding.video.index}`,
          ...(encoding.audio ? ['-map', `0:${encoding.audio.index}`] : []),
          '-map_metadata',
          '-1',
          '-sn',
          '-dn',
          ...(encoding.copyVideo
            ? ['-c:v', 'copy']
            : [
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '23',
                '-pix_fmt',
                'yuv420p',
                '-threads',
                '2',
                '-filter_threads',
                '1',
                '-vf',
                "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                '-maxrate',
                '2500k',
                '-bufsize',
                '5000k',
              ]),
          ...(encoding.copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']),
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          '-y',
          video,
        ],
        options,
      );
      signal?.throwIfAborted();
      const size = (await stat(video)).size;
      if (!size || size >= 500 * 1024 * 1024)
        throw fail('处理后的视频超过 500 MB，请缩短视频或降低原视频码率后重试');
      // No seek/thumbnail heuristic: exactly the first decoded frame, as requested.
      await run(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          video,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-threads',
          '1',
          '-vf',
          "scale=w='min(640,iw)':h='min(360,ih)':force_original_aspect_ratio=decrease",
          '-q:v',
          '3',
          '-y',
          poster,
        ],
        { ...options, timeout: 60000 },
      );
      if (!(await stat(poster)).size) throw fail('视频第一帧封面未生成，请重试');
      return {
        video,
        poster,
        size,
        mime: 'video/mp4',
        cleanup: () => rm(directory, { recursive: true, force: true }),
      };
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      signal?.throwIfAborted();
      if (error.status) throw error;
      if (error.code === 'ENOENT') throw fail('视频处理组件尚未安装，请联系管理员安装 FFmpeg', 503);
      if (error.killed || error.signal) throw fail('视频转换超时，请缩短视频或降低分辨率后重试');
      throw fail('视频无法解码或转换，请确认文件完整；支持上传 MP4、WebM 和 MKV');
    } finally {
      active = false;
    }
  };
}
