import PaperDialog from './PaperDialog.jsx';
import React, { useEffect, useRef, useState } from 'react';
import AssistantWorkspace from './AssistantWorkspace.jsx';
import { activePreferences, listenPreferences, registerAccountGuard } from './account-state.js';

export default function AssistantDesk({
  token,
  user,
  courses,
  onCourses,
  onOpenNotes,
  onOpenCourse,
  Answer,
  request,
}) {
  const userId = JSON.parse(atob(token.split('.')[1])).sub;
  const key = 'scholar-assistant:' + userId;
  const [courseId, setCourseId] = useState(() => {
    const saved = sessionStorage.getItem(key + ':course');
    return courses.some((c) => String(c.id) === saved) ? saved : String(courses[0]?.id || '');
  });
  const [chapters, setChapters] = useState([]),
    [chapterId, setChapterId] = useState('');
  const [threads, setThreads] = useState([]),
    [hasMore, setHasMore] = useState(false),
    [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null),
    [question, setQuestion] = useState(''),
    [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [models, setModels] = useState([{ id: 'configured', label: '默认模型' }]),
    [model, setModel] = useState(activePreferences.defaultModel);
  const [dialog, setDialog] = useState(null),
    [practiceMessage, setPracticeMessage] = useState(null);
  const selected = useRef(null),
    epoch = useRef(0),
    alive = useRef(true),
    lock = useRef(false),
    drafts = useRef(new Map()),
    dialogRef = useRef(null);
  const courseRef = useRef(courseId),
    questionRef = useRef(question),
    pending = useRef(null),
    api = (path, options = {}) => request('assistant/' + path, { token, ...options });
  const draftKey = (id) => key + ':draft:' + id;
  const list = async (course = courseRef.current, number = 1) => {
    const data = await api('threads?courseId=' + course + '&page=' + number);
    if (alive.current && course === courseRef.current) {
      setThreads((items) =>
        number === 1
          ? data.items
          : [...items, ...data.items.filter((t) => !items.some((i) => i.id === t.id))],
      );
      setHasMore(data.hasMore);
      setPage(number);
    }
    return data.items;
  };
  const apply = (data) => {
    if (!alive.current || selected.current !== data.thread.id) return;
    setDetail(data);
    setChapterId(String(data.thread.chapter_id || ''));
    setThreads((items) => {
      const current = {
        id: data.thread.id,
        course_id: data.thread.course_id,
        chapter_id: data.thread.chapter_id,
        chapter_title: data.thread.chapter_title,
        title: data.thread.title,
        updated_at: data.thread.updated_at,
        running: data.messages.some((m) => m.status === 'running'),
      };
      return items.some((t) => t.id === current.id)
        ? items.map((t) => (t.id === current.id ? current : t))
        : [current, ...items];
    });
    let record = drafts.current.get(data.thread.id);
    if (!record) {
      const local = localStorage.getItem(draftKey(data.thread.id));
      record = {
        value: local ?? data.thread.draft,
        confirmed: data.thread.draft,
        version: data.thread.draft_version,
        chain: Promise.resolve(),
      };
      drafts.current.set(data.thread.id, record);
    }
    questionRef.current = record.value;
    setQuestion(record.value);
  };
  const refresh = async () => {
    const id = selected.current;
    if (!id) return;
    const data = await api('threads/' + id);
    if (id === selected.current) apply(data);
    return data;
  };
  const flushDraft = async (id = selected.current) => {
    const record = drafts.current.get(id);
    if (!record) return;
    clearTimeout(record.timer);
    const run = async () => {
      if (record.value === record.confirmed) return;
      const value = record.value;
      const data = await api('threads/' + id, {
        method: 'PATCH',
        body: { draft: value, version: record.version },
      });
      record.version = data.version;
      record.confirmed = value;
      if (record.value === value) localStorage.removeItem(draftKey(id));
    };
    const next = record.chain.catch(() => {}).then(run);
    record.chain = next;
    await next;
  };
  const edit = (value) => {
    setQuestion(value);
    questionRef.current = value;
    const id = selected.current;
    if (!id) {
      sessionStorage.setItem(key + ':new-draft:' + courseRef.current, value);
      return;
    }
    const record = drafts.current.get(id);
    if (!record) return;
    record.value = value;
    localStorage.setItem(draftKey(id), value);
    clearTimeout(record.timer);
    record.timer = setTimeout(
      () =>
        flushDraft(id).catch((e) => {
          if (alive.current) setError('草稿已保存在本机。' + e.message);
        }),
      650,
    );
  };
  const chooseThread = async (id) => {
    await flushDraft();
    selected.current = id;
    setDetail(null);
    setError('');
    setLoading(true);
    sessionStorage.setItem(key + ':selected:' + courseRef.current, id);
    const data = await api('threads/' + id);
    apply(data);
    if (selected.current === id) setLoading(false);
  };
  const safely = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e.message || '操作失败，请重试');
    } finally {
      lock.current = false;
      if (alive.current) {
        setWorking(false);
        setLoading(false);
      }
    }
  };
  const changeCourse = (course) =>
    safely(async () => {
      await flushDraft();
      courseRef.current = course;
      setCourseId(course);
      selected.current = null;
      setDetail(null);
      setChapters([]);
      setThreads([]);
      setChapterId('');
      setQuestion('');
      sessionStorage.setItem(key + ':course', course);
    });
  const newThread = (scope) =>
    safely(async () => {
      await flushDraft();
      const data = await api('threads', {
        method: 'POST',
        body: {
          id: crypto.randomUUID(),
          courseId: Number(courseRef.current),
          chapterId: scope ? Number(scope) : null,
        },
      });
      selected.current = data.thread.id;
      sessionStorage.setItem(key + ':selected:' + courseRef.current, data.thread.id);
      setDetail(null);
      apply(data);
      await list();
    });
  const changeScope = (value) => {
    if (String(detail?.thread.chapter_id || '') === value) return;
    if (!detail) {
      setChapterId(value);
      return;
    }
    newThread(value);
  };
  useEffect(() => {
    alive.current = true;
    const unlisten = listenPreferences((p) => setModel(p.defaultModel));
    const unguard = registerAccountGuard(async () => {
      await flushDraft();
    });
    return () => {
      alive.current = false;
      epoch.current++;
      unlisten();
      unguard?.();
      for (const [id, record] of drafts.current) {
        clearTimeout(record.timer);
        flushDraft(id).catch(() => {});
      }
    };
  }, [token]);
  useEffect(() => {
    let live = true;
    const load = () =>
      api('models')
        .then((d) => {
          if (live) {
            setModels(d.models);
            setModel((v) => (d.models.some((m) => m.id === v) ? v : 'configured'));
          }
        })
        .catch(() => {});
    load();
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, [token]);
  useEffect(() => {
    if (!courseId) {
      setLoading(false);
      return;
    }
    const current = ++epoch.current;
    setLoading(true);
    (async () => {
      const scope = await api('scope?courseId=' + courseId);
      if (current !== epoch.current) return;
      setChapters(scope.chapters);
      const oldKey = 'math-auth-assistant-conversations:' + userId;
      if (!localStorage.getItem(key + ':migrated:' + courseId)) {
        try {
          const saved = JSON.parse(localStorage.getItem(oldKey) || '{}'),
            legacy = JSON.parse(localStorage.getItem('math-auth-assistant-conversations') || '{}');
          const messages = saved[courseId] || legacy[courseId];
          if (Array.isArray(messages) && messages.length)
            await api('import', {
              method: 'POST',
              body: {
                courseId: Number(courseId),
                messages: messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                  sources: (m.sources || []).filter((s) => typeof s === 'string'),
                })),
                draft: localStorage.getItem(oldKey + ':question:' + courseId) || '',
              },
            });
          localStorage.setItem(key + ':migrated:' + courseId, '1');
        } catch (e) {
          if (current === epoch.current) setError('旧对话仍保留在本机，迁移未完成：' + e.message);
        }
      }
      const items = await list(courseId);
      if (current !== epoch.current) return;
      const targetChapter = sessionStorage.getItem(key + ':target-chapter:' + courseId);
      if (targetChapter !== null) {
        sessionStorage.removeItem(key + ':target-chapter:' + courseId);
        const chapterThread = items.find(
          (t) => String(t.chapter_id || '') === String(targetChapter),
        );
        const prefill = sessionStorage.getItem(key + ':new-draft:' + courseId) || '';
        if (chapterThread && !prefill) {
          const data = await api('threads/' + chapterThread.id);
          if (current !== epoch.current) return;
          selected.current = data.thread.id;
          sessionStorage.setItem(key + ':selected:' + courseId, data.thread.id);
          apply(data);
        } else {
          selected.current = null;
          setDetail(null);
          setChapterId(String(targetChapter));
          setQuestion(prefill);
          questionRef.current = prefill;
        }
        return;
      }
      const saved = sessionStorage.getItem(key + ':selected:' + courseId);
      let restored;
      if (saved)
        try {
          const data = await api('threads/' + saved);
          if (String(data.thread.course_id) === courseId) restored = data;
        } catch {}
      const item = items[0];
      if (restored || item) {
        const data = restored || (await api('threads/' + item.id));
        if (current !== epoch.current) return;
        selected.current = data.thread.id;
        apply(data);
      } else {
        selected.current = null;
        setDetail(null);
        const draft = sessionStorage.getItem(key + ':new-draft:' + courseId) || '';
        setQuestion(draft);
        questionRef.current = draft;
      }
    })()
      .catch((e) => {
        if (current === epoch.current) setError(e.message);
      })
      .finally(() => {
        if (current === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
    };
  }, [courseId, token]);
  const running = detail?.messages.find((m) => m.status === 'running');
  const practiceRunning = detail?.practiceDrafts.some((d) => d.status === 'running');
  useEffect(() => {
    if (!detail?.thread.id || (!running && !practiceRunning)) return;
    let active = true,
      timer;
    const tick = async () => {
      try {
        await refresh();
        if (active) setError('');
      } catch (e) {
        if (active) setError('连接暂时中断，正在恢复：' + e.message);
      }
      if (active) timer = setTimeout(tick, 900);
    };
    timer = setTimeout(tick, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [detail?.thread.id, !!running, !!practiceRunning]);
  useEffect(() => {
    const focus = () => {
      refresh().catch(() => {});
      if (courseRef.current) list().catch(() => {});
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [token]);
  const send = (event, retryOf) => {
    event?.preventDefault();
    const text = questionRef.current.trim();
    if (!retryOf && !text) return;
    safely(async () => {
      let threadId = selected.current;
      await flushDraft();
      if (!threadId) {
        const data = await api('threads', {
          method: 'POST',
          body: {
            id: crypto.randomUUID(),
            courseId: Number(courseRef.current),
            chapterId: chapterId ? Number(chapterId) : null,
          },
        });
        threadId = data.thread.id;
        selected.current = threadId;
        drafts.current.set(threadId, {
          value: text,
          confirmed: '',
          version: data.thread.draft_version,
          chain: Promise.resolve(),
        });
        localStorage.setItem(draftKey(threadId), text);
        apply(data);
        sessionStorage.setItem(key + ':selected:' + courseRef.current, threadId);
      }
      const signature = threadId + ':' + (retryOf || text);
      let intent;
      try {
        intent = JSON.parse(sessionStorage.getItem(key + ':send-intent') || 'null');
      } catch {}
      if (intent?.signature !== signature) intent = { signature, requestId: crypto.randomUUID() };
      sessionStorage.setItem(key + ':send-intent', JSON.stringify(intent));
      await api('threads/' + threadId + '/messages', {
        method: 'POST',
        body: {
          requestId: intent.requestId,
          ...(retryOf ? { retryOf } : { question: text }),
          model,
        },
      });
      sessionStorage.removeItem(key + ':send-intent');
      sessionStorage.removeItem(key + ':new-draft:' + courseRef.current);
      if (!retryOf) {
        setQuestion('');
        questionRef.current = '';
        localStorage.removeItem(draftKey(threadId));
        drafts.current.delete(threadId);
      }
      const data = await api('threads/' + threadId);
      if (retryOf) {
        const record = drafts.current.get(threadId);
        if (record) record.version = data.thread.draft_version;
      }
      apply(data);
      await list();
    });
  };
  const stop = () =>
    safely(async () => {
      if (!running) return;
      await api(`threads/${selected.current}/messages/${running.id}/stop`, {
        method: 'POST',
        body: {},
      });
      await refresh();
    });
  const rename = (thread) => setDialog({ kind: 'rename', thread, value: thread.title });
  const remove = (thread) => setDialog({ kind: 'delete', thread });
  const confirmDialog = () =>
    safely(async () => {
      const target = dialog.thread;
      if (dialog.kind === 'rename') {
        await api('threads/' + target.id, {
          method: 'PATCH',
          body: { title: dialog.value.trim() },
        });
        if (selected.current === target.id) await refresh();
      } else {
        clearTimeout(drafts.current.get(target.id)?.timer);
        await api('threads/' + target.id, { method: 'DELETE' });
        drafts.current.delete(target.id);
        localStorage.removeItem(draftKey(target.id));
        if (selected.current === target.id) {
          selected.current = null;
          setDetail(null);
          setQuestion('');
          questionRef.current = '';
          sessionStorage.removeItem(key + ':selected:' + courseRef.current);
        }
      }
      setDialog(null);
      await list();
    });
  const copy = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setNotice('已复制回答');
      setTimeout(() => setNotice(''), 2000);
    } catch {
      setError('复制失败，请选中文字复制');
    }
  };
  const generatePractice = (message, settings) =>
    safely(async () => {
      const signature = message.id + JSON.stringify(settings);
      if (pending.current?.signature !== signature)
        pending.current = { signature, requestId: crypto.randomUUID() };
      const data = await api(`threads/${selected.current}/messages/${message.id}/practice`, {
        method: 'POST',
        body: { ...settings, requestId: pending.current.requestId, model },
      });
      pending.current = null;
      const next = await refresh();
      setPracticeMessage({ messageId: message.id, draftId: data.id, threadId: next.thread.id });
    });
  const adopt = (draft, start) =>
    safely(async () => {
      const data = await api(`threads/${selected.current}/practices/${draft.id}/adopt`, {
        method: 'POST',
        body: {},
      });
      await refresh();
      if (start) {
        await flushDraft();
        setPracticeMessage(null);
        await onOpenCourse(data.practice.courseId, {
          chapterId: data.practice.chapterId,
          practiceId: data.practice.id,
        });
      } else setNotice('练习已存入对应章节');
    });
  const source = (message, reference) =>
    safely(async () => {
      if (!reference.materialId) throw Error('旧记录未能定位到唯一原资料，请从课程资料库查看');
      const data = await request(
        `courses/${detail.thread.course_id}/materials/${reference.materialId}`,
        { token },
      );
      setDialog({ kind: 'source', source: reference, material: data.material || data });
    });
  useEffect(() => {
    if (!courses.length || courses.some((c) => String(c.id) === courseId)) return;
    const next = String(courses[0].id);
    courseRef.current = next;
    selected.current = null;
    setCourseId(next);
    setDetail(null);
    setChapterId('');
  }, [courses, courseId]);
  return (
    <>
      <AssistantWorkspace
        token={token}
        user={user}
        courses={courses}
        courseId={courseId}
        onCourse={changeCourse}
        chapters={chapters}
        chapterId={chapterId}
        onChapter={changeScope}
        threads={threads}
        activeThread={detail?.thread}
        onNew={() => newThread(chapterId)}
        onThread={(id) => safely(() => chooseThread(id))}
        onRename={rename}
        onDelete={remove}
        hasMore={hasMore}
        onMore={() => safely(() => list(courseId, page + 1))}
        question={question}
        onQuestion={edit}
        model={model}
        onModel={setModel}
        availableModels={models}
        messages={detail?.messages || []}
        asking={!!running}
        loading={loading}
        working={working}
        error={error}
        notice={notice}
        onAsk={send}
        onStop={stop}
        onRetry={(message) => send(null, message.id)}
        onCopy={copy}
        onPractice={(message) =>
          setPracticeMessage({ messageId: message.id, threadId: detail.thread.id })
        }
        practiceDrafts={detail?.practiceDrafts || []}
        onSource={source}
        onCourses={onCourses}
        onOpenNotes={onOpenNotes}
        Answer={Answer}
      />
      {dialog && (
        <ScholarDialog
          title={
            dialog.kind === 'rename'
              ? '重命名对话'
              : dialog.kind === 'delete'
                ? '删除这段对话？'
                : '资料出处'
          }
          busy={working}
          onClose={() => setDialog(null)}
        >
          {dialog.kind === 'rename' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                confirmDialog();
              }}
            >
              <label>
                对话名称
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={dialog.value}
                  onChange={(e) => setDialog((d) => ({ ...d, value: e.target.value }))}
                />
              </label>
              <footer>
                <button type="button" onClick={() => setDialog(null)}>
                  取消
                </button>
                <button type="submit" disabled={working || !dialog.value.trim()}>
                  保存
                </button>
              </footer>
            </form>
          ) : dialog.kind === 'delete' ? (
            <>
              <p>删除“{dialog.thread.title}”及其对话记录？已保存的笔记和练习会保留。</p>
              <footer>
                <button type="button" onClick={() => setDialog(null)}>
                  保留对话
                </button>
                <button type="button" disabled={working} onClick={confirmDialog}>
                  删除对话
                </button>
              </footer>
            </>
          ) : (
            <>
              <p className="scholar-source-title">{dialog.source.name}</p>
              {dialog.source.chapterTitle && <small>{dialog.source.chapterTitle}</small>}
              {dialog.source.excerpt && <blockquote>{dialog.source.excerpt}</blockquote>}
              <footer>
                <button type="button" onClick={() => setDialog(null)}>
                  返回对话
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    safely(async () => {
                      await flushDraft();
                      await onOpenCourse(detail.thread.course_id, {
                        chapterId: dialog.source.chapterId,
                        materialId: dialog.source.materialId,
                      });
                    })
                  }
                >
                  阅读原资料 ↗
                </button>
              </footer>
            </>
          )}
          {error && (
            <p className="scholar-error" role="alert">
              {error}
            </p>
          )}
        </ScholarDialog>
      )}
      {practiceMessage && (
        <PracticeDialog
          key={practiceMessage.messageId}
          message={(detail?.messages || []).find((m) => m.id === practiceMessage.messageId)}
          chapters={chapters}
          chapterId={detail?.thread.chapter_id}
          drafts={(detail?.practiceDrafts || []).filter(
            (d) => d.message_id === practiceMessage.messageId,
          )}
          busy={working}
          error={error}
          onClose={() => setPracticeMessage(null)}
          onGenerate={generatePractice}
          onAdopt={adopt}
          onStop={(draft) =>
            safely(async () => {
              await api(`threads/${selected.current}/practices/${draft.id}/stop`, {
                method: 'POST',
                body: {},
              });
              await refresh();
            })
          }
        />
      )}
    </>
  );
}

export function ScholarDialog({ title, busy, onClose, children }) {
  return (
    <div
      className="modal-backdrop account-backdrop scholar-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <PaperDialog className="scholar-dialog" aria-label={title} busy={busy} onDismiss={onClose}>
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-close"
            aria-label="关闭弹窗"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </PaperDialog>
    </div>
  );
}
function PracticeDialog({
  message,
  chapters,
  chapterId,
  drafts,
  busy,
  error,
  onClose,
  onGenerate,
  onAdopt,
  onStop,
}) {
  const [chapter, setChapter] = useState(String(chapterId || chapters[0]?.id || '')),
    [count, setCount] = useState(3),
    [difficulty, setDifficulty] = useState('适中');
  const draft = drafts[0];
  return (
    <ScholarDialog title="以问促学" busy={busy} onClose={onClose}>
      {!message ? (
        <p>请重新打开原对话查看练习。</p>
      ) : (
        <>
          <p className="scholar-dialog-intro">围绕这次讨论，做几道题巩固理解。</p>
          {(!draft || ['failed', 'stopped'].includes(draft.status)) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onGenerate(message, {
                  chapterId: Number(chapter),
                  count: Number(count),
                  difficulty,
                });
              }}
            >
              <label>
                保存到章节
                <select
                  aria-label="练习所属章节"
                  value={chapter}
                  onChange={(e) => setChapter(e.target.value)}
                  required
                >
                  {!chapters.length && <option value="">请先为课程添加章节</option>}
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="scholar-form-row">
                <label>
                  题量
                  <select
                    aria-label="练习题量"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} 道
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  难度
                  <select
                    aria-label="练习难度"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                  >
                    {['基础', '适中', '提高'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
              {draft && (
                <p className="scholar-error">
                  {draft.error_text || '上次生成未完成，可重新生成。'}
                </p>
              )}
              <footer>
                <button type="button" onClick={onClose}>
                  返回对话
                </button>
                <button type="submit" disabled={busy || !chapter}>
                  生成并预览
                </button>
              </footer>
            </form>
          )}
          {draft?.status === 'running' && (
            <div className="scholar-practice-generating" role="status">
              <p>正在整理这次讨论的练习…</p>
              <small>可以先返回对话，完成后再来查看。</small>
              <footer>
                <button type="button" disabled={busy} onClick={() => onStop(draft)}>
                  停止生成
                </button>
                <button type="button" onClick={onClose}>
                  返回对话
                </button>
              </footer>
            </div>
          )}
          {['ready', 'adopted'].includes(draft?.status) && (
            <>
              <div className="scholar-practice-preview">
                {draft.questions.map((q, i) => (
                  <article key={i}>
                    <small>
                      第 {i + 1} 题 · {q.type}
                    </small>
                    <h3>{q.question}</h3>
                    {q.options.map((o, j) => (
                      <p key={j}>{o}</p>
                    ))}
                    <details>
                      <summary>查看答案与解析</summary>
                      <p>{q.answer}</p>
                      <p>{q.analysis}</p>
                    </details>
                  </article>
                ))}
              </div>
              <footer>
                <button type="button" disabled={busy} onClick={() => onAdopt(draft, false)}>
                  {draft.status === 'adopted' ? '已存入章节' : '保存练习'}
                </button>
                <button type="button" disabled={busy} onClick={() => onAdopt(draft, true)}>
                  开始练习 ↗
                </button>
              </footer>
            </>
          )}
        </>
      )}
      {error && (
        <p className="scholar-error" role="alert">
          {error}
        </p>
      )}
    </ScholarDialog>
  );
}
