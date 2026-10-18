import { requestJson } from './api-client.mjs';
import PaperDialog from './PaperDialog.jsx';
import './study-page-hero.css';
import React, { useEffect, useState } from 'react';
import CourseCover from './CourseCover.jsx';
import './learning-plans.css';

const api = (token, path, body, method = 'POST') =>
  requestJson(path, { token, body, method: body ? method : 'GET', errorMessage: '计划操作失败' });

const dateAfter = (date, days) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const names = { read: '阅读学习', notes: '整理笔记', practice: '章节练习' };
const shortNames = { read: '阅读', notes: '笔记', practice: '练习' };
const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
const fullWeekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatMonthDay(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function formatMonthDaySpaced(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const d = new Date(`${isoDate}T12:00:00Z`);
  return `${Number(parts[1])}月 ${Number(parts[2])}日 · ${fullWeekdayNames[d.getUTCDay()]}`;
}

function getMondayOfWeek(isoDate, weekOffset = 0) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return dateAfter(isoDate, diffToMonday + weekOffset * 7);
}

function formatWeekRange(mondayIso) {
  const sundayIso = dateAfter(mondayIso, 6);
  const [m1, d1] = mondayIso.split('-').slice(1).map(Number);
  const [m2, d2] = sundayIso.split('-').slice(1).map(Number);
  return m1 === m2 ? `${m1}月${d1}日 — ${d2}日` : `${m1}月${d1}日 — ${m2}月${d2}日`;
}

function TaskKindIcon({ kind }) {
  if (kind === 'practice') {
    return (
      <svg
        className="plan-kind-icon"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path
          d="M13.5 3.5 16.5 6.5 7 16H4v-3L13.5 3.5Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'notes') {
    return (
      <svg
        className="plan-kind-icon"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="4" y="3" width="12" height="14" rx="2" />
        <path d="M7 7h6M7 10.5h6M7 14h4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      className="plan-kind-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        d="M10 5c-2.2-1.2-4.6-1.2-7-.2v10.5c2.4-1 4.8-1 7 .2 2.2-1.2 4.6-1.2 7-.2V4.8c-2.4-1-4.8-1-7 .2Zm0 0v10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function useLearningPlans(token) {
  const [data, setData] = useState({
    plans: [],
    jobs: [],
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()),
  });
  const [error, setError] = useState('');
  const reload = () =>
    api(token, 'learning-plans')
      .then((next) => {
        setData(next);
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    let live = true;
    const load = () =>
      api(token, 'learning-plans')
        .then((next) => {
          if (live) {
            setData(next);
            setError('');
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token]);
  return { data, reload, error };
}

export function PlanTaskTray({ data, onOpen }) {
  const jobs = data.jobs.filter((j) => j.status === 'running' || j.status === 'done');
  if (!jobs.length) return null;
  return (
    <div className="plan-task-tray" role="status">
      <span>
        {jobs.filter((j) => j.status === 'running').length
          ? '学习计划正在后台生成'
          : '学习计划已生成，等待预览'}
      </span>
      <button onClick={onOpen}>查看计划</button>
    </div>
  );
}

function Modal({ title, children, footer, onClose, busy, variant }) {
  return (
    <div className="modal-backdrop">
      <PaperDialog
        busy={busy}
        onDismiss={onClose}
        className={`record-modal plan-dialog student-dialog-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button aria-label="关闭计划弹窗" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="plan-dialog-body">{children}</div>
        <footer className="rename-actions">{footer}</footer>
      </PaperDialog>
    </div>
  );
}

function PlanCourseBlock({
  plan,
  index,
  isExpanded,
  onToggleExpand,
  token,
  today,
  busy,
  savingTask,
  toggle,
  preview,
  begin,
  setModal,
  setError,
  onOpenTask,
  renderGardenTask,
}) {
  const [listTab, setListTab] = useState('pending');
  const [kindFilter, setKindFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isDoneExpanded, setIsDoneExpanded] = useState(false);

  const doneCount = plan.tasks.filter((t) => t.completedAt).length;
  const pendingTasks = plan.tasks.filter((t) => !t.completedAt);
  const doneTasks = plan.tasks.filter((t) => t.completedAt);
  const percent = plan.tasks.length ? Math.round((doneCount / plan.tasks.length) * 100) : 0;
  const doneTotalMinutes = doneTasks.reduce((sum, t) => sum + Number(t.minutes || 0), 0);

  const sortTasks = (list) => {
    const copy = [...list];
    if (sortBy === 'progress') {
      return copy.sort((a, b) => Number(b.readingProgress ?? 0) - Number(a.readingProgress ?? 0));
    }
    if (sortBy === 'kind') {
      return copy.sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
    }
    return copy.sort((a, b) => a.date.localeCompare(b.date));
  };

  const filterByKindAndDate = (list) =>
    sortTasks(
      list.filter(
        (t) =>
          (kindFilter === 'all' || t.kind === kindFilter) &&
          (!selectedDate || t.date === selectedDate),
      ),
    );

  const overdueList = filterByKindAndDate(pendingTasks.filter((t) => t.date < today));
  const upcomingList = filterByKindAndDate(pendingTasks.filter((t) => t.date >= today));
  const filteredDoneList = filterByKindAndDate(doneTasks);

  const activeFocusDate = selectedDate || today;
  const mondayIso = getMondayOfWeek(today, weekOffset);
  const weekDays = Array.from({ length: 7 }, (_, idx) => {
    const iso = dateAfter(mondayIso, idx);
    const dayNum = Number(iso.split('-')[2]);
    const dayTasks = plan.tasks.filter((t) => t.date === iso);
    const hasOverdueOrPending = dayTasks.some((t) => !t.completedAt && t.date <= today);
    const hasScheduledOrDone = dayTasks.length > 0 && !hasOverdueOrPending;
    return {
      iso,
      dayNum,
      label: weekdayLabels[idx],
      hasOverdueOrPending,
      hasScheduledOrDone,
      count: dayTasks.length,
    };
  });

  return (
    <div className={`plan-course-block ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
      <article className="plan-card plan-course-banner" key={plan.id}>
        <CourseCover
          token={token}
          courseId={plan.courseId}
          title={plan.courseTitle}
          className="plan-banner-cover"
        />
        <div className="plan-banner-main">
          <header className="plan-banner-head">
            <div className="plan-banner-title-wrap">
              <h2>{plan.courseTitle}</h2>
              <span className="plan-status-badge">
                {doneCount === plan.tasks.length ? '已完成' : '进行中'}
              </span>
            </div>
            <div className="plan-banner-ops">
              <button
                disabled={busy || !pendingTasks.length}
                title="修改未完成任务的内容和日期"
                onClick={() => preview(null, plan)}
              >
                编辑
              </button>
              <span className="plan-op-sep" aria-hidden="true">
                |
              </span>
              <button
                disabled={busy || !pendingTasks.length}
                title="从今天起重新安排剩余任务日期"
                onClick={() => preview(null, plan, true)}
              >
                改期
              </button>
              <span className="plan-op-sep" aria-hidden="true">
                |
              </span>
              <button
                disabled={busy}
                title="向 AI 提要求，重新制定计划"
                onClick={() => begin(plan)}
              >
                重排
              </button>
              <span className="plan-op-sep" aria-hidden="true">
                |
              </span>
              <button
                disabled={busy}
                title="删除学习计划"
                aria-label="删除"
                onClick={() => {
                  setError('');
                  setModal({ type: 'delete', plan });
                }}
              >
                <span className="plan-dots-icon" aria-hidden="true">
                  ⋮
                </span>
                <span className="plan-sr-only">删除</span>
              </button>
              <span className="plan-op-sep" aria-hidden="true">
                |
              </span>
              <button
                type="button"
                className="plan-banner-toggle-btn"
                aria-expanded={isExpanded}
                title={isExpanded ? '收起此书研习内容' : '展开此书研习内容'}
                onClick={onToggleExpand}
              >
                {isExpanded ? '收起清单 ⌃' : '展开清单 ⌄'}
              </button>
            </div>
          </header>

          <p className="plan-banner-meta">
            目标：<span className="plan-num">{plan.settings.targetDate.replaceAll('-', '.')}</span>
            <span className="plan-meta-slash">/</span>
            每天约 <span className="plan-num">{plan.settings.minutes}</span> 分钟
          </p>

          <div className="plan-progress">
            <progress
              aria-label="学习计划完成进度"
              value={doneCount}
              max={Math.max(1, plan.tasks.length)}
            />
            <strong className="plan-num">{percent}%</strong>
            <span className="plan-num">
              已完成 {doneCount} / {plan.tasks.length} 项
            </span>
          </div>

          {!isExpanded && (
            <div
              className="plan-banner-collapsed-foot"
              role="button"
              tabIndex={0}
              onClick={onToggleExpand}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleExpand();
                }
              }}
            >
              <span>
                展开此书研习清单与排期 ⌄（尚有{' '}
                <strong className="plan-num">{pendingTasks.length}</strong> 项待完成）
              </span>
            </div>
          )}
        </div>
      </article>

      {isExpanded && (
        <div className="plan-workspace-grid">
          <section className="plan-checklist-card" aria-label="研习清单">
            <h3>研习清单</h3>
            <div className="plan-checklist-toolbar">
              <div className="plan-checklist-tabs" role="tablist" aria-label="任务完成状态">
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === 'pending'}
                  className={listTab === 'pending' ? 'active' : ''}
                  onClick={() => setListTab('pending')}
                >
                  待完成 <span className="plan-num">{pendingTasks.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === 'done'}
                  className={listTab === 'done' ? 'active' : ''}
                  onClick={() => setListTab('done')}
                >
                  已完成 <span className="plan-num">{doneCount}</span>
                </button>
              </div>

              <div className="plan-checklist-filters">
                <label className="plan-select-wrap">
                  <select
                    aria-label="筛选任务类型"
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                  >
                    <option value="all">全部任务</option>
                    <option value="read">阅读学习</option>
                    <option value="practice">章节练习</option>
                    <option value="notes">整理笔记</option>
                  </select>
                  <span aria-hidden="true">⌄</span>
                </label>
                <label className="plan-select-wrap">
                  <select
                    aria-label="任务排序方式"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="date">按日期</option>
                    <option value="progress">按进度</option>
                    <option value="kind">按类型</option>
                  </select>
                  <span aria-hidden="true">⌄</span>
                </label>
              </div>
            </div>

            {listTab === 'pending' ? (
              <>
                {overdueList.length > 0 && (
                  <details className="plan-task-group" open>
                    <summary>
                      <span className="plan-group-chevron" aria-hidden="true" />
                      <span>待补学</span>
                      <span className="plan-group-count plan-num">({overdueList.length})</span>
                    </summary>
                    <div className="plan-group-rows">
                      {overdueList.map((task) => renderGardenTask(plan, task))}
                    </div>
                  </details>
                )}

                {upcomingList.length > 0 && (
                  <details className="plan-task-group" open>
                    <summary>
                      <span className="plan-group-chevron" aria-hidden="true" />
                      <span>接下来</span>
                      <span className="plan-group-count plan-num">({upcomingList.length})</span>
                    </summary>
                    <div className="plan-group-rows">
                      {upcomingList.map((task) => renderGardenTask(plan, task))}
                    </div>
                  </details>
                )}

                {overdueList.length === 0 && upcomingList.length === 0 && (
                  <p className="plan-empty">
                    {selectedDate ? '所选日期没有待完成任务。' : '当前筛选下没有待完成任务。'}
                  </p>
                )}

                {doneCount > 0 && (
                  <details
                    className="plan-task-group plan-done-group"
                    open={isDoneExpanded}
                    onToggle={(e) => setIsDoneExpanded(e.currentTarget.open)}
                  >
                    <summary className="plan-done-summary-bar">
                      <div className="plan-done-summary-left">
                        <div className="plan-done-title-wrap">
                          <span>
                            已完成 <strong className="plan-num">{doneCount}</strong> 项研习任务
                          </span>
                          {selectedDate && (
                            <small className="plan-done-filter-hint">
                              （当前选日 {filteredDoneList.length} 项）
                            </small>
                          )}
                        </div>
                      </div>
                      <div className="plan-done-summary-right">
                        <span className="plan-done-toggle-text">
                          {isDoneExpanded ? '收起记录 ⌃' : '展开查看 ⌄'}
                        </span>
                        <span className="plan-op-sep" aria-hidden="true">
                          |
                        </span>
                        <button
                          type="button"
                          className="plan-done-jump-btn"
                          title="切换至已完成专页管理"
                          onClick={(e) => {
                            e.stopPropagation();
                            setListTab('done');
                          }}
                        >
                          专页管理 →
                        </button>
                      </div>
                    </summary>

                    <div className="plan-done-drawer-content">
                      <div className="plan-done-stats-strip">
                        <div className="plan-done-stats-item">
                          <span className="plan-done-stats-label">累计研习</span>
                          <strong className="plan-num">{doneTotalMinutes} 分钟</strong>
                        </div>
                        <span className="plan-done-stats-divider" aria-hidden="true">
                          /
                        </span>
                        <div className="plan-done-stats-item">
                          <span className="plan-done-stats-label">已攻克要点</span>
                          <strong className="plan-num">{doneCount} 个章节任务</strong>
                        </div>
                        <span className="plan-done-stats-divider" aria-hidden="true">
                          /
                        </span>
                        <div className="plan-done-stats-item">
                          <span className="plan-done-stats-label">总进度达成</span>
                          <strong className="plan-num">{percent}%</strong>
                        </div>
                      </div>

                      <div className="plan-group-rows">
                        {filteredDoneList.length > 0 ? (
                          filteredDoneList.map((task) => renderGardenTask(plan, task))
                        ) : (
                          <div className="plan-empty-sub">
                            <p>所选日期暂无已完成记录（全计划共已完成 {doneCount} 项）。</p>
                            {selectedDate && (
                              <button
                                type="button"
                                className="plan-inline-reset"
                                onClick={() => setSelectedDate(null)}
                              >
                                查看全部 {doneCount} 项已完成记录 →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </details>
                )}
              </>
            ) : (
              <>
                <div className="plan-done-stats-strip">
                  <div className="plan-done-stats-item">
                    <span className="plan-done-stats-label">已完成任务</span>
                    <strong className="plan-num">{doneCount} 项</strong>
                  </div>
                  <span className="plan-done-stats-divider" aria-hidden="true">
                    /
                  </span>
                  <div className="plan-done-stats-item">
                    <span className="plan-done-stats-label">累计研习</span>
                    <strong className="plan-num">{doneTotalMinutes} 分钟</strong>
                  </div>
                  <span className="plan-done-stats-divider" aria-hidden="true">
                    /
                  </span>
                  <div className="plan-done-stats-item">
                    <span className="plan-done-stats-label">总进度达成</span>
                    <strong className="plan-num">{percent}%</strong>
                  </div>
                </div>

                {filteredDoneList.length > 0 ? (
                  <details className="plan-task-group" open>
                    <summary>
                      <span className="plan-group-chevron" aria-hidden="true" />
                      <span>已完成</span>
                      <span className="plan-group-count plan-num">({filteredDoneList.length})</span>
                    </summary>
                    <div className="plan-group-rows">
                      {filteredDoneList.map((task) => renderGardenTask(plan, task))}
                    </div>
                  </details>
                ) : (
                  <div className="plan-empty-sub">
                    <p>
                      {selectedDate
                        ? `所选日期暂无已完成记录（全计划共已完成 ${doneCount} 项）。`
                        : '尚无已完成的任务记录。'}
                    </p>
                    {selectedDate && (
                      <button
                        type="button"
                        className="plan-inline-reset"
                        onClick={() => setSelectedDate(null)}
                      >
                        清除日期筛选，查看全部 {doneCount} 项 →
                      </button>
                    )}
                  </div>
                )}

                <div
                  className="plan-done-summary-bar is-clickable"
                  role="button"
                  tabIndex={0}
                  title="点击返回待完成清单"
                  onClick={() => setListTab('pending')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setListTab('pending');
                    }
                  }}
                >
                  <span className="plan-done-summary-left">
                    <span>
                      待完成 <strong className="plan-num">{pendingTasks.length}</strong> 项任务
                    </span>
                  </span>
                  <span className="plan-done-jump-btn">返回待完成清单 →</span>
                </div>
              </>
            )}
          </section>

          <aside className="plan-side-column" aria-label="本周安排与研习小笺">
            <section className="plan-week-card" aria-label="本周安排">
              <header className="plan-week-head">
                <h3>本周安排</h3>
                <div className="plan-week-nav">
                  <button
                    type="button"
                    aria-label="上一周"
                    onClick={() => setWeekOffset((w) => w - 1)}
                  >
                    ‹
                  </button>
                  <span className="plan-num">{formatWeekRange(mondayIso)}</span>
                  <button
                    type="button"
                    aria-label="下一周"
                    onClick={() => setWeekOffset((w) => w + 1)}
                  >
                    ›
                  </button>
                </div>
              </header>

              <div className="plan-week-grid">
                {weekDays.map((d) => (
                  <button
                    key={d.iso}
                    type="button"
                    className={`plan-week-day ${activeFocusDate === d.iso ? 'is-selected' : ''}`}
                    onClick={() => setSelectedDate((prev) => (prev === d.iso ? null : d.iso))}
                  >
                    <span className="plan-week-weekday">{d.label}</span>
                    <span className="plan-week-day-num plan-num">{d.dayNum}</span>
                    <i
                      className={`plan-week-dot ${
                        d.hasOverdueOrPending
                          ? 'is-overdue'
                          : d.hasScheduledOrDone
                            ? 'is-scheduled'
                            : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>

              <div className="plan-week-foot">
                <div>
                  <strong className="plan-num">{formatMonthDaySpaced(activeFocusDate)}</strong>
                  <p>按自己的节奏，继续向前。</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(null);
                    setKindFilter('all');
                    setListTab('pending');
                  }}
                >
                  查看全部安排 →
                </button>
              </div>
            </section>

            <section className="plan-margin-note" aria-label="研习小笺">
              <header className="plan-note-head">
                <h3>研习小笺</h3>
                <span className="plan-note-seal" aria-hidden="true">
                  循序
                </span>
              </header>
              <p className="plan-note-quote">每日一小步，所学自成章。</p>
              <p className="plan-note-desc">
                先完成待补学任务，再继续新的章节。
                <br />
                计划有变化时，可调整日期。
              </p>
              <img
                className="plan-note-art"
                src="/assets/ink/bamboo-clean-v2.png"
                alt=""
                aria-hidden="true"
              />
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function LearningPlanPanel({
  token,
  courses,
  data,
  reload,
  error: loadError,
  onOpenTask,
  onAll,
  compact = false,
}) {
  const [modal, setModal] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [config, setConfig] = useState({
    targetDate: dateAfter(data.today, 14),
    minutes: 30,
    weekdays: [1, 2, 3, 4, 5],
    requirements: '',
  });
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const PLAN_EXPANDED_KEY = 'math-auth-plans-expanded';

  const [expandedPlans, setExpandedPlans] = useState(() => {
    try {
      const saved = localStorage.getItem(PLAN_EXPANDED_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const togglePlan = (planId, index, courseId) => {
    setExpandedPlans((prev) => {
      const isCurrentlyExpanded =
        prev[planId] ?? (courseId ? prev[`course-${courseId}`] : undefined) ?? index === 0;
      const nextVal = !isCurrentlyExpanded;
      const next = { ...prev, [planId]: nextVal };
      if (courseId) next[`course-${courseId}`] = nextVal;
      try {
        localStorage.setItem(PLAN_EXPANDED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const expandAll = () => {
    const next = { ...expandedPlans };
    data.plans.forEach((p) => {
      next[p.id] = true;
      if (p.courseId) next[`course-${p.courseId}`] = true;
    });
    try {
      localStorage.setItem(PLAN_EXPANDED_KEY, JSON.stringify(next));
    } catch {}
    setExpandedPlans(next);
  };

  const collapseAll = () => {
    const next = { ...expandedPlans };
    data.plans.forEach((p) => {
      next[p.id] = false;
      if (p.courseId) next[`course-${p.courseId}`] = false;
    });
    try {
      localStorage.setItem(PLAN_EXPANDED_KEY, JSON.stringify(next));
    } catch {}
    setExpandedPlans(next);
  };

  const begin = (plan = null, settings = null) => {
    setCourseId(String(plan?.courseId || courses[0]?.id || ''));
    setConfig(
      settings ||
        plan?.settings || {
          targetDate: dateAfter(data.today, 14),
          minutes: 30,
          weekdays: [1, 2, 3, 4, 5],
          requirements: '',
        },
    );
    setError('');
    setModal({ type: 'generate', plan });
  };

  useEffect(() => {
    if (compact) return;
    const targetCourseId = sessionStorage.getItem('math-auth-plan-course');
    if (!targetCourseId) return;
    sessionStorage.removeItem('math-auth-plan-course');
    const existing = data.plans.find((p) => String(p.courseId) === String(targetCourseId));
    if (existing) {
      setExpandedPlans((prev) => ({
        ...prev,
        [existing.id]: true,
        [`course-${targetCourseId}`]: true,
      }));
    } else {
      setCourseId(String(targetCourseId));
      setModal({ type: 'generate', plan: null });
    }
  }, [compact, data.plans.length]);

  const preview = async (job = null, plan = null, shift = false) => {
    setError('');
    setBusy(true);
    try {
      const id = job?.courseId || plan.courseId;
      const course = await api(token, `courses/${id}`);
      setCourseId(String(id));
      let nextConfig = job?.settings || plan.settings;
      let next = job?.result.tasks || plan.tasks.filter((t) => !t.completedAt);
      if (shift) {
        let cursor = data.today,
          used = 0;
        next = [...next]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((t) => {
            if (t.date > cursor) {
              cursor = t.date;
              used = 0;
            }
            while (
              !nextConfig.weekdays.includes(new Date(`${cursor}T12:00:00Z`).getUTCDay()) ||
              (used && used + t.minutes > nextConfig.minutes)
            ) {
              cursor = dateAfter(cursor, 1);
              used = 0;
            }
            used += t.minutes;
            return { ...t, date: cursor };
          });
        if (next.some((t) => t.date > nextConfig.targetDate)) {
          nextConfig = { ...nextConfig, targetDate: next.at(-1).date };
        }
      }
      setTasks(next.map((t) => ({ ...t })));
      setConfig(nextConfig);
      setModal({ type: 'preview', job, plan, chapters: course.chapters, shift });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const [savingTask, setSavingTask] = useState(null);
  const [visibleTasks, setVisibleTasks] = useState(null);
  const [finishingTask, setFinishingTask] = useState(null);

  const todayTasks =
    visibleTasks ??
    data.plans
      .flatMap((p) =>
        p.tasks
          .filter((t) => t.date <= data.today && !t.completedAt)
          .map((t) => ({ plan: p, task: t })),
      )
      .sort((a, b) => a.task.date.localeCompare(b.task.date));

  const toggle = async (plan, task) => {
    if (busy) return;
    const key = `${plan.id}:${task.id}`;
    setSavingTask(key);
    setBusy(true);
    setError('');
    if (compact) setVisibleTasks(todayTasks);
    try {
      await api(
        token,
        `learning-plans/${plan.id}/tasks/${task.id}`,
        { completed: !task.completedAt, version: plan.version },
        'PATCH',
      );
      window.dispatchEvent(new Event('study-activity-changed'));
      if (compact && !task.completedAt) {
        setFinishingTask(key);
        setVisibleTasks(
          todayTasks.map((row) =>
            `${row.plan.id}:${row.task.id}` === key
              ? { ...row, task: { ...row.task, completedAt: new Date().toISOString() } }
              : row,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 2400));
      }
      await reload();
    } catch (e) {
      setError(e.message);
      await reload();
    } finally {
      setBusy(false);
      setSavingTask(null);
      setFinishingTask(null);
      setVisibleTasks(null);
    }
  };

  const act = async () => {
    setBusy(true);
    setError('');
    try {
      if (modal.type === 'delete') {
        await api(
          token,
          `learning-plans/${modal.plan.id}`,
          { version: modal.plan.version },
          'DELETE',
        );
      } else if (modal.type === 'generate') {
        await api(token, 'learning-plans/generate', {
          courseId: Number(courseId),
          settings: config,
        });
      } else {
        await api(
          token,
          modal.job ? 'learning-plans/adopt' : 'learning-plans',
          {
            courseId: Number(courseId),
            settings: config,
            tasks,
            version: modal.job?.baseVersion ?? modal.plan.version,
            ...(modal.job ? { jobId: modal.job.id } : {}),
          },
          modal.job ? 'POST' : 'PUT',
        );
      }
      setModal(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const renderCompactTask = (plan, task) => (
    <div
      className={`plan-task-shell ${finishingTask === `${plan.id}:${task.id}` ? 'task-finishing' : ''}`}
      key={`${plan.id}:${task.id}`}
    >
      <div className="plan-task-collapse">
        <div className={`plan-task ${task.completedAt ? 'done' : ''}`}>
          <div className="plan-task-content">
            <span
              className={`plan-task-indicator ${task.completedAt ? 'completed' : ''}`}
              aria-hidden="true"
            >
              {task.completedAt ? '✓' : ''}
            </span>
            <div>
              <strong>{task.title}</strong>
              <small>
                {`${plan.courseTitle} · `}
                {names[task.kind]} · {task.minutes} 分钟 · {task.date}
                {task.date < data.today && !task.completedAt ? ' · 待补学' : ''}
                {task.completionSource === 'chapter' && task.completedAt ? ' · 章节已学完' : ''}
              </small>
              {task.available && task.readingProgress != null && (
                <span className="plan-chapter-progress">
                  <small>任务进度 {task.completedAt ? 100 : task.readingProgress}%</small>
                  <progress
                    value={task.completedAt ? 100 : task.readingProgress}
                    max={100}
                    aria-label={`任务进度 ${task.completedAt ? 100 : task.readingProgress}%`}
                  />
                </span>
              )}
            </div>
          </div>
          <div className="plan-task-actions">
            {task.available ? (
              <button
                className="plan-link"
                onClick={() =>
                  onOpenTask(plan.courseId, {
                    chapterId: task.chapterId,
                    resumeReading: task.kind === 'read',
                    tab:
                      task.kind === 'notes'
                        ? 'notes'
                        : task.kind === 'practice'
                          ? 'practice'
                          : 'materials',
                    ...(task.kind === 'practice' && task.practiceId
                      ? { practiceId: task.practiceId }
                      : {}),
                  })
                }
              >
                {task.kind === 'practice' && !task.practiceId
                  ? '前往出题'
                  : task.kind === 'read' && !task.hasMaterials
                    ? '导入资料'
                    : '进入学习'}
              </button>
            ) : (
              <small className="form-error">章节已删除</small>
            )}
            <button
              type="button"
              className={`plan-task-complete ${task.completedAt ? 'completed' : ''}`}
              disabled={busy || (!task.available && !task.completedAt)}
              aria-pressed={Boolean(task.completedAt)}
              aria-label={`${task.completedAt ? '撤销完成' : '完成任务'}：${task.title}`}
              title={task.completedAt ? '点击撤销完成' : '记录本项任务已完成'}
              onClick={() => toggle(plan, task)}
            >
              {savingTask === `${plan.id}:${task.id}`
                ? '保存中…'
                : task.completedAt
                  ? '✓ 已完成'
                  : '完成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderGardenTask = (plan, task) => {
    const isDone = Boolean(task.completedAt);
    const pct = isDone ? 100 : Number(task.readingProgress ?? 0);
    const key = `${plan.id}:${task.id}`;

    let actionLabel = '进入学习';
    if (isDone) {
      if (task.kind === 'practice') {
        actionLabel = task.practiceId ? '重新练习' : '前往出题';
      } else if (task.kind === 'notes') {
        actionLabel = '查看笔记';
      } else {
        actionLabel = task.hasMaterials ? '回顾研习' : '导入资料';
      }
    } else {
      if (task.kind === 'practice') {
        actionLabel = task.practiceId ? '前往练习' : '前往出题';
      } else if (task.kind === 'notes') {
        actionLabel = '整理笔记';
      } else {
        actionLabel = task.hasMaterials ? '进入学习' : '导入资料';
      }
    }

    return (
      <div className="plan-task-shell" key={key}>
        <div className={`plan-task ${isDone ? 'done is-completed-row' : ''}`}>
          <div className="plan-task-content">
            <button
              type="button"
              className={`plan-task-check ${isDone ? 'completed' : ''}`}
              disabled={busy || (!task.available && !isDone)}
              aria-pressed={isDone}
              aria-label={`${isDone ? '撤销完成' : '完成任务'}：${task.title}`}
              title={isDone ? '点击撤销完成，重回待办清单' : '标记此项任务已完成'}
              onClick={() => toggle(plan, task)}
            >
              {savingTask === key ? '…' : '✓'}
            </button>
            <div className="plan-task-main">
              <strong>{task.title}</strong>
              <p className="plan-task-meta">
                <TaskKindIcon kind={task.kind} />
                <span>{shortNames[task.kind] || names[task.kind]}</span>
                <span aria-hidden="true">·</span>
                <span className="plan-num">{task.minutes} 分钟</span>
                {task.date && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="plan-num">{formatMonthDay(task.date)}</span>
                  </>
                )}
                {isDone && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="plan-task-done-badge">
                      {task.completionSource === 'chapter'
                        ? '章节已读完'
                        : task.completedAt
                          ? `${formatMonthDay(task.completedAt.slice(0, 10))} 学成`
                          : '已完成'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="plan-task-actions">
            {task.available && (
              <span className="plan-chapter-progress">
                <progress value={pct} max={100} aria-label={`任务进度 ${pct}%`} />
                <small className="plan-num">{pct}%</small>
              </span>
            )}
            {task.available ? (
              <button
                type="button"
                className={`plan-link ${isDone ? 'is-review-action' : ''}`}
                onClick={() =>
                  onOpenTask(plan.courseId, {
                    chapterId: task.chapterId,
                    resumeReading: task.kind === 'read',
                    tab:
                      task.kind === 'notes'
                        ? 'notes'
                        : task.kind === 'practice'
                          ? 'practice'
                          : 'materials',
                    ...(task.kind === 'practice' && task.practiceId
                      ? { practiceId: task.practiceId }
                      : {}),
                  })
                }
              >
                {actionLabel}
              </button>
            ) : (
              <small className="form-error">章节已删除</small>
            )}
          </div>
        </div>
      </div>
    );
  };

  const dailyMinutes = tasks.reduce(
    (sum, t) => ({ ...sum, [t.date]: (sum[t.date] || 0) + t.minutes }),
    {},
  );
  const exceedsBudget = Object.values(dailyMinutes).some((n) => n > config.minutes);

  if (compact) {
    return (
      <section className="learning-plans plan-home">
        <header className="plan-header">
          <div>
            <h1>今日学习</h1>
            <p>按计划学习，完成后记录。</p>
          </div>
          <div>
            <button onClick={onAll}>查看计划 →</button>
          </div>
        </header>
        {(error || loadError) && !modal && (
          <div className="plan-error" role="alert">
            {error || loadError}
            <button
              onClick={() => {
                setError('');
                reload();
              }}
            >
              刷新
            </button>
          </div>
        )}
        <div className="plan-today">
          {todayTasks.length ? (
            todayTasks.slice(0, 3).map(({ plan, task }) => renderCompactTask(plan, task))
          ) : (
            <p className="plan-empty">今天没有待完成任务。</p>
          )}
          {todayTasks.length > 3 && <button onClick={onAll}>查看全部任务</button>}
        </div>
      </section>
    );
  }
  return (
    <section className="learning-plans plan-garden">
      <header className="plan-header plan-hero">
        <div className="plan-hero-copy">
          <p className="eyebrow plan-eyebrow">循序 · 致远</p>
          <h1>学习计划</h1>
          <p className="plan-hero-sub">日有所学，循序而进。</p>
        </div>
        <div className="plan-hero-art" aria-hidden="true">
          <img src="/assets/ink/plan-scholar-v4.png" alt="" />
        </div>
        <div className="plan-hero-actions">
          <button
            className="primary plan-ai-btn"
            disabled={!courses.length || busy}
            onClick={() => begin()}
          >
            <span aria-hidden="true">＋</span> AI 制定计划
          </button>
        </div>
      </header>

      {(error || loadError) && !modal && (
        <div className="plan-error" role="alert">
          {error || loadError}
          <button
            onClick={() => {
              setError('');
              reload();
            }}
          >
            刷新
          </button>
        </div>
      )}

      <div className="plan-jobs">
        {data.jobs
          .filter((j) => ['running', 'done', 'failed', 'cancelled'].includes(j.status))
          .map((j) => (
            <article key={j.id}>
              <div>
                <strong>{j.courseTitle}</strong>
                <small>
                  {j.status === 'running'
                    ? 'AI 正在后台生成，可继续使用其他功能'
                    : j.status === 'done'
                      ? '计划已生成，待确认采用'
                      : j.error}
                </small>
              </div>
              {j.status === 'done' ? (
                <button onClick={() => preview(j)}>预览并采用</button>
              ) : ['failed', 'cancelled'].includes(j.status) ? (
                <button
                  onClick={() =>
                    begin(
                      data.plans.find((p) => p.courseId === j.courseId) || { courseId: j.courseId },
                      j.settings,
                    )
                  }
                >
                  重新生成
                </button>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await api(token, `learning-plan-jobs/${j.id}/cancel`, {});
                      await reload();
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  取消生成
                </button>
              )}
              {j.status !== 'running' && (
                <button
                  onClick={async () => {
                    await api(token, `learning-plan-jobs/${j.id}/dismiss`, {});
                    reload();
                  }}
                >
                  关闭结果
                </button>
              )}
            </article>
          ))}
      </div>

      {data.plans.length > 0 ? (
        <div className="plan-multi-container">
          {data.plans.length > 1 && (
            <div className="plan-all-controls">
              <span className="plan-courses-count">
                共收录 <strong className="plan-num">{data.plans.length}</strong> 门课程学习计划
              </span>
              <div className="plan-all-actions">
                <button type="button" className="plan-toggle-all-btn" onClick={expandAll}>
                  全部展开 ⌄
                </button>
                <span className="plan-op-sep" aria-hidden="true">
                  |
                </span>
                <button type="button" className="plan-toggle-all-btn" onClick={collapseAll}>
                  全部收起 ⌃
                </button>
              </div>
            </div>
          )}

          {data.plans.map((plan, index) => {
            const isExpanded =
              expandedPlans[plan.id] ??
              (plan.courseId ? expandedPlans[`course-${plan.courseId}`] : undefined) ??
              index === 0;
            return (
              <PlanCourseBlock
                key={plan.id}
                plan={plan}
                index={index}
                isExpanded={isExpanded}
                onToggleExpand={() => togglePlan(plan.id, index, plan.courseId)}
                token={token}
                today={data.today}
                busy={busy}
                savingTask={savingTask}
                toggle={toggle}
                preview={preview}
                begin={begin}
                setModal={setModal}
                setError={setError}
                onOpenTask={onOpenTask}
                renderGardenTask={renderGardenTask}
              />
            );
          })}
        </div>
      ) : (
        <div className="plan-list">
          <p className="plan-empty">
            {data.jobs.some((j) => j.status === 'done')
              ? '生成结果尚未采用。点击“预览并采用”，确认后将在这里显示学习任务。'
              : data.jobs.some((j) => j.status === 'running')
                ? '计划正在生成，完成后可预览并采用。'
                : '还没有学习计划。选择课程，让 AI 安排第一份计划。'}
          </p>
        </div>
      )}

      <footer className="plan-page-foot">
        <span>数有方 · 让学习有迹可循</span>
      </footer>

      {modal && (
        <Modal
          busy={busy}
          variant={
            modal.type === 'delete' ? 'confirm' : modal.type === 'generate' ? 'form' : 'wide'
          }
          title={
            modal.type === 'delete'
              ? '删除学习计划？'
              : modal.type === 'generate'
                ? 'AI 制定学习计划'
                : modal.job
                  ? '预览并采用学习计划'
                  : modal.shift
                    ? '预览改期'
                    : '调整学习计划'
          }
          onClose={() => !busy && setModal(null)}
          footer={
            <>
              <button disabled={busy} onClick={() => setModal(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  (modal.type !== 'delete' && !courseId) ||
                  (modal.type === 'preview' && !tasks.length)
                }
                onClick={act}
              >
                {busy
                  ? '处理中…'
                  : modal.type === 'delete'
                    ? '删除计划'
                    : modal.type === 'generate'
                      ? '后台生成'
                      : modal.job
                        ? '采用计划'
                        : '保存调整'}
              </button>
            </>
          }
        >
          {modal.type === 'delete' ? (
            <p className="plan-muted">
              将删除“{modal.plan.courseTitle}
              ”的学习计划、任务与完成记录，无法恢复。课程、资料、笔记和独立的错题复习安排会保留。
            </p>
          ) : modal.type === 'generate' ? (
            <>
              <label>
                选择课程
                <select
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    const p = data.plans.find((p) => String(p.courseId) === e.target.value);
                    if (p) setConfig(p.settings);
                  }}
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="plan-fields">
                <label>
                  目标完成日期
                  <input
                    type="date"
                    min={data.today}
                    value={config.targetDate}
                    onChange={(e) => setConfig({ ...config, targetDate: e.target.value })}
                  />
                </label>
                <label>
                  每天可用时间（分钟）
                  <input
                    type="number"
                    min="10"
                    max="480"
                    value={config.minutes}
                    onChange={(e) => setConfig({ ...config, minutes: Number(e.target.value) })}
                  />
                </label>
              </div>
              <fieldset>
                <legend>每周学习日</legend>
                {['日', '一', '二', '三', '四', '五', '六'].map((n, i) => (
                  <label key={i}>
                    <input
                      type="checkbox"
                      checked={config.weekdays.includes(i)}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          weekdays: e.target.checked
                            ? [...config.weekdays, i]
                            : config.weekdays.filter((v) => v !== i),
                        })
                      }
                    />
                    周{n}
                  </label>
                ))}
              </fieldset>
              <label>
                向 AI 提要求
                <textarea
                  maxLength={1000}
                  value={config.requirements}
                  onChange={(e) => setConfig({ ...config, requirements: e.target.value })}
                  placeholder="例如：先学基础，每周留一天复习。"
                />
              </label>
              <p className="plan-muted">生成结果先进入预览。已有计划的已完成任务会保留。</p>
            </>
          ) : (
            <>
              {!modal.shift && (
                <p className="plan-muted">
                  调整未完成任务；已完成记录自动保留。日期须符合学习日，每日时间为估算。
                </p>
              )}
              {exceedsBudget && (
                <p className="plan-warning">部分日期超过每日可用时间，建议调整任务或日期。</p>
              )}
              <label>
                目标完成日期
                <input
                  type="date"
                  min={data.today}
                  value={config.targetDate}
                  onChange={(e) => setConfig({ ...config, targetDate: e.target.value })}
                />
              </label>
              <div className="plan-preview-rows">
                {tasks.map((task, i) => (
                  <article key={i}>
                    <div className="plan-preview-fields">
                      <input
                        aria-label={`任务 ${i + 1} 日期`}
                        type="date"
                        min={data.today}
                        value={task.date}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((t, j) => (j === i ? { ...t, date: e.target.value } : t)),
                          )
                        }
                      />
                      <select
                        aria-label={`任务 ${i + 1} 章节`}
                        value={task.chapterId}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((t, j) =>
                              j === i ? { ...t, chapterId: Number(e.target.value) } : t,
                            ),
                          )
                        }
                      >
                        {modal.chapters.map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.title}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`任务 ${i + 1} 类型`}
                        value={task.kind}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((t, j) => (j === i ? { ...t, kind: e.target.value } : t)),
                          )
                        }
                      >
                        {Object.entries(names).map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="plan-preview-fields">
                      <input
                        aria-label={`任务 ${i + 1} 内容`}
                        maxLength={180}
                        value={task.title}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((t, j) => (j === i ? { ...t, title: e.target.value } : t)),
                          )
                        }
                      />
                      <input
                        aria-label={`任务 ${i + 1} 分钟`}
                        type="number"
                        min="5"
                        max="480"
                        value={task.minutes}
                        onChange={(e) =>
                          setTasks(
                            tasks.map((t, j) =>
                              j === i ? { ...t, minutes: Number(e.target.value) } : t,
                            ),
                          )
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
              <button
                onClick={() =>
                  begin(
                    data.plans.find((p) => String(p.courseId) === courseId) || { courseId },
                    config,
                  )
                }
              >
                向 AI 提新要求重新生成
              </button>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
