import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { statfs, unlink, open, rename } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { createVideoProcessor } from './video-processing.js';

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024 - 1;
const USER_QUOTA = 5 * 1024 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function videoSignature(bytes) {
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
    return 'video/webm';
  throw fail('请选择有效的 MP4、WebM 或 MKV 视频');
}
export async function ensureMobileVideos(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS mobile_videos (
    id CHAR(36) PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,title VARCHAR(120) NOT NULL,
    stored_name VARCHAR(80) NOT NULL UNIQUE,mime_type VARCHAR(40) NOT NULL,size_bytes BIGINT UNSIGNED NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,INDEX mobile_video_owner(user_id,created_at)
  )`);
  const [columns] = await db.query("SHOW COLUMNS FROM mobile_videos LIKE 'is_public'");
  if (!columns.length)
    await db.query('ALTER TABLE mobile_videos ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE');
}
export function registerMobileVideos(
  app,
  {
    db,
    auth,
    asyncRoute,
    secret,
    root = path.resolve('storage/mobile-videos'),
    processVideo = createVideoProcessor(),
  },
) {
  fs.mkdirSync(root, { recursive: true });
  const owners = new Set();
  const upload = multer({
    storage: multer.diskStorage({
      destination: root,
      filename: (req, file, done) => done(null, randomUUID() + '.video'),
    }),
    limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 1, fieldSize: 1000 },
  }).single('video');
  app.get(
    '/api/mobile/videos',
    auth,
    asyncRoute(async (req, res) => {
      const [items] = await db.execute(
        'SELECT id,title,mime_type,size_bytes,created_at,is_public,(user_id=? AND is_public=FALSE) AS can_delete FROM mobile_videos WHERE user_id=? OR is_public=TRUE ORDER BY is_public DESC,created_at DESC,id DESC LIMIT 400',
        [req.user.sub, req.user.sub],
      );
      res.json({ items, maxFileBytes: MAX_VIDEO_BYTES, quotaBytes: USER_QUOTA });
    }),
  );
  const receiveVideo = (req, res, next) => {
    const owner = String(req.user.sub);
    if (owners.has(owner) || owners.size >= 2)
      return res.status(429).json({ message: '当前有视频正在上传，请稍后重试' });
    owners.add(owner);
    let finished = false;
    const release = () => {
      if (!finished) {
        finished = true;
        owners.delete(owner);
      }
    };
    res.once('finish', release);
    res.once('close', release);
    upload(req, res, (error) => {
      if (error) {
        release();
        if (error.code === 'LIMIT_FILE_SIZE')
          return res.status(400).json({ message: '单个视频必须小于 500 MB' });
        next(error);
      } else next();
    });
  };
  const saveVideo = asyncRoute(async (req, res) => {
    if (!req.file) throw fail('请选择视频文件');
    let saved = false,
      processed;
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', disconnected);
    try {
      const file = await open(req.file.path, 'r');
      let mime;
      try {
        const bytes = Buffer.alloc(16);
        const read = await file.read(bytes, 0, bytes.length, 0);
        mime = videoSignature(bytes.subarray(0, read.bytesRead));
      } finally {
        await file.close();
      }
      const disk = await statfs(root);
      if (Number(disk.bavail) * Number(disk.bsize) < req.file.size + 512 * 1024 * 1024)
        throw fail('服务器可用空间不足，请稍后上传', 507);
      processed = await processVideo(req.file.path, { signal: controller.signal });
      await rename(processed.video, req.file.path);
      await rename(processed.poster, req.file.path + '.jpg');
      mime = processed.mime;
      req.file.size = processed.size;
      const title = String(req.body.title || req.file.originalname)
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, 120);
      if (!title) throw fail('请填写视频标题');
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.sub]);
        const [[usage]] = await connection.execute(
          'SELECT COALESCE(SUM(size_bytes),0) bytes,COUNT(*) count FROM mobile_videos WHERE user_id=?',
          [req.user.sub],
        );
        if (Number(usage.bytes) + req.file.size > USER_QUOTA || usage.count >= 200)
          throw fail('视频空间已满：每个账号最多 5 GB、200 个视频，请先删除不需要的视频');
        const id = randomUUID();
        await connection.execute(
          'INSERT INTO mobile_videos(id,user_id,title,stored_name,mime_type,size_bytes,is_public) VALUES(?,?,?,?,?,?,?)',
          [
            id,
            req.user.sub,
            title,
            req.file.filename,
            mime,
            req.file.size,
            req.publishVideo === true,
          ],
        );
        if (req.publishVideo)
          await connection.execute(
            "INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,'admin','video_publish',?,'success',?)",
            [req.user.sub, req.user.account || '管理员', id, title],
          );
        controller.signal.throwIfAborted();
        await connection.commit();
        saved = true;
        res.status(201).json({ id, title, size_bytes: req.file.size, mime_type: mime });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } finally {
      res.removeListener('close', disconnected);
      if (!saved) {
        await unlink(req.file.path).catch(() => {});
        await unlink(req.file.path + '.jpg').catch(() => {});
      }
      await processed?.cleanup();
    }
  });
  const admin = (req, res, next) =>
    req.user.role === 'admin'
      ? next()
      : res.status(403).json({ message: '仅管理员可以发布公共视频' });
  app.post('/api/mobile/videos', auth, receiveVideo, saveVideo);
  app.post(
    '/api/admin/videos',
    auth,
    admin,
    (req, _res, next) => {
      req.publishVideo = true;
      next();
    },
    receiveVideo,
    saveVideo,
  );
  app.get(
    '/api/admin/videos',
    auth,
    admin,
    asyncRoute(async (req, res) => {
      const [items] = await db.execute(
        'SELECT id,title,mime_type,size_bytes,created_at,is_public FROM mobile_videos WHERE is_public=TRUE OR user_id=? ORDER BY created_at DESC,id DESC LIMIT 400',
        [req.user.sub],
      );
      res.json({ items });
    }),
  );
  app.patch(
    '/api/admin/videos/:id',
    auth,
    admin,
    asyncRoute(async (req, res) => {
      if (typeof req.body.isPublic !== 'boolean') throw fail('请选择发布或下架');
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [[video]] = await connection.execute(
          'SELECT id,title FROM mobile_videos WHERE id=? AND (user_id=? OR is_public=TRUE) FOR UPDATE',
          [req.params.id, req.user.sub],
        );
        if (!video) throw fail('视频不存在或无权管理', 404);
        await connection.execute('UPDATE mobile_videos SET is_public=? WHERE id=?', [
          req.body.isPublic,
          video.id,
        ]);
        await connection.execute(
          "INSERT INTO admin_action_logs(actor_id,actor_account,actor_role,action,target_id,result,detail) VALUES(?,?,'admin',? ,?,'success',?)",
          [
            req.user.sub,
            req.user.account || '管理员',
            req.body.isPublic ? 'video_publish' : 'video_withdraw',
            video.id,
            video.title,
          ],
        );
        await connection.commit();
        res.json({ id: video.id, is_public: req.body.isPublic });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }),
  );
  app.post(
    '/api/mobile/videos/:id/play',
    auth,
    asyncRoute(async (req, res) => {
      const [[video]] = await db.execute(
        'SELECT id FROM mobile_videos WHERE id=? AND (user_id=? OR is_public=TRUE)',
        [req.params.id, req.user.sub],
      );
      if (!video) throw fail('视频不存在或无权访问', 404);
      const [[user]] = await db.execute('SELECT status_version FROM users WHERE id=?', [
        req.user.sub,
      ]);
      const ticket = jwt.sign(
        { sub: String(req.user.sub), video: video.id, version: user.status_version },
        secret,
        { algorithm: 'HS256', audience: 'mobile-video', expiresIn: '1h' },
      );
      res.json({
        url: `/api/mobile/videos/${video.id}/content?ticket=${encodeURIComponent(ticket)}`,
        poster: `/api/mobile/videos/${video.id}/content?poster=1&ticket=${encodeURIComponent(ticket)}`,
      });
    }),
  );
  app.get(
    '/api/mobile/videos/:id/content',
    asyncRoute(async (req, res) => {
      let claims;
      try {
        claims = jwt.verify(String(req.query.ticket || ''), secret, {
          algorithms: ['HS256'],
          audience: 'mobile-video',
        });
      } catch {
        throw fail('播放授权已过期，请重新打开视频', 401);
      }
      if (claims.video !== req.params.id) throw fail('无权播放此视频', 403);
      const [[video]] = await db.execute(
        "SELECT v.stored_name,v.mime_type,u.status_version FROM mobile_videos v JOIN users u ON u.id=? WHERE v.id=? AND (v.user_id=? OR v.is_public=TRUE) AND u.status='active'",
        [claims.sub, claims.video, claims.sub],
      );
      if (!video || Number(video.status_version) !== Number(claims.version))
        throw fail('视频不存在或登录状态已变化', 403);
      if (!/^[a-f0-9-]+\.video$/.test(video.stored_name)) throw fail('视频存储状态异常', 500);
      res.set({
        'Content-Type': req.query.poster === '1' ? 'image/jpeg' : video.mime_type,
        'Cache-Control': 'private, no-cache',
        'X-Accel-Buffering': 'no',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      // sendFile supports byte-range requests for seeking without buffering the whole video.
      await new Promise((resolve, reject) =>
        res.sendFile(
          path.join(root, video.stored_name) + (req.query.poster === '1' ? '.jpg' : ''),
          (error) =>
            error
              ? reject(
                  error.code === 'ENOENT'
                    ? fail(
                        req.query.poster === '1'
                          ? '视频封面尚未生成，请先优化该视频'
                          : '视频文件不存在',
                        404,
                      )
                    : error,
                )
              : resolve(),
        ),
      );
    }),
  );
  app.delete(
    '/api/mobile/videos/:id',
    auth,
    asyncRoute(async (req, res) => {
      const [[video]] = await db.execute(
        'SELECT stored_name FROM mobile_videos WHERE id=? AND user_id=? AND is_public=FALSE',
        [req.params.id, req.user.sub],
      );
      if (!video) throw fail('视频不存在或无权访问', 404);
      const [deleted] = await db.execute(
        'DELETE FROM mobile_videos WHERE id=? AND user_id=? AND is_public=FALSE',
        [req.params.id, req.user.sub],
      );
      if (deleted.affectedRows && /^[a-f0-9-]+\.video$/.test(video.stored_name))
        for (const suffix of ['', '.jpg'])
          await unlink(path.join(root, video.stored_name) + suffix).catch(() => {});
      res.json({ success: true });
    }),
  );
}
