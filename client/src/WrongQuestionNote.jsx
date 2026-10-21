import { useEffect, useRef, useState } from 'react';
import { requestJson } from './api-client.mjs';
import { formatDateTime } from './date-format.mjs';
import './wrong-question-notes.css';

const empty = { reason: '', takeaway: '', version: 0 };
const readDraft = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value &&
      typeof value.reason === 'string' &&
      typeof value.takeaway === 'string' &&
      Number.isInteger(value.version)
      ? value
      : null;
  } catch {
    return null;
  }
};

export default function WrongQuestionNote(props) {
  return <NoteEditor key={`${props.userId}:${props.questionId}:${props.token}`} {...props} />;
}

function NoteEditor({ token, userId, questionId, ensureCollected, onSaved }) {
  const key = `wrong-note-draft:${userId}:${questionId}`;
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(empty);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false),
    [hasDraft, setHasDraft] = useState(() => Boolean(readDraft(key)));
  const saved = useRef(empty),
    active = useRef(0);
  useEffect(
    () => () => {
      active.current++;
    },
    [key, token],
  );

  const load = async (restore = true) => {
    const requestId = ++active.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let server = empty;
      try {
        server = (await requestJson(`wrong-question-notes/${questionId}`, { token })).note;
      } catch (reason) {
        if (reason.status !== 404) throw reason;
      }
      if (requestId !== active.current) return;
      saved.current = server;
      const draft = restore && readDraft(key);
      setNote(draft || server);
      setLoaded(true);
      setConflict(false);
      setHasDraft(Boolean(readDraft(key)));
      if (draft) setNotice('已恢复本机草稿，尚未保存到学习心得。');
    } catch (reason) {
      if (requestId === active.current) setError(reason.message);
    } finally {
      if (requestId === active.current) setBusy(false);
    }
  };
  const update = (field, value) => {
    const next = { ...note, [field]: value };
    setNote(next);
    setNotice('');
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setHasDraft(true);
    } catch {
      setError('本机草稿保存失败，请保持此页面打开并及时点击保存。');
    }
  };
  const save = async () => {
    if (busy || !loaded) return;
    const requestId = active.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await ensureCollected?.();
      const data = await requestJson(`wrong-question-notes/${questionId}`, {
        token,
        method: 'PUT',
        body: { reason: note.reason, takeaway: note.takeaway, version: note.version },
      });
      if (requestId !== active.current) return;
      saved.current = data.note;
      setNote(data.note);
      setConflict(false);
      try {
        localStorage.removeItem(key);
      } catch {
        /* 服务器已保存，旧草稿可在下次打开时辨认。 */
      }
      setHasDraft(false);
      setNotice('已保存，并汇总到“错题复习 → 学习心得”。');
      try {
        await onSaved?.();
      } catch {
        setNotice('批注已保存，列表暂未刷新，请稍后重新打开学习心得。');
      }
    } catch (reason) {
      if (requestId === active.current) {
        setError(reason.message);
        setConflict(reason.status === 409);
      }
    } finally {
      if (requestId === active.current) setBusy(false);
    }
  };
  return (
    <section className="question-reflection">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !loaded) void load();
        }}
      >
        {open ? '收起批注' : hasDraft ? '继续批注（有本机草稿）' : '错因批注与学习心得'}
      </button>
      {open && (
        <div className="reflection-editor">
          <p>
            记下为什么出错、正确思路，以及下次如何避免。
            {ensureCollected && '保存时会同时收录到错题本。'}
          </p>
          <label>
            错因批注 <span>（最多2000字）</span>
            <textarea
              maxLength={2000}
              value={note.reason}
              disabled={busy || !loaded}
              onChange={(event) => update('reason', event.target.value)}
              placeholder="例如：漏看了题目中的限制条件，混淆了两个概念。"
            />
          </label>
          <label>
            学习心得 <span>（最多500字）</span>
            <textarea
              maxLength={500}
              value={note.takeaway}
              disabled={busy || !loaded}
              onChange={(event) => update('takeaway', event.target.value)}
              placeholder="正确的思路是什么？下次遇到类似题目，要先检查哪一步？"
            />
          </label>
          {note.updated_at && <small>上次保存：{formatDateTime(note.updated_at)}</small>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="reflection-notice" role="status">
              {notice}
            </p>
          )}
          <div className="reflection-actions">
            {(!loaded || conflict) && (
              <button type="button" disabled={busy} onClick={() => load(false)}>
                读取最新批注（保留本机草稿）
              </button>
            )}
            {hasDraft && loaded && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const draft = readDraft(key);
                  if (draft) {
                    setNote({ ...draft, version: saved.current.version });
                    setNotice('已恢复草稿，点击保存后才会更新学习心得。');
                    setConflict(false);
                  }
                }}
              >
                恢复本机草稿
              </button>
            )}
            <button
              type="button"
              className="reflection-save"
              disabled={busy || !loaded || (!note.reason.trim() && !note.takeaway.trim())}
              onClick={save}
            >
              {busy ? '正在处理…' : '保存批注与心得'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
