import './study-page-hero.css';
import React, { useRef, useState } from 'react';
import CourseCover from './CourseCover.jsx';
import { formatDateTime } from './date-format.mjs';
import './course-shelf.css';

function ShelfIcon({ kind, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {kind === 'search' ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </>
      ) : kind === 'upload' ? (
        <>
          <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
        </>
      ) : kind === 'list' ? (
        <>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="3" cy="6" r=".5" />
          <circle cx="3" cy="12" r=".5" />
          <circle cx="3" cy="18" r=".5" />
        </>
      ) : kind === 'pin' ? (
        <>
          <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
          <path d="M12 15v6" />
        </>
      ) : kind === 'plan' ? (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4m8-4v4M4 10h16m-9 4h5" />
        </>
      ) : kind === 'library' ? (
        <>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z" />
          <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H19" />
          <path d="M8.5 7.5h7m-7 3.5h5" />
        </>
      ) : kind === 'edit' ? (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </>
      ) : kind === 'trash' ? (
        <>
          <path d="M4 7h16m-10 4v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
        </>
      ) : (
        <path d="M12 5v14m-9-1V4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2Z" />
      )}
    </svg>
  );
}

function CourseGuide({ onCreate }) {
  const dialog = useRef(null);
  return (
    <>
      <aside className="shelf-guide">
        <div className="shelf-guide-art" aria-hidden="true" />
        <div className="shelf-guide-copy">
          <h2>学习，从一页开始</h2>
          <p>把课本与讲义收进书架，让每一次学习都有迹可循。</p>
        </div>
        <span className="shelf-seal shelf-guide-seal" aria-hidden="true">
          研习
        </span>
        <button
          type="button"
          className="shelf-guide-link"
          onClick={() => dialog.current.showModal()}
        >
          了解如何整理课程 <span aria-hidden="true">↗</span>
        </button>
      </aside>
      <dialog
        ref={dialog}
        className="student-paper-frame shelf-help"
        aria-labelledby="shelf-help-title"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <header>
          <h2 id="shelf-help-title">课程整理指南</h2>
          <span className="shelf-seal" aria-hidden="true">
            研习
          </span>
          <button type="button" aria-label="关闭课程引导" onClick={() => dialog.current.close()}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="shelf-help-body">
          <p className="shelf-help-intro">从一份资料开始，按自己的节奏整理。</p>
          <ol>
            <li>
              <span className="shelf-help-icon">
                <ShelfIcon kind="upload" />
              </span>
              <div>
                <strong>收好学习资料</strong>
                <p>选择或直接拖入 PDF、Word、PPT，填写课程名称。多份资料也可以放进同一门课程。</p>
              </div>
            </li>
            <li>
              <span className="shelf-help-icon">
                <ShelfIcon kind="list" />
              </span>
              <div>
                <strong>整理章节目录</strong>
                <p>进入课程后，根据资料生成章节，再按需要调整名称与顺序。</p>
              </div>
            </li>
            <li>
              <span className="shelf-help-icon">
                <ShelfIcon />
              </span>
              <div>
                <strong>边学边记录</strong>
                <p>阅读、记笔记、做练习、问助手。下次回来，可以从上次停下的章节继续。</p>
              </div>
            </li>
          </ol>
        </div>
        <footer>
          <button type="button" className="shelf-help-back" onClick={() => dialog.current.close()}>
            返回书架
          </button>
          <button
            type="button"
            className="shelf-primary"
            onClick={() => {
              dialog.current.close();
              onCreate();
            }}
          >
            添加课程
          </button>
        </footer>
      </dialog>
    </>
  );
}

const isComplete = (course) =>
  Number(course.chapter_count) > 0 &&
  Number(course.completed_count) >= Number(course.chapter_count);
const coursePercent = (course) => {
  const total = Math.max(0, Number(course.chapter_count) || 0);
  const completed = Math.min(total, Math.max(0, Number(course.completed_count) || 0));
  return total ? Math.round((completed / total) * 100) : 0;
};
const PIN_STORAGE_KEY = 'math-auth-pinned-courses';
const readPinnedIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export default function CourseShelf({
  token,
  courses,
  loading,
  recent,
  onOpen,
  onCreate,
  onPlan,
  onMaterials,
  onEdit,
  onDelete,
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [pinnedIds, setPinnedIds] = useState(readPinnedIds);
  const [dragging, setDragging] = useState(false);
  const [dropNotice, setDropNotice] = useState('');
  const dragDepth = useRef(0);

  const togglePin = (courseId) => {
    const id = Number(courseId);
    setPinnedIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
      try {
        localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const done = courses.filter(isComplete).length;
  const counts = { all: courses.length, learning: courses.length - done, done };
  const visible = courses
    .filter(
      (course) =>
        (filter === 'all' || (filter === 'done' ? isComplete(course) : !isComplete(course))) &&
        `${course.title} ${course.description || ''}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .slice()
    .sort((a, b) => {
      const aPin = pinnedIds.includes(Number(a.id)) ? 1 : 0;
      const bPin = pinnedIds.includes(Number(b.id)) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      if (sort === 'progress') {
        const diff = coursePercent(b) - coursePercent(a);
        if (diff !== 0) return diff;
        return (Number(b.completed_count) || 0) - (Number(a.completed_count) || 0);
      }
      if (sort === 'created') {
        const aTime = Date.parse(a.created_at || '') || 0;
        const bTime = Date.parse(b.created_at || '') || 0;
        if (aTime !== bTime) return bTime - aTime;
        return Number(b.id) - Number(a.id);
      }
      const aRecent = Number(recent?.course_id) === Number(a.id) ? 1 : 0;
      const bRecent = Number(recent?.course_id) === Number(b.id) ? 1 : 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      const aActive = Date.parse(a.last_studied_at || a.updated_at || a.created_at || '') || 0;
      const bActive = Date.parse(b.last_studied_at || b.updated_at || b.created_at || '') || 0;
      if (aActive !== bActive) return bActive - aActive;
      return Number(b.id) - Number(a.id);
    });

  const handleDropFiles = (event) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = [...(event.dataTransfer?.files || [])];
    if (!dropped.length) return;
    const valid = dropped.filter((file) => /\.(pdf|docx|pptx)$/i.test(file.name));
    if (!valid.length) {
      setDropNotice('请拖入 PDF、Word (.docx) 或 PPT (.pptx) 格式资料');
      return;
    }
    setDropNotice('');
    onCreate(valid);
  };

  return (
    <section className="course-shelf" aria-labelledby="course-shelf-title">
      <header className="shelf-hero">
        <img src="/assets/ink/course-shelf-scholar-v4.png" alt="" />
        <div>
          <p className="shelf-kicker">
            我的书架 <span aria-hidden="true">｜</span>
          </p>
          <h1 id="course-shelf-title">我的课程</h1>
          <p className="shelf-intro">展卷拾知，循序致远。</p>
        </div>
      </header>
      <div className="shelf-toolbar">
        <div className="shelf-filters" role="group" aria-label="筛选课程">
          {[
            ['all', '全部课程'],
            ['learning', '学习中'],
            ['done', '已完成'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span>{loading ? '—' : counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="shelf-tools">
          <label className="shelf-search">
            <ShelfIcon kind="search" />
            <input
              type="search"
              aria-label="搜索课程"
              placeholder="搜索课程…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
            />
            {query && (
              <button
                type="button"
                className="shelf-search-clear"
                aria-label="清除课程搜索"
                onClick={() => setQuery('')}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </label>
          <label className="shelf-sort" aria-label="课程排序">
            <select
              aria-label="课程排序方式"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">按最近学习</option>
              <option value="progress">按学习进度</option>
              <option value="created">按加入时间</option>
            </select>
          </label>
        </div>
      </div>
      <div className="shelf-layout">
        <div className="shelf-course-list" aria-busy={loading}>
          {loading ? (
            <div className="shelf-empty" role="status">
              <ShelfIcon />
              <h2>正在整理你的书架…</h2>
            </div>
          ) : visible.length ? (
            visible.map((course) => {
              const total = Math.max(0, Number(course.chapter_count) || 0),
                completed = Math.min(total, Math.max(0, Number(course.completed_count) || 0)),
                percent = total ? Math.round((completed / total) * 100) : 0;
              const materials = Math.max(0, Number(course.material_count) || 0),
                notes = Math.max(0, Number(course.note_count) || 0),
                practices = Math.max(0, Number(course.practice_count) || 0);
              const pinned = pinnedIds.includes(Number(course.id));
              const resume = Number(recent?.course_id) === Number(course.id) ? recent : null;
              return (
                <article
                  className="shelf-course"
                  data-complete={isComplete(course)}
                  data-pinned={pinned || undefined}
                  key={course.id}
                >
                  <button
                    type="button"
                    className="shelf-cover-button"
                    aria-label={`查看${course.title}的章节目录`}
                    onClick={() => onOpen(course)}
                  >
                    <CourseCover
                      token={token}
                      courseId={course.id}
                      title={course.title}
                      className="shelf-book"
                    />
                  </button>
                  <div className="shelf-course-body">
                    <div className="shelf-course-head">
                      <div className="shelf-course-badges">
                        <span className="shelf-course-state">
                          {course.admin_status === 'paused'
                            ? '已暂停'
                            : isComplete(course)
                              ? '已学完'
                              : '研习中'}
                        </span>
                        {pinned && <span className="shelf-pin-badge">案头置顶</span>}
                      </div>
                      <div
                        className="shelf-course-head-tools"
                        role="group"
                        aria-label={`${course.title}管理`}
                      >
                        <button
                          type="button"
                          className={pinned ? 'shelf-pin-btn is-pinned' : 'shelf-pin-btn'}
                          aria-pressed={pinned}
                          title={pinned ? '取消案头置顶' : '设为案头置顶'}
                          onClick={() => togglePin(course.id)}
                        >
                          <ShelfIcon kind="pin" />
                          <span>{pinned ? '已置顶' : '置顶'}</span>
                        </button>
                        {onEdit && (
                          <button
                            type="button"
                            className="shelf-pin-btn"
                            title="修改课程名称与简介"
                            onClick={() => onEdit(course)}
                          >
                            <ShelfIcon kind="edit" />
                            <span>编辑课程</span>
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            className="shelf-pin-btn is-danger"
                            title="删除课程"
                            onClick={() => onDelete(course)}
                          >
                            <ShelfIcon kind="trash" />
                            <span>删除</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <h2>{course.title}</h2>
                    <p className="shelf-course-description">
                      {course.description || '收好资料，按自己的节奏学习。'}
                    </p>
                    {course.admin_status === 'paused' ? (
                      <p className="shelf-current">
                        {course.admin_reason || '课程已暂停'}
                        {course.admin_changed_at && (
                          <time>{formatDateTime(course.admin_changed_at)}</time>
                        )}
                      </p>
                    ) : (
                      <p className="shelf-current">
                        {resume?.chapter_title
                          ? `上次学习 · ${resume.chapter_title}`
                          : total
                            ? `章节目录 · 共 ${total} 章`
                            : '导入完成，进入课程整理章节'}
                      </p>
                    )}
                    <div className="shelf-course-traces" aria-label="研习积累统计">
                      <span>
                        <b>{materials}</b> 份资料
                      </span>
                      <i aria-hidden="true">·</i>
                      <span>
                        <b>{total}</b> 章目录
                      </span>
                      <i aria-hidden="true">·</i>
                      <span>
                        <b>{notes}</b> 篇笔记
                      </span>
                      <i aria-hidden="true">·</i>
                      <span>
                        <b>{practices}</b> 套练习
                      </span>
                    </div>
                    <div className="shelf-progress">
                      <div>
                        <span>{total ? `已完成 ${completed} / ${total} 章` : '尚未添加章节'}</span>
                        <span>{percent}%</span>
                      </div>
                      <progress
                        value={completed}
                        max={total || 1}
                        aria-label={`${course.title}学习进度 ${percent}%`}
                      />
                    </div>
                    <div className="shelf-course-actions">
                      <button
                        type="button"
                        className="shelf-primary"
                        onClick={() =>
                          onOpen(
                            course,
                            resume?.chapter_id
                              ? {
                                  chapterId: resume.chapter_id,
                                  tab: 'materials',
                                  resumeReading: true,
                                }
                              : undefined,
                          )
                        }
                      >
                        {isComplete(course) ? '回顾课程' : total ? '继续学习' : '整理课程'}{' '}
                        <span aria-hidden="true">→</span>
                      </button>
                      <button
                        type="button"
                        className="shelf-directory"
                        onClick={() => onOpen(course)}
                      >
                        <ShelfIcon kind="list" />
                        查看目录
                      </button>
                      {onMaterials && (
                        <button
                          type="button"
                          className="shelf-directory"
                          onClick={() => onMaterials(course)}
                        >
                          <ShelfIcon kind="library" />
                          资料库
                        </button>
                      )}
                      {onPlan && (
                        <button
                          type="button"
                          className="shelf-directory"
                          onClick={() => onPlan(course)}
                        >
                          <ShelfIcon kind="plan" />
                          学习计划
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="shelf-empty">
              <ShelfIcon />
              <h2>
                {query.trim()
                  ? '没有找到匹配的课程'
                  : courses.length
                    ? filter === 'done'
                      ? '尚无已完成的课程'
                      : '课程已全部学完'
                    : '书架，等你放上第一本书'}
              </h2>
              <p>
                {query.trim()
                  ? '换个关键词试试，也可以查看全部课程。'
                  : courses.length
                    ? filter === 'done'
                      ? '每学完一章，都会离完成更近一步。'
                      : '可以回顾已学内容，或开启一门新课程。'
                    : '导入课本、讲义或学习资料，建立自己的课程。'}
              </p>
              {courses.length > 0 && (
                <button
                  type="button"
                  className="shelf-directory"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  查看全部课程 →
                </button>
              )}
            </div>
          )}
        </div>
        <aside
          className="shelf-import"
          data-dragging={dragging || undefined}
          aria-labelledby="shelf-import-title"
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={handleDropFiles}
        >
          <img className="shelf-import-art" src="/assets/ink/course-import-papers-v2.png" alt="" />
          <h2 id="shelf-import-title">{dragging ? '松开鼠标，收录资料' : '添加一门新课程'}</h2>
          <p>
            {dragging ? '将自动带入文件并预填课程名称' : '收录课本与讲义，或直接将文件拖入此处。'}
          </p>
          <small>支持拖拽 · PDF · Word · PPT</small>
          {dropNotice && (
            <span className="shelf-drop-notice" role="status">
              {dropNotice}
            </span>
          )}
          <button type="button" className="shelf-import-button" onClick={() => onCreate()}>
            <ShelfIcon kind="upload" />
            选择资料
          </button>
        </aside>
      </div>
      <CourseGuide onCreate={() => onCreate()} />
      <footer className="shelf-footer">
        <span>数有方 · 让学习有迹可循</span>
      </footer>
    </section>
  );
}
