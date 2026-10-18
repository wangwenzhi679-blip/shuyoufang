import { requestJson, requestBlob } from './api-client.mjs';
import ImageDialogHeader from './ImageDialogHeader.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './chapter-image-editor.css';

function Preview({ request, state, draft = false }) {
  const [url, setUrl] = useState(''),
    [failed, setFailed] = useState(false);
  const available = draft
    ? state?.draft_status === 'ready'
    : state?.has_image && state.image_status === 'done';
  useEffect(() => {
    let live = true,
      objectUrl;
    const controller = new AbortController();
    setUrl('');
    setFailed(false);
    if (available)
      request(
        draft ? `preview?draft=${state.draft_id}` : `?v=${state.revision}`,
        { blob: true },
        controller.signal,
      )
        .then((blob) => {
          if (live) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [available, state?.draft_id, state?.draft_status, state?.revision, draft]);
  const pending = ['queued', 'running'].includes(state?.draft_status);
  return (
    <div className="image-editor-preview">
      {url ? (
        <img src={url} alt={draft ? '新配图预览' : '当前配图'} />
      ) : (
        <span>
          {failed
            ? '图片暂时无法加载'
            : available
              ? '加载图片…'
              : draft
                ? pending
                  ? '正在生成…'
                  : '尚未生成新图'
                : '暂无配图'}
        </span>
      )}
    </div>
  );
}
export default function ChapterImageEditor({ token, courseId, chapterId, onClose }) {
  const [open, setOpen] = useState(true),
    [state, setState] = useState(null),
    [instructions, setInstructions] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0);
  const dialog = useRef(null);
  function request(suffix, options = {}, signal) {
    const endpoint = `courses/${courseId}/chapters/${chapterId}/illustration`;
    const path = endpoint + (suffix.startsWith('?') ? suffix : '/' + suffix);
    const send = options.blob ? requestBlob : requestJson;
    return send(path, {
      token,
      method: options.method || 'GET',
      body: options.body,
      signal,
      errorMessage: '配图操作未完成，请重试',
    });
  }
  useEffect(() => {
    if (!open) return;
    let live = true,
      timer;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await request('draft', {}, controller.signal);
        if (!live) return;
        setState(result);
        if (
          ['queued', 'running'].includes(result.draft_status) ||
          ['queued', 'running'].includes(result.image_status)
        )
          timer = setTimeout(load, 4000);
      } catch (e) {
        if (live) setError(e.message);
      }
    }
    load();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, revision, token, courseId, chapterId]);
  useEffect(() => {
    if (open) dialog.current?.focus();
  }, [open]);
  function close() {
    if (busy) return;
    setOpen(false);
    setError('');
    onClose();
  }
  async function act(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result =
        action === 'generate'
          ? await request('regenerate', {
              method: 'POST',
              body: { instructions, acknowledgeCost: true },
            })
          : await request(`drafts/${state.draft_id}/${action}`, { method: 'POST' });
      if (action === 'adopt') {
        window.dispatchEvent(
          new CustomEvent('chapter-illustration-changed', { detail: { chapterId } }),
        );
        setOpen(false);
        onClose('新配图已采用');
      } else
        setNotice(
          action === 'generate' ? '已开始后台生成，可以关闭窗口继续浏览。' : result.message,
        );
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function keyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab') {
      const items = Array.from(dialog.current.querySelectorAll('button,input,textarea')).filter(
        (el) => !el.disabled,
      );
      const first = items[0],
        last = items.at(-1);
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
  const pending = state && ['queued', 'running'].includes(state.draft_status),
    ready = state?.draft_status === 'ready',
    initialPending = state && ['queued', 'running'].includes(state.image_status);
  return open
    ? createPortal(
        <div className="image-editor-backdrop">
          <section
            className="student-paper-frame image-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="调整章节配图"
            ref={dialog}
            tabIndex={-1}
            onKeyDown={keyDown}
          >
            <ImageDialogHeader
              title="调整配图"
              subtitle={state ? `${state.course_title} · ${state.title}` : '正在加载章节…'}
              backLabel="返回配图列表"
              disabled={busy}
              onBack={close}
            />
            {state && (
              <>
                <div className="image-editor-comparison">
                  <div>
                    <h3>当前配图</h3>
                    <Preview request={request} state={state} />
                  </div>
                  <div>
                    <h3>新图预览</h3>
                    <Preview request={request} state={state} draft />
                  </div>
                </div>
                {state.draft_status === 'failed' && (
                  <p role="alert" className="image-editor-error">
                    {state.draft_error}
                  </p>
                )}
                {pending || initialPending ? (
                  <p role="status" className="image-editor-hint">
                    配图正在后台生成，可以关闭窗口继续浏览，原图会保留。
                  </p>
                ) : ready ? (
                  <>
                    <p className="image-editor-hint">
                      满意后采用新图；也可以保留原图，放弃本次候选图。
                    </p>
                    <footer>
                      <button disabled={busy} onClick={() => act('discard')}>
                        保留原图
                      </button>
                      <button
                        className="image-editor-primary"
                        disabled={busy}
                        onClick={() => act('adopt')}
                      >
                        采用新图
                      </button>
                    </footer>
                  </>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act('generate');
                    }}
                  >
                    <div className="image-editor-presets" aria-label="快捷配图要求">
                      {[
                        ['水墨更淡', '减少颜色和浓墨，增加宣纸留白与自然笔触。'],
                        ['突出概念', '突出本章关键概念及其关系，避免无关山水和泛化摆件。'],
                        ['重新构图', '使用新的构图和视觉主体，保持淡彩水墨风格。'],
                      ].map(([label, text]) => (
                        <button
                          type="button"
                          key={label}
                          disabled={busy}
                          aria-pressed={instructions.includes(text)}
                          onClick={() =>
                            setInstructions((value) =>
                              value.includes(text)
                                ? value.replace(text, '').trim()
                                : (value + ' ' + text).trim().slice(0, 500),
                            )
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label>
                      向 AI 提要求 <span>选填</span>
                      <textarea
                        disabled={busy}
                        maxLength={500}
                        rows={3}
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder="例如：突出章节的主要概念，颜色淡一些，水墨感更强。"
                      />
                    </label>

                    <footer>
                      <button type="button" disabled={busy} onClick={close}>
                        取消
                      </button>
                      <button className="image-editor-primary" disabled={busy}>
                        {busy ? '提交中…' : state.has_image ? '重新生成' : '生成配图'}
                      </button>
                    </footer>
                  </form>
                )}
              </>
            )}
            {error && (
              <p className="image-editor-error" role="alert">
                {error}
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
      )
    : null;
}
