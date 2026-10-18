import ImageDialogHeader from './ImageDialogHeader.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChapterImageLibrary from './ChapterImageLibrary.jsx';
import CourseCover, { coverApi, coverRequest, notifyCover } from './CourseCover.jsx';

function trap(event, ref, onClose) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    onClose();
  }
  if (event.key === 'Tab') {
    const items = Array.from(ref.current.querySelectorAll('button,input,textarea')).filter(
      (el) => !el.disabled && el.getClientRects().length,
    );
    const first = items[0],
      last = items.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === ref.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
export function ImageManagerTabs({ active, onCourses, onChapters }) {
  return (
    <nav className="cover-manager-tabs" aria-label="配图分类">
      <button type="button" aria-pressed={active === 'courses'} onClick={onCourses}>
        课程封面
      </button>
      <button type="button" aria-pressed={active === 'chapters'} onClick={onChapters}>
        章节配图
      </button>
    </nav>
  );
}
export default function CourseCoverManager({ token, onClose }) {
  const [mode, setMode] = useState('courses');
  return mode === 'chapters' ? (
    <ChapterImageLibrary token={token} onClose={onClose} onCourses={() => setMode('courses')} />
  ) : (
    <CoverLibrary token={token} onClose={onClose} onChapters={() => setMode('chapters')} />
  );
}
function CoverLibrary({ token, onClose, onChapters }) {
  const [data, setData] = useState({ items: [], total: 0 }),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const dialog = useRef(null);
  useEffect(() => {
    if (!selected) dialog.current?.focus();
  }, [selected]);
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
          `${coverApi}/course-covers?page=${page}&q=${encodeURIComponent(search)}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '封面加载失败');
        if (!live) return;
        setData(result);
        setLoading(false);
        if (result.items.some((item) => ['queued', 'running'].includes(item.draft_status)))
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
  if (selected)
    return (
      <CoverEditor
        token={token}
        course={selected}
        onClose={() => {
          setSelected(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  return createPortal(
    <div className="image-editor-backdrop">
      <section
        className="student-paper-frame image-editor-dialog image-library-dialog cover-library-dialog"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="配图管理"
        onKeyDown={(e) => trap(e, dialog, onClose)}
      >
        <ImageDialogHeader
          title="配图管理"
          subtitle="封面与插画，各有一份书卷气。"
          onBack={onClose}
        />
        <ImageManagerTabs active="courses" onCourses={() => {}} onChapters={onChapters} />
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
            aria-label="搜索课程封面"
            placeholder="搜索课程"
            maxLength={80}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button disabled={loading}>搜索</button>
        </form>
        <div className="image-library-list">
          {loading && !data.items.length ? (
            <p className="image-library-empty" role="status">
              正在打开书架…
            </p>
          ) : (
            data.items.map((item) => (
              <article key={item.id}>
                <CourseCover
                  token={token}
                  courseId={item.id}
                  title={item.title}
                  metadata={item}
                  className="cover-library-book"
                />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.source === 'upload'
                      ? '自选封面'
                      : item.source === 'ai'
                        ? 'AI 绘制'
                        : '书名排版'}
                  </small>
                  <span>
                    {item.draft_status === 'ready'
                      ? '新封面待采用'
                      : ['queued', 'running'].includes(item.draft_status)
                        ? '新封面生成中'
                        : item.draft_status === 'failed'
                          ? '生成未完成，可重新尝试'
                          : '在课程与首页同步显示'}
                  </span>
                </div>
                <button onClick={() => setSelected(item)}>
                  {item.draft_status === 'ready' ? '预览' : '更换'}
                </button>
              </article>
            ))
          )}
          {!loading && !data.items.length && (
            <p className="image-library-empty">
              {search ? '没有找到这门课程' : '导入课程后，这里会自动排好封面。'}
            </p>
          )}
        </div>
        {error && (
          <p className="image-editor-error" role="alert">
            {error}
            <button onClick={() => setRevision((n) => n + 1)}>重试</button>
          </p>
        )}
        <footer className="image-library-footer">
          <span>共 {data.total} 门课程</span>
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
async function prepareUpload(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('请选择 PNG、JPG 或 WebP 图片');
  if (file.size > 10 * 1024 * 1024) throw new Error('图片请控制在 10MB 以内');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000)
      throw new Error('图片尺寸过大，请缩小后上传');
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fdfbf6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    bitmap.close();
  }
}
function CoverEditor({ token, course, onClose }) {
  const [state, setState] = useState(course),
    [mode, setMode] = useState(
      ['ready', 'queued', 'running'].includes(course.draft_status) ? 'ai' : 'upload',
    ),
    [upload, setUpload] = useState(''),
    [instructions, setInstructions] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [candidate, setCandidate] = useState('');
  const dialog = useRef(null),
    fileInput = useRef(null),
    live = useRef(true);
  useEffect(() => {
    dialog.current?.focus();
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true,
      timer;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await coverRequest(token, course.id, '', {}, controller.signal);
        if (!active) return;
        setState(result);
        setError('');
        if (['queued', 'running'].includes(result.draft_status)) timer = setTimeout(load, 4000);
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, course.id, revision]);
  useEffect(() => {
    setCandidate('');
    if (state.draft_status !== 'ready') return;
    let active = true,
      url;
    const controller = new AbortController();
    coverRequest(
      token,
      course.id,
      `/preview?draft=${state.draft_id}`,
      { blob: true },
      controller.signal,
    )
      .then((blob) => {
        if (active) {
          url = URL.createObjectURL(blob);
          setCandidate(url);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, course.id, state.draft_id, state.draft_status]);
  const pending = ['queued', 'running'].includes(state.draft_status),
    ready = state.draft_status === 'ready';
  const close = () => {
    if (!busy) onClose();
  };
  async function act(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const suffix =
        action === 'generate'
          ? '/generate'
          : action === 'upload'
            ? '/upload'
            : action === 'template'
              ? '/template'
              : `/drafts/${state.draft_id}/${action}`;
      const result = await coverRequest(token, course.id, suffix, {
        method: 'POST',
        body: {
          expectedRevision: state.revision || '',
          ...(action === 'upload'
            ? { image: upload }
            : action === 'generate'
              ? { instructions, acknowledgeCost: true }
              : {}),
        },
      });
      if (!live.current) return;
      if (['upload', 'template', 'adopt'].includes(action)) {
        notifyCover(course.id);
        onClose();
      } else {
        setNotice(
          action === 'generate'
            ? '已开始后台绘制，可以先去学习。'
            : result.message || '已保留原封面',
        );
        setRevision((n) => n + 1);
      }
    } catch (e) {
      if (live.current) {
        if (e.status === 409) {
          setNotice('封面状态已更新，请查看后重新确认。');
          setRevision((n) => n + 1);
        } else setError(e.message);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return createPortal(
    <div className="image-editor-backdrop">
      <section
        className="student-paper-frame image-editor-dialog course-cover-editor"
        role="dialog"
        aria-modal="true"
        aria-label="更换课程封面"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(e) => trap(e, dialog, close)}
      >
        <ImageDialogHeader
          title="课程封面"
          subtitle={state.title || course.title}
          backLabel="返回课程封面列表"
          disabled={busy}
          onBack={close}
        />
        <div className="cover-editor-current">
          <CourseCover
            token={token}
            courseId={course.id}
            title={state.title || course.title}
            metadata={state}
          />
          <div>
            <strong>当前封面</strong>
            <p>更换后，课程列表与首页会一同更新。</p>
          </div>
        </div>
        <nav className="cover-manager-tabs" aria-label="封面来源">
          {[
            ['upload', '上传图片'],
            ['template', '书名排版'],
            ['ai', 'AI 绘制'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              disabled={busy}
              aria-pressed={mode === key}
              onClick={() => {
                setMode(key);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {mode === 'upload' ? (
          <>
            <div className="cover-upload-area">
              {upload ? (
                <CourseCover imageUrl={upload} title={course.title} />
              ) : (
                <span>用原书封面，或挑一张喜欢的图片。</span>
              )}
              <input
                ref={fileInput}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  e.target.value = '';
                  if (!file) return;
                  setBusy(true);
                  setError('');
                  try {
                    const image = await prepareUpload(file);
                    if (live.current) setUpload(image);
                  } catch (err) {
                    if (live.current) setError(err.message);
                  } finally {
                    if (live.current) setBusy(false);
                  }
                }}
              />
              <button type="button" disabled={busy} onClick={() => fileInput.current.click()}>
                {upload ? '重新选择' : '选择图片'}
              </button>
              <small>PNG、JPG、WebP · 建议使用竖版图片</small>
            </div>
            <footer>
              <button disabled={busy} onClick={close}>
                取消
              </button>
              <button
                className="image-editor-primary"
                disabled={busy || !upload}
                onClick={() => act('upload')}
              >
                {busy ? '保存中…' : '使用这张封面'}
              </button>
            </footer>
          </>
        ) : mode === 'template' ? (
          <>
            <div className="cover-template-preview">
              <CourseCover title={state.title || course.title} metadata={{ has_image: false }} />
              <p>按书名自动排版，随课程名称更新。</p>
            </div>
            <footer>
              <button disabled={busy} onClick={close}>
                取消
              </button>
              <button
                className="image-editor-primary"
                disabled={busy}
                onClick={() => act('template')}
              >
                使用排版封面
              </button>
            </footer>
          </>
        ) : (
          <>
            {ready ? (
              <>
                <div className="cover-candidate-preview">
                  {candidate ? (
                    <CourseCover imageUrl={candidate} title={course.title} />
                  ) : (
                    <p>正在打开新封面…</p>
                  )}
                  <span>新封面预览</span>
                </div>
                <footer>
                  <button disabled={busy} onClick={() => act('discard')}>
                    保留原封面
                  </button>
                  <button
                    className="image-editor-primary"
                    disabled={busy || !candidate}
                    onClick={() => act('adopt')}
                  >
                    采用新封面
                  </button>
                </footer>
              </>
            ) : pending ? (
              <p className="image-editor-notice" role="status">
                封面正在后台绘制，原封面会保留。完成后可在这里预览。
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act('generate');
                }}
              >
                <label>
                  向 AI 提要求 <span>选填</span>
                  <textarea
                    value={instructions}
                    maxLength={500}
                    rows={3}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="例如：突出课程主题，淡彩水墨，留白多一些。"
                    disabled={busy}
                  />
                </label>
                <footer>
                  <button type="button" disabled={busy} onClick={close}>
                    取消
                  </button>
                  <button className="image-editor-primary" disabled={busy}>
                    {busy ? '提交中…' : '生成封面'}
                  </button>
                </footer>
              </form>
            )}
            {state.draft_status === 'failed' && (
              <p className="image-editor-error" role="alert">
                {state.draft_error || '本次绘制未完成，可以重新尝试。'}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="image-editor-error" role="alert">
            {error}
            <button type="button" disabled={busy} onClick={() => setRevision((n) => n + 1)}>
              重试
            </button>
          </p>
        )}
        {notice && (
          <p className="image-editor-notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </div>,
    document.body,
  );
}
