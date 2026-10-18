import { API_ROOT } from './api-base.mjs';
import ImageDialogHeader from './ImageDialogHeader.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChapterImageEditor from './ChapterImageEditor.jsx';

function Thumbnail({ token, item }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true,
      objectUrl;
    const controller = new AbortController();
    setUrl('');
    if (item.has_image && item.image_status === 'done')
      fetch(
        `${API_ROOT}/courses/${item.course_id}/chapters/${item.id}/illustration?v=${item.revision}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
      )
        .then((response) => {
          if (!response.ok) throw new Error();
          return response.blob();
        })
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
  }, [token, item.id, item.revision, item.has_image, item.image_status]);
  return (
    <div className="image-library-thumb">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <svg viewBox="0 0 40 32" fill="none" aria-hidden="true">
          <path
            d="M20 8C14 4 8 4 3 6v22c6-3 12-2 17 1 5-3 11-4 17-1V6c-5-2-11-2-17 2Z"
            stroke="currentColor"
          />
          <path d="M20 8v21M8 12l7 2M25 14l7-2M8 19l7 2M25 21l7-2" stroke="currentColor" />
        </svg>
      )}
    </div>
  );
}
export default function ChapterImageLibrary({ token, onClose, onCourses }) {
  const [data, setData] = useState({ items: [], total: 0 }),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState('');
  const dialog = useRef(null),
    returnFocus = useRef(document.activeElement);
  useEffect(() => {
    if (!selected) dialog.current?.focus();
  }, [selected]);
  useEffect(() => () => returnFocus.current?.focus?.(), []);
  useEffect(() => {
    if (selected) return;
    let live = true,
      timer;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function load() {
      try {
        const response = await fetch(
          `${API_ROOT}/chapter-illustrations?page=${page}&q=${encodeURIComponent(search)}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '加载配图失败');
        if (!live) return;
        setData(result);
        setLoading(false);
        if (
          result.items.some(
            (item) =>
              ['queued', 'running'].includes(item.draft_status) ||
              ['queued', 'running'].includes(item.image_status),
          )
        )
          timer = setTimeout(load, 4000);
      } catch (e) {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, page, search, revision, selected]);
  function keyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key === 'Tab') {
      const elements = Array.from(dialog.current.querySelectorAll('button,input')).filter(
        (el) => !el.disabled,
      );
      const first = elements[0],
        last = elements.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  if (selected)
    return (
      <ChapterImageEditor
        token={token}
        courseId={selected.course_id}
        chapterId={selected.id}
        onClose={(message) => {
          setSelected(null);
          setNotice(message || '');
          setRevision((n) => n + 1);
        }}
      />
    );
  return createPortal(
    <div className="image-editor-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="student-paper-frame image-editor-dialog image-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="学习配图"
        onKeyDown={keyDown}
      >
        <ImageDialogHeader
          title="配图管理"
          subtitle="给每一章，选一幅合适的画。"
          onBack={onClose}
        />
        {onCourses && (
          <nav className="cover-manager-tabs" aria-label="配图分类">
            <button type="button" aria-pressed={false} onClick={onCourses}>
              课程封面
            </button>
            <button type="button" aria-pressed={true}>
              章节配图
            </button>
          </nav>
        )}
        <form
          className="image-library-search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(query.trim());
            setRevision((n) => n + 1);
          }}
        >
          <input
            aria-label="搜索课程或章节"
            value={query}
            maxLength={80}
            placeholder="搜索课程或章节"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button disabled={loading}>搜索</button>
        </form>
        {notice && (
          <p role="status" className="image-editor-notice">
            {notice}
          </p>
        )}
        {loading && !data.items.length ? (
          <p className="image-library-empty" role="status">
            正在整理章节配图…
          </p>
        ) : (
          <div className="image-library-list">
            {data.items.map((item) => (
              <article key={item.id}>
                <Thumbnail token={token} item={item} />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.course_title}</small>
                  <span>
                    {item.draft_status === 'ready'
                      ? '新图待采用'
                      : ['queued', 'running'].includes(item.draft_status)
                        ? '新图生成中'
                        : item.draft_status === 'failed'
                          ? '新图生成失败'
                          : item.has_image
                            ? '已配图'
                            : ['queued', 'running'].includes(item.image_status)
                              ? '正在生成'
                              : '尚未配图'}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSelected(item);
                    setNotice('');
                  }}
                >
                  {item.draft_status === 'ready' ? '预览' : '调整'}
                </button>
              </article>
            ))}
            {!data.items.length && (
              <div className="image-library-empty">
                <p>{search ? '没有找到相关章节' : '还没有章节'}</p>
                <small>
                  {search ? '试试课程名或章节关键词。' : '添加课程和章节后，就可以在这里管理配图。'}
                </small>
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="image-editor-error">
            {error}
            <button onClick={() => setRevision((n) => n + 1)}>重试</button>
          </p>
        )}
        <footer className="image-library-footer">
          <span>共 {data.total} 章</span>
          <button disabled={loading || page === 1} onClick={() => setPage((n) => n - 1)}>
            上一页
          </button>
          <small>
            {page} / {Math.max(1, Math.ceil(data.total / 6))}
          </small>
          <button
            disabled={loading || page * 6 >= data.total}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
