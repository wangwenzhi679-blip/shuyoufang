import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVideoProcessor } from './video-processing.js';

const server = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(server, '.env') });
const root = path.join(server, 'storage/mobile-videos');
const backupRoot = path.join(root, 'original-backups');
const processVideo = createVideoProcessor();
let db;
try {
  db = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });
  const [[lock]] = await db.execute("SELECT GET_LOCK('syf-video-optimization',0) acquired");
  if (!Number(lock.acquired)) throw new Error('已有视频优化任务正在运行，请稍后再试');
  const [videos] = await db.execute(
    'SELECT id,title,stored_name,size_bytes FROM mobile_videos WHERE is_public=TRUE ORDER BY created_at,id',
  );
  await mkdir(backupRoot, { recursive: true });
  for (const video of videos) {
    if (!/^[a-f0-9-]+\.video$/.test(video.stored_name)) throw new Error('视频存储名称无效');
    const source = path.join(root, video.stored_name),
      backup = path.join(backupRoot, video.stored_name);
    let result,
      replaced = false;
    try {
      console.log(`正在优化：${video.title}`);
      result = await processVideo(source);
      try {
        await copyFile(source, backup, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      // Back up the current rendition too, so a repeat run can roll back its own change.
      const rollback = source + '.rollback';
      await copyFile(source, rollback);
      await rename(result.video, source);
      replaced = true;
      await rename(result.poster, source + '.jpg');
      await db.execute(
        'UPDATE mobile_videos SET mime_type=?,size_bytes=? WHERE id=? AND stored_name=?',
        ['video/mp4', result.size, video.id, video.stored_name],
      );
      replaced = false;
      await unlink(rollback).catch(() => {});
      console.log(
        `已优化并生成第一帧封面：${video.title}（${(result.size / 1048576).toFixed(1)} MB）`,
      );
    } catch (error) {
      if (replaced) await rename(source + '.rollback', source).catch(() => {});
      throw error;
    } finally {
      await result?.cleanup();
    }
  }
  console.log(
    `处理完成：${videos.length} 个公共视频。原文件备份保留在 original-backups，视频链接和发布状态不变。`,
  );
} catch (error) {
  console.error(
    error.status
      ? error.message
      : `视频优化未完成（${error.code || error.name}），已处理的视频可继续播放，请检查 FFmpeg、磁盘空间与数据库。`,
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
