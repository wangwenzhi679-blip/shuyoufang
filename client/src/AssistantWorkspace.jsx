import React, { useEffect, useRef, useState } from 'react';
import { formatDateTime, parseDisplayDate } from './date-format.mjs';
import CourseCover from './CourseCover.jsx';
import { NoteExcerpt } from './LearningNotes';
import './assistant-workspace.css';
import './assistant-upgrade.css';
import './assistant-polish.css';

export function ScholarIcon({ kind = 'orbit', ...props }) {
  const paths = {
    book: (
      <>
        <path d="M16 9C11 5 6 6 3 8v19c5-3 9-2 13 0 4-2 8-3 13 0V8c-3-2-8-3-13 1Zm0 0v18M7 12c2-1 4 0 5 1m8 0c2-1 4-2 5-1" />
      </>
    ),
    light: (
      <>
        <path d="M10 20c-8-9 0-19 8-16 8 3 7 11 3 16l-1 5h-9Zm3 9h5M16 24V14m-4-2 4 3 4-3" />
      </>
    ),
    chat: <path d="M27 20a13 10 0 1 0-18 4l-2 5 7-3c5 0 10-2 13-6Z" />,
    file: <path d="M8 3h11l6 6v20H8ZM18 3v8h7M12 16h9m-9 5h9" />,
    network: (
      <>
        <path d="m14 9-6 12m10-12 6 12M11 25h10" />
        <circle cx="16" cy="6" r="4" />
        <circle cx="6" cy="25" r="4" />
        <circle cx="26" cy="25" r="4" />
      </>
    ),
    sprout: (
      <>
        <path d="M16 29V17M16 23C6 23 3 16 4 8c8 0 13 4 12 15Zm0-5c0-8 5-13 13-14 0 8-3 15-13 14ZM8 13l8 10m8-13-8 8" />
      </>
    ),
    note: (
      <>
        <path d="M8 4h14v24H5V7h3m2-3h9v5h-9Zm1 10h7m-7 5h7" />
        <path d="m20 21 7-8 3 3-7 8-4 1Z" />
      </>
    ),
    copy: (
      <>
        <rect x="10" y="7" width="17" height="21" rx="2" />
        <path d="M21 7V3H5v21h5" />
      </>
    ),
    refresh: (
      <>
        <path d="M26 12a11 11 0 1 0 1 9M26 4v8h-8" />
      </>
    ),
    edit: (
      <>
        <path d="m7 21 14-14a3 3 0 0 1 4 4L11 25l-6 2Zm11-11 4 4M5 29h23" />
      </>
    ),
    arrow: <path d="M16 26V6m-8 8 8-8 8 8" />,
    link: <path d="M8 24 24 8M10 8h14v14" />,
    plus: <path d="M16 6v20M6 16h20" />,
  };
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[kind] || (
        <>
          <ellipse cx="16" cy="16" rx="15" ry="7" transform="rotate(-28 16 16)" />
          <circle cx="16" cy="16" r="6" fill="currentColor" opacity=".23" stroke="none" />
          <circle cx="27" cy="5" r="2" fill="currentColor" stroke="none" />
          <circle cx="7" cy="27" r="2" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

const openingPrompts = [
  {
    label: '梳理重点',
    icon: 'book',
    draft: '请梳理当前学习范围的重要概念，并说明它们之间的联系。',
  },
  { label: '讲解难点', icon: 'light', draft: '请用容易理解的话，结合资料中的例子解释：' },
];
function recentLabel(value) {
  const date = parseDisplayDate(value);
  if (!date) return '时间未知';
  const now = new Date(),
    day = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  if (now - date >= 0 && now - date < 60000) return '刚刚';
  const time = formatDateTime(date, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (day.format(date) === day.format(now)) return '今天 ' + time;
  if (day.format(date) === day.format(new Date(now.getTime() - 86400000))) return '昨天 ' + time;
  return formatDateTime(date, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function StudyVignette() {
  return (
    <div className="scholar-study-scene" aria-hidden="true">
      <div className="scholar-study-map">
        <svg
          className="scholar-study-links"
          viewBox="0 0 240 166"
          fill="none"
          preserveAspectRatio="none"
        >
          <path d="M120 24C91 39 54 59 43 94M120 24c29 15 66 35 77 70M43 98c0 40 77 26 77 65m77-65c0 40-77 26-77 65" />
        </svg>
        <div className="scholar-study-node scholar-study-node-source">
          <span>
            <ScholarIcon kind="file" />
          </span>
          <small>课程资料</small>
        </div>
        <div className="scholar-study-node scholar-study-node-knowledge">
          <span>
            <ScholarIcon kind="network" />
          </span>
          <small>知识梳理</small>
        </div>
        <div className="scholar-study-node scholar-study-node-guidance">
          <span>
            <ScholarIcon kind="sprout" />
          </span>
          <small>学习建议</small>
        </div>
      </div>
      <img className="scholar-study-book" src="/assets/ink/course-guide-notebook-v2.png" alt="" />
      <span className="scholar-study-seal">知行</span>
      <span className="scholar-study-caption">积问成知 · 循思而进</span>
    </div>
  );
}

function AnswerTools({
  message,
  token,
  courses,
  courseId,
  chapterId,
  onSource,
  onCopy,
  onRetry,
  onOpenNotes,
  onPractice,
  working,
  asking,
  scopeAvailable,
  hasChapters,
}) {
  const sources = (message.sources || []).filter(
    (source, index, items) =>
      items.findIndex(
        (item) =>
          item.materialId === source.materialId &&
          item.excerpt === source.excerpt &&
          item.name === source.name,
      ) === index,
  );
  return (
    <div className="scholar-answer-tools">
      {sources.length > 0 && (
        <div className="scholar-sources">
          <span className="scholar-sources-label">
            <ScholarIcon kind="file" />
            资料出处
          </span>
          {sources.map((source, index) => (
            <button
              type="button"
              className="scholar-source-name"
              key={index}
              disabled={working}
              aria-label={`查看资料来源：${source.name}`}
              title={[source.name, source.chapterTitle].filter(Boolean).join(' · ')}
              onClick={() => onSource(message, source)}
            >
              <span>{source.chapterTitle || source.name.replace(/\.(pdf|docx|pptx)$/i, '')}</span>
              <ScholarIcon kind="link" />
            </button>
          ))}
        </div>
      )}
      <div className="scholar-action-group">
        {message.content && (
          <button type="button" className="scholar-text-action" onClick={() => onCopy(message)}>
            <ScholarIcon kind="copy" />
            复制
          </button>
        )}
        <button
          type="button"
          className="scholar-text-action"
          disabled={working || asking || !scopeAvailable}
          onClick={() => onRetry(message)}
        >
          <ScholarIcon kind="refresh" />
          {message.status === 'failed' ? '重试' : '重新生成'}
        </button>
        {message.status === 'completed' && (
          <>
            <NoteExcerpt
              icon={<ScholarIcon kind="note" />}
              token={token}
              courses={courses}
              courseId={courseId}
              chapterId={chapterId || undefined}
              onView={onOpenNotes}
              source="AI 回答"
              content={message.content}
            />
            <button
              type="button"
              className="scholar-text-action scholar-practice-action"
              disabled={working || !hasChapters}
              title={!hasChapters ? '请先为课程添加章节' : undefined}
              onClick={() => onPractice(message)}
            >
              <ScholarIcon kind="file" />
              生成练习
              <ScholarIcon kind="link" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AssistantWorkspace({
  token,
  user,
  courses,
  courseId,
  onCourse,
  chapters,
  chapterId,
  onChapter,
  threads,
  activeThread,
  onNew,
  onThread,
  onRename,
  onDelete,
  hasMore,
  onMore,
  question,
  onQuestion,
  model,
  onModel,
  availableModels,
  messages,
  asking,
  loading,
  working,
  error,
  notice,
  onAsk,
  onStop,
  onRetry,
  onCopy,
  onPractice,
  practiceDrafts,
  onSource,
  onCourses,
  onOpenNotes,
  Answer,
}) {
  const input = useRef(null),
    conversation = useRef(null),
    follow = useRef(true);
  const [historyOpen, setHistoryOpen] = useState(
    () => window.matchMedia('(min-width:851px)').matches,
  );
  const activeCourse = courses.find((course) => String(course.id) === String(courseId));
  const lastAnswer = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'completed');
  useEffect(() => {
    follow.current = true;
  }, [activeThread?.id]);
  useEffect(() => {
    const list = conversation.current;
    if (list && follow.current) list.scrollTo({ top: list.scrollHeight, behavior: 'instant' });
  }, [messages, asking, activeThread?.id]);
  useEffect(() => {
    const list = conversation.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) list.scrollTo({ top: list.scrollHeight, behavior: 'instant' });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [courseId]);
  const fill = (text) => {
    onQuestion(text);
    input.current?.focus({ preventScroll: true });
  };
  const submit = (event) => {
    follow.current = true;
    onAsk(event);
  };
  const scopeAvailable = activeThread?.scope_available !== false;
  const scopeTitle = chapterId
    ? chapters.find((chapter) => String(chapter.id) === chapterId)?.title ||
      activeThread?.chapter_title
    : '整门课程';
  const dateTime = (message) =>
    !activeThread?.import_key && message.created_at ? (
      <time dateTime={message.created_at}>
        {formatDateTime(message.created_at, { hour: '2-digit', minute: '2-digit', hour12: false })}
      </time>
    ) : null;

  return (
    <section
      className="scholar-assistant scholar-assistant-v2 scholar-assistant-v3"
      aria-labelledby="scholar-assistant-title"
    >
      <header className="scholar-heading">
        <div>
          <h1 id="scholar-assistant-title">学习助手</h1>
          <p>问有所思，学有所悟。</p>
        </div>
        <span className="scholar-seal" aria-hidden="true">
          研习
        </span>
      </header>
      {!courses.length ? (
        <div className="scholar-no-course">
          <ScholarIcon kind="book" />
          <h2>展卷，开启一段研习</h2>
          <p>将课本与讲义收进书架，从课程里的一个问题开始。</p>
          <button type="button" onClick={onCourses}>
            前往我的课程 ↗
          </button>
        </div>
      ) : (
        <div className="scholar-workbench">
          <aside className="scholar-context" aria-label="研习档案">
            <div className="scholar-course-block">
              <h2>
                研习档案 <span>学习范围</span>
              </h2>
              <div className="scholar-selected-course">
                <CourseCover token={token} courseId={courseId} title={activeCourse?.title} />
                <div>
                  <select
                    value={courseId}
                    aria-label="选择提问课程"
                    disabled={working}
                    onChange={(event) => onCourse(event.target.value)}
                  >
                    {courses.map((course) => (
                      <option value={course.id} key={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                  <span>{chapters.length} 个章节</span>
                </div>
              </div>
              <label className="scholar-scope-label">
                本次研习
                <select
                  aria-label="选择问答章节"
                  value={chapterId}
                  disabled={working || loading}
                  onChange={(event) => onChapter(event.target.value)}
                >
                  <option value="">整门课程</option>
                  {!scopeAvailable &&
                    chapterId &&
                    !chapters.some((chapter) => String(chapter.id) === chapterId) && (
                      <option value={chapterId}>原章节已删除</option>
                    )}
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="scholar-new-thread"
              disabled={working || loading}
              onClick={onNew}
            >
              <ScholarIcon kind="plus" />
              新的研习
            </button>
            <details
              className="scholar-history"
              open={historyOpen}
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
            >
              <summary>
                最近对话{' '}
                <span>
                  {threads.length ? `${threads.length}${hasMore ? '＋' : ''}` : '尚无记录'}
                </span>
              </summary>
              <nav aria-label="对话记录">
                {!threads.length && !loading && (
                  <p className="scholar-history-empty">每一个问题，都值得留下一页。</p>
                )}
                {threads.map((thread) => (
                  <div
                    className={`scholar-thread ${thread.id === activeThread?.id ? 'is-active' : ''}`}
                    key={thread.id}
                  >
                    <button
                      type="button"
                      className="scholar-thread-select"
                      aria-current={thread.id === activeThread?.id ? 'true' : undefined}
                      disabled={working}
                      title={thread.title}
                      onClick={() => onThread(thread.id)}
                    >
                      <span className="scholar-thread-icon">
                        {thread.running ? <i aria-label="生成中" /> : <ScholarIcon kind="chat" />}
                      </span>
                      <span className="scholar-thread-copy">
                        <span className="scholar-thread-title">{thread.title}</span>
                        <small title={thread.chapter_title || '整门课程'}>
                          {thread.chapter_title || '整门课程'} · {recentLabel(thread.updated_at)}
                        </small>
                      </span>
                    </button>
                    <div className="scholar-thread-actions">
                      <button
                        type="button"
                        aria-label={`重命名：${thread.title}`}
                        disabled={working}
                        onClick={() => onRename(thread)}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        aria-label={`删除：${thread.title}`}
                        disabled={working}
                        onClick={() => onDelete(thread)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {hasMore && (
                  <button
                    type="button"
                    className="scholar-load-more"
                    disabled={working}
                    onClick={onMore}
                  >
                    更早的对话 ↓
                  </button>
                )}
              </nav>
            </details>
            <StudyVignette />
          </aside>
          <div className="scholar-chat-panel">
            <header className="scholar-chat-heading">
              <span className="scholar-chat-emblem" aria-hidden="true">
                <ScholarIcon />
              </span>
              <div className="scholar-chat-identity">
                <div className="scholar-chat-title-line">
                  <h2 title={activeThread?.title || '研习助手'}>
                    {activeThread?.title || '研习助手'}
                  </h2>
                  {activeThread && (
                    <button
                      type="button"
                      className="scholar-chat-rename"
                      aria-label="修改对话名称"
                      title="修改对话名称"
                      disabled={working || loading}
                      onClick={() => onRename(activeThread)}
                    >
                      <ScholarIcon kind="edit" />
                    </button>
                  )}
                </div>
                <p
                  className="scholar-chat-scope"
                  title={[activeCourse?.title, scopeTitle].filter(Boolean).join(' · ')}
                >
                  <span>{activeCourse?.title}</span>
                  <i aria-hidden="true" />
                  <span>{scopeTitle}</span>
                </p>
              </div>
              <span
                className={`scholar-context-badge${asking ? ' is-reading' : ''}`}
                role={asking ? 'status' : undefined}
              >
                <ScholarIcon kind="book" />
                {asking ? '正在研读' : '依据课程资料'}
              </span>
            </header>
            <div
              className="scholar-conversation"
              ref={conversation}
              tabIndex={0}
              role="region"
              aria-label="学习对话"
              aria-busy={asking || loading}
              onScroll={(event) => {
                const element = event.currentTarget;
                follow.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 100;
              }}
            >
              {loading ? (
                <div className="scholar-loading" role="status">
                  <ScholarIcon />
                  <p>正在展开研习记录…</p>
                </div>
              ) : !messages.length ? (
                <div className="scholar-greeting">
                  <ScholarIcon />
                  <h3>一问一答，渐入其境</h3>
                  <p>
                    从一个概念、一处难点开始，
                    <br />
                    一起读懂《{activeCourse?.title}》。
                  </p>
                  <div className="scholar-greeting-prompts">
                    {openingPrompts.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        disabled={working}
                        onClick={() => fill(item.draft)}
                      >
                        <ScholarIcon kind={item.icon} />
                        {item.label}
                        <ScholarIcon kind="link" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    className={`scholar-message scholar-message-${message.role}`}
                    key={message.id}
                  >
                    {message.role === 'assistant' && (
                      <div className="scholar-message-mark">
                        <ScholarIcon />
                      </div>
                    )}
                    <div className="scholar-message-content">
                      {message.role === 'user' ? (
                        <>
                          <p>{message.content}</p>
                          {dateTime(message)}
                        </>
                      ) : (
                        <>
                          <div className="scholar-speaker">
                            学习助手{message.regenerates_id && <small> · 重新生成</small>}
                            {dateTime(message)}
                          </div>
                          <div className="scholar-answer-card">
                            {message.content ? (
                              <Answer content={message.content} />
                            ) : message.status === 'running' ? (
                              <div className="scholar-thinking" role="status">
                                <span>正在研读课程资料</span>
                                <i />
                                <i />
                                <i />
                              </div>
                            ) : null}
                            {message.status === 'running' && message.content && (
                              <span className="scholar-stream-cursor" aria-hidden="true" />
                            )}
                            {['failed', 'stopped'].includes(message.status) && (
                              <p className="scholar-message-state" role="status">
                                {message.status === 'stopped'
                                  ? '已停止'
                                  : message.error_text || '生成失败'}
                                {message.content ? ' · 已保留收到的内容' : ''}
                              </p>
                            )}
                            {message.status !== 'running' && (
                              <AnswerTools
                                {...{
                                  message,
                                  token,
                                  courses,
                                  courseId,
                                  onSource,
                                  onCopy,
                                  onRetry,
                                  onOpenNotes,
                                  onPractice,
                                  working,
                                  asking,
                                  scopeAvailable,
                                }}
                                chapterId={activeThread?.chapter_id}
                                hasChapters={!!chapters.length}
                              />
                            )}
                          </div>
                          {message.id === lastAnswer?.id &&
                            !asking &&
                            message.followups?.length > 0 && (
                              <div className="scholar-followups" aria-label="接着想一想">
                                <span className="scholar-followups-label">
                                  <ScholarIcon kind="light" />
                                  接着想一想
                                </span>
                                {message.followups.map((text) => (
                                  <button
                                    key={text}
                                    type="button"
                                    disabled={working}
                                    onClick={() => fill(text)}
                                  >
                                    {text}
                                    <ScholarIcon kind="link" />
                                  </button>
                                ))}
                              </div>
                            )}
                          {practiceDrafts
                            .filter((draft) => draft.message_id === message.id)
                            .slice(0, 1)
                            .map((draft) => (
                              <button
                                className="scholar-practice-result"
                                type="button"
                                key={draft.id}
                                disabled={working}
                                onClick={() => onPractice(message)}
                              >
                                <ScholarIcon kind="book" />
                                <span>
                                  {draft.status === 'running'
                                    ? '练习正在生成…'
                                    : draft.status === 'ready'
                                      ? '练习已备好，预览后开始'
                                      : draft.status === 'adopted'
                                        ? '查看这次讨论的练习'
                                        : '练习未完成，查看详情'}
                                </span>
                                <ScholarIcon kind="link" />
                              </button>
                            ))}
                        </>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <span className="scholar-user-avatar" aria-hidden="true">
                        {user?.avatar ? (
                          <img src={user.avatar} alt="" />
                        ) : (
                          user?.nickname?.slice(0, 1) || '我'
                        )}
                      </span>
                    )}
                  </article>
                ))
              )}
            </div>
            <div className="scholar-input-area">
              {!scopeAvailable && (
                <p className="scholar-error">原章节已删除。记录仍保留，请选择新的范围开启研习。</p>
              )}
              <form className="scholar-composer" onSubmit={submit}>
                <textarea
                  ref={input}
                  aria-label="输入学习问题"
                  disabled={working || loading}
                  required
                  value={question}
                  maxLength={1000}
                  onChange={(event) => onQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      !event.isComposing
                    ) {
                      event.preventDefault();
                      if (question.trim() && !asking && !working && !loading && scopeAvailable)
                        submit(event);
                    }
                  }}
                  placeholder="写下你的问题，一起理清思路…"
                />
                <div className="scholar-composer-footer">
                  <span className="scholar-composer-hint">
                    <ScholarIcon kind="file" />
                    {question.length > 900
                      ? `${question.length} / 1000`
                      : '让每一次追问，都有据可循'}
                  </span>
                  <div className="scholar-model-send">
                    <select
                      aria-label="选择 AI 模型"
                      value={model}
                      onChange={(event) => onModel(event.target.value)}
                      disabled={working || asking}
                    >
                      {availableModels.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    {asking ? (
                      <button
                        className="scholar-send scholar-stop"
                        type="button"
                        aria-label="停止生成"
                        disabled={working}
                        onClick={onStop}
                      >
                        <span aria-hidden="true">■</span>
                      </button>
                    ) : (
                      <button
                        className="scholar-send"
                        type="submit"
                        aria-label="发送问题"
                        disabled={!question.trim() || working || loading || !scopeAvailable}
                      >
                        <ScholarIcon kind="arrow" />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              {error && (
                <p className="scholar-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="scholar-notice" role="status">
                  {notice}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <footer className="scholar-footer">数有方 · 让学习有迹可循</footer>
    </section>
  );
}
