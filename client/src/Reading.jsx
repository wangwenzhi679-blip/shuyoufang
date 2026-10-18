import { requestJson } from './api-client.mjs';
import { API_ROOT } from './api-base.mjs';
import PaperDialog from './PaperDialog.jsx';
import { activePreferences, registerAccountGuard } from './account-state.js';
import { createPortal } from 'react-dom';
import React, { useEffect, useRef, useState } from 'react';
const root = `${API_ROOT}/`;
export function readingApi(token, path, body, method = 'POST') {
  return requestJson(path, {
    token,
    body,
    method: body ? method : 'GET',
    keepalive: Boolean(body),
    errorMessage: '阅读操作失败',
  });
}

const hash = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
};
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
}) {
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
  const blocks = () => [
    ...(box.current?.querySelectorAll(
      '.imported-introduction,.imported-question,.original-pdf-page',
    ) || []),
  ];
  const current = () => {
    if (!materialId) {
      const pos = currentPosition();
      return { ...pos, progress: measureProgress() };
    }
    return currentPosition();
  };
  const currentPosition = () => {
    if (page)
      return {
        page,
        index: 0,
        anchor: '',
        offset: Math.min(
          1,
          Math.max(
            0,
            box.current.scrollTop /
              Math.max(1, box.current.scrollHeight - box.current.clientHeight),
          ),
        ),
      };
    const nodes = blocks(),
      top = box.current.getBoundingClientRect().top;
    let index = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].getBoundingClientRect().top <= top + 12) index = i;
      else break;
    }
    const el = nodes[index];
    return {
      index,
      anchor: el ? hash(el.textContent) : '',
      offset: el
        ? Math.min(
            1,
            Math.max(0, (top - el.getBoundingClientRect().top) / Math.max(1, el.offsetHeight)),
          )
        : 0,
    };
  };
  const restore = (position) => {
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
      box.current.scrollTop =
        position.offset * Math.max(1, box.current.scrollHeight - box.current.clientHeight);
      deferred.current = null;
      restoredTop.current = box.current.scrollTop;
      setRestored(true);
      return;
    }
    const nodes = blocks();
    const el = position.anchor
      ? nodes.find((n) => hash(n.textContent) === position.anchor)
      : nodes[position.index];
    if (!el) {
      setError('原阅读位置已失效，资料可能有变化；已从开头展示。');
      box.current.scrollTop = 0;
    } else
      box.current.scrollTop +=
        el.getBoundingClientRect().top -
        box.current.getBoundingClientRect().top +
        position.offset * el.offsetHeight;
    restoredTop.current = box.current.scrollTop;
    setRestored(true);
  };
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
      state.current.pending = { page, index: 0, anchor: '', offset: 0 };
      flush();
    }
  }, [page, pageReady]);
  const scroll = () => {
    if (restoredTop.current !== null && Math.abs(box.current.scrollTop - restoredTop.current) < 2) {
      restoredTop.current = null;
      return;
    }
    restoredTop.current = null;
    if (!state.current.ready || !restored || !pageReady) return;
    state.current.pending = current();
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
    <div className="reading-tracker">
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
      >
        {children}
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
export function PagedMaterialReader({
  token,
  courseId,
  chapterId,
  material,
  title,
  initialPage,
  bookmarkPosition,
  originalUrl,
}) {
  const [original, setOriginal] = useState(false);
  const [page, setPage] = useState(initialPage || 1),
    [count, setCount] = useState(null),
    [entry, setEntry] = useState('1'),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    readingApi(token, `courses/${courseId}/materials/${material.id}/reading-info`)
      .then((d) => {
        if (live) setCount(d.pages);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true,
      imageUrl;
    setUrl('');
    setLoaded(false);
    setEntry(String(page));
    setError('');
    fetch(root + `courses/${courseId}/materials/${material.id}/reading-page/${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).message);
        return r.blob();
      })
      .then((blob) => {
        imageUrl = URL.createObjectURL(blob);
        if (live) setUrl(imageUrl);
        else URL.revokeObjectURL(imageUrl);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [page]);
  if (original)
    return (
      <div className="paged-material-reader">
        <div className="pdf-page-controls">
          <button onClick={() => setOriginal(false)}>返回分页阅读</button>
          <small>原文件预览支持文字选择；此模式只保留分页阅读时的位置。</small>
        </div>
        <iframe title="原文件预览" src={originalUrl} />
      </div>
    );
  return (
    <div className="paged-material-reader">
      <div className="pdf-page-controls">
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
      {error && <p className="form-error">{error}</p>}
      <ReadingArea
        key={material.id}
        token={token}
        courseId={courseId}
        chapterId={chapterId}
        materialId={material.id}
        title={title}
        page={page}
        onPage={setPage}
        pageReady={loaded}
        bookmarkPosition={bookmarkPosition}
      >
        {url ? (
          <img src={url} alt={`原资料第 ${page} 页`} onLoad={() => setLoaded(true)} />
        ) : (
          <p>正在加载原页…</p>
        )}
      </ReadingArea>
    </div>
  );
}
