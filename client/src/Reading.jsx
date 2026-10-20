import { requestJson, requestBlob } from './api-client.mjs';
import PaperDialog from './PaperDialog.jsx';
import { activePreferences, registerAccountGuard } from './account-state.js';
import { createPortal } from 'react-dom';
import React, { useEffect, useRef, useState } from 'react';
import DocumentZoom from './DocumentZoom.jsx';
import { ReadingFullscreenButton, useReadingFullscreen } from './ReadingFullscreen.jsx';
import {
  hashReadingText as hash,
  captureReadingPosition,
  applyReadingPosition,
  stableReadingPosition,
} from './reading-position.mjs';
export function readingApi(token, path, body, method = 'POST') {
  return requestJson(path, {
    token,
    body,
    method: body ? method : 'GET',
    keepalive: Boolean(body),
    errorMessage: '阅读操作失败',
  });
}

export function ReadingArea({
  token,
  courseId,
  chapterId,
  materialId = 0,
  title,
  children,
  page,
  onPage,
  pageReady = true,
  onBookmarkMaterial,
  bookmarkPosition,
  onProgress,
  completed = false,
  zoomable = false,
  endContent,
  fullscreenEnabled = true,
}) {
  const viewport = useRef(null);
  const fullscreen = useReadingFullscreen(viewport);
  const [zoom, setZoom] = useState(100);
  const box = useRef(null),
    state = useRef({
      ready: false,
      version: 0,
      pending: null,
      saving: false,
      timer: null,
      stopped: false,
      live: true,
      position: null,
    });
  const [status, setStatus] = useState('正在加载阅读位置…'),
    [error, setError] = useState(''),
    [marks, setMarks] = useState([]),
    [modal, setModal] = useState(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [restored, setRestored] = useState(false);
  const deferred = useRef(null),
    restoredTop = useRef(null);
  const layoutPosition = useRef(null);
  const userScroll = useRef(false);
  const userScrollTimer = useRef(null);
  const [ready, setReady] = useState(false),
    [loadAttempt, setLoadAttempt] = useState(0);
  const [readingPercent, setReadingPercent] = useState(0);
  const furthest = useRef(0);
  const measureProgress = () => {
    const el = box.current;
    const range = el.scrollHeight - el.clientHeight;
    const value = range > 1 ? Math.round((el.scrollTop / range) * 99) : 0;
    furthest.current = Math.max(furthest.current, value);
    setReadingPercent(furthest.current);
    onProgress?.(furthest.current);
    return furthest.current;
  };
  const path = `courses/${courseId}/chapters/${chapterId}/reading?materialId=${materialId}`;
  const draftKey = `reading-draft:${hash(token)}:${courseId}:${chapterId}:${materialId}`;
  const cache = () => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ version: state.current.version, position: state.current.pending }),
      );
    } catch {}
  };
  const current = () => {
    if (!materialId) {
      const pos = currentPosition();
      return { ...pos, progress: measureProgress() };
    }
    return currentPosition();
  };
  const currentPosition = () => captureReadingPosition(box.current, page);
  const restore = (position) => {
    userScroll.current = false;
    if (!position) {
      setRestored(true);
      return;
    }
    if (position.page && onPage) {
      deferred.current = position;
      if (position.page !== page) {
        onPage(position.page);
        return;
      }
      if (!pageReady) return;
      applyReadingPosition(box.current, position);
      deferred.current = null;
      layoutPosition.current = captureReadingPosition(box.current, page);
      restoredTop.current = box.current.scrollTop;
      setRestored(true);
      return;
    }
    const stablePosition = stableReadingPosition(box.current, position);
    if (!stablePosition || !applyReadingPosition(box.current, stablePosition)) {
      setError('原阅读位置已失效，资料可能有变化；已从开头展示。');
      setStatus('未能恢复阅读位置');
      layoutPosition.current = null;
      box.current.scrollTop = 0;
    } else {
      // 用固定原页标识升级旧记录，后续图片加载与尺寸变化不再依赖加载文字。
      layoutPosition.current = stablePosition;
    }
    restoredTop.current = box.current.scrollTop;
    setRestored(true);
  };
  const changeZoom = (value) => {
    const position = restored && box.current ? currentPosition() : null;
    setZoom(value);
    if (position)
      requestAnimationFrame(() => {
        if (box.current) restore(position);
      });
  };
  useEffect(() => {
    const container = box.current;
    let frame;
    const align = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const position = layoutPosition.current;
        if (!position || !pageReady || (position.page && position.page !== page)) return;
        if (applyReadingPosition(container, position)) restoredTop.current = container.scrollTop;
      });
    };
    // 图片懒加载、缩放、全屏与并排笔记都会改变布局，始终按同一原页及页内比例校准。
    const resize = new ResizeObserver(align);
    const observeContent = () => {
      resize.observe(container);
      for (const child of container.children) resize.observe(child);
    };
    const mutations = new MutationObserver(() => {
      observeContent();
      align();
    });
    observeContent();
    mutations.observe(container, { childList: true, subtree: true });
    const resetIntent = (event) => {
      if (!container.contains(event.target)) userScroll.current = false;
    };
    const onResize = () => {
      userScroll.current = false;
      align();
    };
    document.addEventListener('pointerdown', resetIntent, true);
    window.addEventListener('resize', onResize);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(userScrollTimer.current);
      document.removeEventListener('pointerdown', resetIntent, true);
      window.removeEventListener('resize', onResize);
    };
  }, [page, pageReady]);
  const flush = async () => {
    const s = state.current;
    if (!s.ready || s.saving || !s.pending || s.stopped) return;
    s.saving = true;
    const pos = s.pending;
    s.pending = null;
    try {
      const d = await readingApi(token, path, { position: pos, version: s.version }, 'PUT');
      s.version = d.version;
      s.position = pos;
      if (s.pending) cache();
      else {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      }
      if (s.live) setStatus('阅读位置已保存');
    } catch (e) {
      s.pending = s.pending || pos;
      cache();
      s.stopped = true;
      if (s.live) {
        setError(e.message);
        setStatus('阅读位置未保存');
      }
    } finally {
      s.saving = false;
      if (s.pending && !s.stopped) flush();
    }
  };
  useEffect(() => {
    const s = state.current;
    s.live = true;
    s.ready = false;
    s.stopped = false;
    setReady(false);
    setError('');
    setStatus('正在加载阅读位置…');
    readingApi(token, path)
      .then((d) => {
        if (!s.live) return;
        s.version = d.version;
        let draft;
        try {
          draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
        } catch {}
        if (draft?.position && draft.version === d.version) {
          d.position = draft.position;
          s.pending = draft.position;
          flush();
        } else {
          try {
            localStorage.removeItem(draftKey);
          } catch {}
        }
        s.position = d.position;
        furthest.current = d.position?.progress || 0;
        setReadingPercent(furthest.current);
        onProgress?.(furthest.current);
        setMarks(d.bookmarks);
        s.ready = true;
        setReady(true);
        if (s.pending) flush();
        setStatus(d.position ? '已恢复上次阅读位置' : '阅读时自动保存位置');
        restore(bookmarkPosition || (activePreferences.restoreReading ? d.position : null));
      })
      .catch((e) => {
        if (s.live) {
          setError(e.message);
          setStatus('无法读取阅读位置');
        }
      });
    const hidden = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      s.live = false;
      clearTimeout(s.timer);
      flush();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (!state.current.ready || !pageReady) return;
    if (deferred.current) {
      restore(deferred.current);
    } else if (page && restored) {
      box.current.scrollTop = 0;
      layoutPosition.current = { page, index: 0, anchor: 'pdf-page', offset: 0 };
      state.current.pending = layoutPosition.current;
      flush();
    }
  }, [page, pageReady]);
  const scroll = () => {
    if (restoredTop.current !== null && Math.abs(box.current.scrollTop - restoredTop.current) < 2) {
      restoredTop.current = null;
      return;
    }
    restoredTop.current = null;
    if (!state.current.ready || !restored || !pageReady || !userScroll.current) return;
    state.current.pending = current();
    layoutPosition.current = state.current.pending;
    clearTimeout(userScrollTimer.current);
    userScrollTimer.current = setTimeout(() => {
      userScroll.current = false;
    }, 150);
    cache();
    setStatus('正在记录阅读位置…');
    clearTimeout(state.current.timer);
    state.current.timer = setTimeout(flush, 600);
  };
  useEffect(
    () =>
      registerAccountGuard(async () => {
        await flush();
        while (state.current.saving) await new Promise((resolve) => setTimeout(resolve, 30));
        if (state.current.pending || state.current.stopped)
          throw new Error('阅读位置尚未保存，请先重试后切换账号');
      }),
    [],
  );
  const refreshMarks = async () => setMarks((await readingApi(token, path)).bookmarks);
  const act = async () => {
    setBusy(true);
    setError('');
    try {
      if (modal.type === 'delete')
        await readingApi(token, `reading-bookmarks/${modal.mark.id}`, {}, 'DELETE');
      else if (modal.type === 'rename')
        await readingApi(token, `reading-bookmarks/${modal.mark.id}`, { name }, 'PUT');
      else
        await readingApi(
          token,
          `courses/${courseId}/chapters/${chapterId}/reading/bookmarks?materialId=${materialId}`,
          { name, position: modal.position },
        );
      await refreshMarks();
      setModal(modal.type === 'add' ? { type: 'list' } : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={viewport}
      className={`reading-tracker ${fullscreen.fullscreen ? 'is-reading-fullscreen' : ''}`}
      style={zoomable ? { '--book-page-width': `${zoom}%` } : undefined}
    >
      <div className="reading-tools">
        <small role="status">{status}</small>
        {!materialId && (
          <span className="chapter-reading-percent">
            章节进度 {completed ? 100 : readingPercent}%
          </span>
        )}
        <button
          type="button"
          disabled={!ready || !pageReady}
          onClick={() => {
            const selected = window.getSelection()?.toString().trim();
            setName((selected || `${title}${page ? ` · 第 ${page} 页` : ''}`).slice(0, 120));
            setModal({ type: 'add', position: current() });
          }}
        >
          添加书签
        </button>
        <button onClick={() => setModal({ type: 'list' })}>书签（{marks.length}）</button>
        {zoomable && <DocumentZoom value={zoom} onChange={changeZoom} />}
        {fullscreenEnabled && <ReadingFullscreenButton {...fullscreen} />}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
          {!ready ? (
            <button type="button" onClick={() => setLoadAttempt((n) => n + 1)}>
              重新加载
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError('');
                state.current.stopped = false;
                flush();
              }}
            >
              重试保存
            </button>
          )}
        </p>
      )}
      <div
        ref={box}
        tabIndex={0}
        role="region"
        aria-label="可滚动阅读内容"
        className="tracked-reading-scroll"
        onScroll={scroll}
        onWheel={() => {
          userScroll.current = true;
        }}
        onTouchStart={() => {
          userScroll.current = true;
        }}
        onPointerDown={() => {
          userScroll.current = true;
        }}
        onKeyDown={(event) => {
          userScroll.current = [
            'ArrowUp',
            'ArrowDown',
            'PageUp',
            'PageDown',
            'Home',
            'End',
            ' ',
            'Tab',
          ].includes(event.key);
        }}
      >
        {children}
        {endContent}
      </div>
      {modal &&
        createPortal(
          <div className="modal-backdrop">
            <PaperDialog
              busy={busy}
              onDismiss={() => !busy && setModal(null)}
              className="record-modal reading-bookmark-modal"
              role="dialog"
              aria-modal="true"
              aria-label={
                modal.type === 'list'
                  ? '阅读书签'
                  : modal.type === 'delete'
                    ? '删除书签？'
                    : modal.type === 'rename'
                      ? '修改书签名称'
                      : '添加阅读书签'
              }
            >
              <div className="modal-header">
                <h2>
                  {modal.type === 'list'
                    ? '阅读书签'
                    : modal.type === 'delete'
                      ? '删除书签？'
                      : modal.type === 'rename'
                        ? '修改书签名称'
                        : '添加阅读书签'}
                </h2>
                <button aria-label="关闭书签弹窗" onClick={() => !busy && setModal(null)}>
                  ×
                </button>
              </div>
              {modal.type === 'list' ? (
                marks.length ? (
                  <div className="reading-bookmark-list">
                    {marks.map((m) => (
                      <article key={m.id}>
                        <button
                          disabled={m.unavailable}
                          onClick={() => {
                            if (m.material_id && Number(m.material_id) !== Number(materialId))
                              onBookmarkMaterial?.(m);
                            else restore(m.position);
                            setModal(null);
                          }}
                        >
                          {m.name}
                          {m.unavailable && <small>原资料已删除</small>}
                          {m.original_name && <small>{m.original_name}</small>}
                          {m.position.page && <small>第 {m.position.page} 页</small>}
                        </button>
                        <button
                          onClick={() => {
                            setName(m.name);
                            setModal({ type: 'rename', mark: m });
                          }}
                        >
                          改名
                        </button>
                        <button onClick={() => setModal({ type: 'delete', mark: m })}>删除</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>还没有书签，阅读时可以收藏当前位置。</p>
                )
              ) : modal.type === 'delete' ? (
                <p>删除“{modal.mark.name}”？阅读资料和进度会保留。</p>
              ) : (
                <label>
                  书签名称
                  <input
                    autoFocus
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {error && <p className="form-error">{error}</p>}
              <div className="rename-actions">
                <button disabled={busy} onClick={() => setModal(null)}>
                  {modal.type === 'list' ? '关闭' : '取消'}
                </button>
                {modal.type !== 'list' && (
                  <button
                    className="primary"
                    disabled={busy || (modal.type !== 'delete' && !name.trim())}
                    onClick={act}
                  >
                    {busy ? '处理中…' : modal.type === 'delete' ? '删除' : '保存'}
                  </button>
                )}
              </div>
            </PaperDialog>
          </div>,
          document.body,
        )}
    </div>
  );
}
// 课程尚未分章时仍可读原页，不向需要章节归属的定位和书签接口发送请求。
function UnassignedMaterialPage({ children, page }) {
  const [zoom, setZoom] = useState(100);
  return (
    <div className="reading-tracker" style={{ '--book-page-width': `${zoom}%` }}>
      <div className="reading-tools">
        <small>分章后可保存阅读位置和书签</small>
        <DocumentZoom value={zoom} onChange={setZoom} />
      </div>
      <div
        key={page}
        className="tracked-reading-scroll"
        tabIndex={0}
        role="region"
        aria-label="可滚动阅读内容"
      >
        {children}
      </div>
    </div>
  );
}

export function PagedMaterialReader(props) {
  // 新资料使用独立阅读状态，不能沿用上一本的页码、预览模式或未完成请求。
  return (
    <ScopedPagedMaterialReader
      key={`${hash(props.token)}:${props.courseId}:${props.chapterId || 0}:${props.material.id}`}
      {...props}
    />
  );
}

function ScopedPagedMaterialReader({
  token,
  courseId,
  chapterId,
  material,
  title,
  initialPage,
  bookmarkPosition,
  originalUrl,
}) {
  const viewport = useRef(null);
  const fullscreen = useReadingFullscreen(viewport);
  const [original, setOriginal] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [imagePage, setImagePage] = useState(null);
  const [page, setPage] = useState(initialPage || 1),
    [count, setCount] = useState(null),
    [entry, setEntry] = useState('1'),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setCount(null);
    requestJson(`courses/${courseId}/materials/${material.id}/reading-info`, {
      token,
      signal: controller.signal,
      errorMessage: '无法读取资料页数，请重新加载',
    })
      .then((d) => {
        if (live) setCount(d.pages);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [token, courseId, material.id, loadAttempt]);
  useEffect(() => {
    let live = true,
      imageUrl;
    const controller = new AbortController();
    setUrl('');
    setLoaded(false);
    setEntry(String(page));
    setError('');
    requestBlob(`courses/${courseId}/materials/${material.id}/reading-page/${page}`, {
      token,
      signal: controller.signal,
      errorMessage: '原页图片加载失败，请重新加载',
    })
      .then((blob) => {
        imageUrl = URL.createObjectURL(blob);
        if (live) {
          setImagePage(page);
          setUrl(imageUrl);
        } else URL.revokeObjectURL(imageUrl);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [token, courseId, material.id, page, loadAttempt]);
  const pageImage =
    url && imagePage === page ? (
      <img
        key={page}
        className="document-scaled-page"
        src={url}
        alt={`原资料第 ${page} 页`}
        onLoad={() => setLoaded(true)}
        onError={() => setError('原页图片加载失败，请重新加载')}
      />
    ) : (
      <p>{error ? '原页暂不可用' : '正在加载原页…'}</p>
    );
  if (original)
    return (
      <div
        ref={viewport}
        className={`paged-material-reader ${fullscreen.fullscreen ? 'is-reading-fullscreen' : ''}`}
      >
        <div className="pdf-page-controls">
          <button onClick={() => setOriginal(false)}>返回分页阅读</button>
          <ReadingFullscreenButton {...fullscreen} />
          <small>原文件预览支持文字选择；此模式只保留分页阅读时的位置。</small>
        </div>
        <iframe title="原文件预览" src={originalUrl} />
      </div>
    );
  return (
    <div
      ref={viewport}
      className={`paged-material-reader ${fullscreen.fullscreen ? 'is-reading-fullscreen' : ''}`}
    >
      <div className="pdf-page-controls">
        <ReadingFullscreenButton {...fullscreen} />
        {originalUrl && <button onClick={() => setOriginal(true)}>原文件预览</button>}
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(entry);
            if (Number.isInteger(n) && n >= 1 && n <= Math.min(count || 2000, 2000)) setPage(n);
            else setError('请输入有效页码');
          }}
        >
          <label>
            页码
            <input
              aria-label="阅读页码"
              type="number"
              min="1"
              max={Math.min(count || 2000, 2000)}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          </label>
          <span>/ {count || '…'}</span>
          <button>跳转</button>
        </form>
        <button
          disabled={!count || page >= Math.min(count, 2000)}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>
            重新加载原页
          </button>
        </p>
      )}
      {chapterId ? (
        <ReadingArea
          key={material.id}
          token={token}
          courseId={courseId}
          chapterId={chapterId}
          materialId={material.id}
          title={title}
          page={page}
          onPage={setPage}
          pageReady={loaded && imagePage === page}
          fullscreenEnabled={false}
          bookmarkPosition={bookmarkPosition}
          zoomable
        >
          {pageImage}
        </ReadingArea>
      ) : (
        <UnassignedMaterialPage page={page}>{pageImage}</UnassignedMaterialPage>
      )}
    </div>
  );
}
