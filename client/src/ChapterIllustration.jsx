import { requestJson, requestBlob } from './api-client.mjs';
import React, { useEffect, useState } from 'react';
const illustrationPath = (courseId, chapterId) =>
  `courses/${courseId}/chapters/${chapterId}/illustration`;

export function startChapterIllustration(token, courseId, chapterId, signal) {
  return requestJson(illustrationPath(courseId, chapterId), {
    token,
    method: 'POST',
    signal,
    errorMessage: '配图暂不可用',
  });
}

export default function ChapterIllustration({ token, courseId, chapterId }) {
  const [image, setImage] = useState(''),
    [status, setStatus] = useState('loading');
  useEffect(() => {
    if (!courseId || !chapterId) return;
    const controller = new AbortController();
    let pollTimer,
      imageUrl,
      pollCount = 0,
      isChecking = false,
      imageRevision,
      refreshQueued = false;
    setImage('');
    setStatus('loading');
    async function loadImage(revision) {
      if (imageUrl && revision === imageRevision) return;
      const blob = await requestBlob(
        illustrationPath(courseId, chapterId) + `?v=${revision || ''}`,
        { token, signal: controller.signal, errorMessage: '图片未就绪' },
      );
      if (controller.signal.aborted) return;

      const previousImage = imageUrl;
      imageUrl = URL.createObjectURL(blob);
      imageRevision = revision;
      setImage(imageUrl);
      if (previousImage) URL.revokeObjectURL(previousImage);
    }

    function schedulePoll(state) {
      const attemptsExhausted = state.status === 'failed' && state.attempts >= 3;
      const retryable =
        ['queued', 'running', 'failed'].includes(state.status) && !attemptsExhausted;
      if (retryable && pollCount++ < 60) {
        pollTimer = setTimeout(check, state.status === 'failed' ? 30000 : 8000);
      } else if (['queued', 'running'].includes(state.status)) {
        setStatus('delayed');
      }
    }

    async function check() {
      if (isChecking || controller.signal.aborted) return;
      isChecking = true;
      try {
        const state = await startChapterIllustration(token, courseId, chapterId, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(state.status);
        if (state.status === 'done') await loadImage(state.revision);
        else schedulePoll(state);
      } catch {
        if (!controller.signal.aborted) setStatus('failed');
      } finally {
        isChecking = false;
        if (refreshQueued && !controller.signal.aborted) {
          refreshQueued = false;
          clearTimeout(pollTimer);
          pollTimer = setTimeout(check, 0);
        }
      }
    }
    const refresh = () => {
      if (!document.hidden) {
        clearTimeout(pollTimer);
        if (isChecking) refreshQueued = true;
        else check();
      }
    };
    const changed = (e) => {
      if (Number(e.detail?.chapterId) === Number(chapterId)) refresh();
    };
    window.addEventListener('chapter-illustration-changed', changed);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    check();
    return () => {
      controller.abort();
      clearTimeout(pollTimer);
      window.removeEventListener('chapter-illustration-changed', changed);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [token, courseId, chapterId]);
  const pending = ['loading', 'running', 'queued'].includes(status);
  return (
    <span
      className={`reference-thumb chapter-illustration ${image ? 'has-image' : pending ? 'is-pending' : ''}`}
      aria-hidden="true"
      title={
        image
          ? '章节内容配图'
          : pending
            ? '正在生成章节配图'
            : status === 'unconfigured'
              ? '章节配图服务待配置'
              : '章节配图暂未生成'
      }
    >
      {image ? (
        <img
          src={image}
          alt=""
          onError={() => {
            setImage('');
            setStatus('failed');
          }}
        />
      ) : (
        <>
          <svg viewBox="0 0 48 40" fill="none">
            <path
              d="M24 9C17 4 9 4 3 7v27c8-3 15-2 21 2 6-4 13-5 21-2V7c-6-3-14-3-21 2Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path d="M24 9v27M9 14l9 2M9 21l9 2M30 16l9-2M30 23l9-2" stroke="currentColor" />
          </svg>
          {!image && <small>{pending ? '绘制中' : '暂无配图'}</small>}
        </>
      )}
    </span>
  );
}
