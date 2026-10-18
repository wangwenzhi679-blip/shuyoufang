import { requestJson, requestBlob } from './api-client.mjs';
import { API_ROOT } from './api-base.mjs';
import React, { useEffect, useState } from 'react';
import './course-cover.css';

export const coverApi = API_ROOT;
export function coverRequest(token, courseId, suffix = '', options = {}, signal) {
  const request = options.blob ? requestBlob : requestJson;
  return request(`courses/${courseId}/cover${suffix}`, {
    token,
    method: options.method || 'GET',
    body: options.body,
    signal,
    errorMessage: '封面操作未完成，请重试',
  });
}

export function notifyCover(courseId) {
  window.dispatchEvent(new CustomEvent('course-cover-changed', { detail: { courseId } }));
}
function useCover(token, courseId, disabled) {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(null);
    if (!token || !courseId || disabled) return;
    const controller = new AbortController();
    let loading = false,
      refreshQueued = false;
    async function load() {
      if (loading) {
        refreshQueued = true;
        return;
      }
      loading = true;
      try {
        const result = await coverRequest(token, courseId, '', {}, controller.signal);
        if (!controller.signal.aborted) setState(result);
      } catch {
        // 请求失败时沿用现有封面或自动排版。
      } finally {
        loading = false;
        if (refreshQueued && !controller.signal.aborted) {
          refreshQueued = false;
          load();
        }
      }
    }
    const refresh = () => {
      if (!document.hidden) load();
    };
    const changed = (e) => {
      if (Number(e.detail?.courseId) === Number(courseId)) load();
    };
    load();
    window.addEventListener('course-cover-changed', changed);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('course-cover-changed', changed);
      window.removeEventListener('focus', refresh);
    };
  }, [token, courseId, disabled]);
  return state;
}
function Motif({ title }) {
  const math = /数学|代数|几何|微积|概率|统计|向量|矩阵/.test(title),
    science = /物理|化学|生物|医学|科学|结构/.test(title),
    technology = /计算|程序|算法|软件|人工智能|网络/.test(title);
  return (
    <svg className="sf-book-motif" viewBox="0 0 100 68" fill="none" aria-hidden="true">
      {math ? (
        <>
          <path d="M13 54 47 13 87 54ZM47 13v41M13 54l54-25M28 61h60" />
          <ellipse cx="49" cy="41" rx="27" ry="18" />
          <circle cx="47" cy="40" r="2" />
        </>
      ) : science ? (
        <>
          <ellipse cx="50" cy="34" rx="36" ry="13" />
          <ellipse cx="50" cy="34" rx="36" ry="13" transform="rotate(60 50 34)" />
          <ellipse cx="50" cy="34" rx="36" ry="13" transform="rotate(120 50 34)" />
          <circle cx="50" cy="34" r="5" />
          <circle cx="20" cy="27" r="2" />
        </>
      ) : technology ? (
        <>
          <rect x="31" y="15" width="38" height="38" rx="3" />
          <path d="M41 25h18v18H41ZM38 6v9m12-9v9m12-9v9M38 53v9m12-9v9m12-9v9M22 22h9m-9 12h9m-9 12h9m38-24h9m-9 12h9m-9 12h9" />
        </>
      ) : (
        <>
          <path d="M50 18C36 9 21 10 11 15v42c14-6 27-5 39 2 12-7 25-8 39-2V15c-10-5-25-6-39 3ZM50 18v41M20 24c8-2 15 0 22 3M20 34c8-2 15 0 22 3M58 27c7-3 14-5 22-3M58 37c7-3 14-5 22-3" />
          <path d="M69 8c2-5 6-7 12-6-2 6-5 8-12 6Z" />
        </>
      )}
    </svg>
  );
}
export default function CourseCover({
  token,
  courseId,
  title = '研习手卷',
  metadata,
  className = '',
  imageUrl,
}) {
  const fetched = useCover(token, courseId, Boolean(metadata) || Boolean(imageUrl)),
    state = metadata || fetched;
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl('');
    if (imageUrl || !state?.has_image || !state.revision) return;
    let live = true,
      objectUrl;
    const controller = new AbortController();
    coverRequest(
      token,
      courseId,
      `/file?v=${encodeURIComponent(state.revision)}`,
      { blob: true },
      controller.signal,
    )
      .then((blob) => {
        if (live) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, courseId, state?.revision, state?.has_image, imageUrl]);
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const image = imageUrl || url;
  return (
    <span
      className={`sf-course-cover ${image ? 'sf-cover-image' : ''} sf-cover-tone-${hash % 4} ${className}`}
      aria-hidden="true"
    >
      {image ? (
        <img className="sf-cover-art" src={image} alt="" onError={() => setUrl('')} />
      ) : (
        <>
          <span className="sf-book-top">研 习 手 卷</span>
          <span className="sf-book-title">{title}</span>
          <Motif title={title} />
          <span className="sf-book-brand">数有方 · 研习空间</span>
        </>
      )}
    </span>
  );
}
