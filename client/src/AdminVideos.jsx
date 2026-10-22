import React, { useEffect, useRef, useState } from 'react';
import { requestJson, requestUpload } from './api-client.mjs';
import './admin-videos.css';

export default function AdminVideos({ token, data, onChanged }) {
  const [file, setFile] = useState(null),
    [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const transfer = useRef(null),
    picker = useRef(null);
  useEffect(() => () => transfer.current?.abort(), []);
  const upload = async (event) => {
    event.preventDefault();
    if (!file || busy) return;
    if (!/\.(mp4|webm|mkv)$/i.test(file.name) || file.size >= 500 * 1024 * 1024) {
      setError('请选择小于 500 MB 的 MP4、WebM 或 MKV 视频');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setProgress(0);
    const body = new FormData();
    body.append('title', title.trim());
    body.append('video', file);
    transfer.current = new AbortController();
    try {
      await requestUpload('admin/videos', {
        token,
        body,
        signal: transfer.current.signal,
        onProgress: setProgress,
      });
      setFile(null);
      setTitle('');
      if (picker.current) picker.current.value = '';
      setNotice('视频已发布，所有登录用户均可在 App 的研习影集查看。');
      onChanged();
    } catch (error) {
      setError(error.name === 'AbortError' ? '已取消上传' : error.message);
    } finally {
      setBusy(false);
      transfer.current = null;
    }
  };
  const publish = async (video) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await requestJson(`admin/videos/${video.id}`, {
        token,
        method: 'PATCH',
        body: { isPublic: !video.is_public },
      });
      setNotice(
        video.is_public
          ? '视频已下架，用户无法继续取得播放授权；文件保留，可重新发布。'
          : '视频已发布。',
      );
      onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-video-panel">
      <form onSubmit={upload}>
        <h2>发布学习视频</h2>
        <p>
          发布后所有登录用户可见。支持 MP4、WebM、MKV，单个小于 500
          MB。自动优化播放并取开头第一帧作封面。
        </p>
        <label>
          选择视频
          <input
            ref={picker}
            type="file"
            accept="video/mp4,video/webm,video/x-matroska,.mkv"
            disabled={busy}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              setFile(chosen || null);
              setTitle(chosen ? chosen.name.replace(/\.[^.]+$/, '').slice(0, 120) : '');
              setError('');
              setNotice('');
            }}
          />
        </label>
        <label>
          视频标题
          <input
            value={title}
            maxLength={120}
            required
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="admin-video-actions">
          <button disabled={!file || !title.trim() || busy}>
            {busy ? '正在处理…' : '上传并发布'}
          </button>
          {transfer.current && (
            <button type="button" onClick={() => transfer.current?.abort()}>
              取消上传
            </button>
          )}
        </div>
        {busy && progress !== null && (
          <div role="status">
            <progress max="100" value={progress ?? 0} />{' '}
            {progress === 99 ? '正在优化播放并生成开头封面，请稍等…' : `${progress ?? 0}%`}
          </div>
        )}
      </form>
      {error && (
        <p role="alert" className="admin-video-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="admin-video-notice">
          {notice}
        </p>
      )}
      <h2>公共视频库</h2>
      <p>下架会停止公开播放并保留原文件，方便再次发布。</p>
      <div className="admin-video-list">
        {(data?.items || []).map((video) => (
          <article key={video.id}>
            <div>
              <h3>{video.title}</h3>
              <small>
                {video.is_public ? '已发布 · 所有登录用户可见' : '未发布'} ·{' '}
                {(video.size_bytes / 1024 / 1024).toFixed(1)} MB
              </small>
            </div>
            <button disabled={busy} onClick={() => publish(video)}>
              {video.is_public ? '下架' : '发布'}
            </button>
          </article>
        ))}
      </div>
      {data && !data.items?.length && <p>还没有公共视频，先选择文件并填写标题。</p>}
    </section>
  );
}
