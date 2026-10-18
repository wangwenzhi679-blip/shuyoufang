import CourseCover from './CourseCover.jsx';
import { dailyWelcome } from './daily-welcome.mjs';
import ChapterIllustration from './ChapterIllustration.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { formatDateTime } from './date-format.mjs';
import './learning-overview.css';
const date = (v) =>
  formatDateTime(v, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function Progress({ course }) {
  const total = Number(course?.chapter_count || 0),
    done = Number(course?.completed_count || 0),
    percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="overview-progress">
      <small>{total ? `已学 ${done} / ${total} 章` : '尚未添加章节'}</small>
      {total > 0 && (
        <>
          <progress value={done} max={total} aria-label={`课程进度 ${percent}%`} />
          <small>{percent}%</small>
        </>
      )}
    </div>
  );
}
function Panel({ title, extra, children, innerRef, className = '' }) {
  return (
    <article className={`overview-card ${className}`} ref={innerRef}>
      <header>
        <h2>{title}</h2>
        {extra}
      </header>
      {children}
    </article>
  );
}
export default function LearningOverview({
  token,
  user,
  data,
  loading,
  error,
  onRetry,
  courses,
  onCourses,
  onCreate,
  onOpenCourse,
  onOpenWrong,
  onOpenHistory,
  tasks,
}) {
  const history = useRef(null),
    o = data?.overview;
  const [recordTab, setRecordTab] = useState('review');
  const taskPanels = React.Children.toArray(tasks?.props?.children);
  const recent = data?.recent,
    coverCourseId = recent?.course_id || courses[0]?.id,
    coverTitle = recent?.course_title || courses[0]?.title || '研习手卷',
    course = o?.courseCounts?.find((c) => Number(c.id) === Number(coverCourseId));
  const courseStats = course?.practiceStats;
  const openActivity = (a) =>
    a.kind === 'attempt'
      ? onOpenHistory({
          attempt_id: a.id,
          course_id: a.courseId,
          chapter_id: a.chapterId,
          practice_id: a.practiceId,
        })
      : onOpenCourse(a.courseId, {
          chapterId: a.chapterId,
          notes: a.kind === 'note',
          tab: a.kind === 'note' ? 'notes' : 'materials',
          resumeReading: a.kind === 'read',
        });
  const toHistory = () => {
    if (history.current) {
      history.current.open = true;
      history.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const welcome = dailyWelcome(now),
    study = o?.studyActivity;
  const streakTitle = study
    ? (study.studiedToday ? '今天已记录学习' : '今天还未学习，当前连续天数截至昨天') +
      '；累计学习 ' +
      study.totalDays +
      ' 天，最长连续 ' +
      study.longestStreak +
      ' 天'
    : '正在加载学习记录';
  return (
    <section className="learning-overview home-reference">
      <header className="overview-heading home-welcome">
        <div>
          <small>
            今日 · {welcome.label}
            <span className="daily-study-prompt"> · {welcome.prompt}</span>
          </small>
          <h1>
            {welcome.greeting}，{user?.nickname || '同学'}
          </h1>
          <p>从上次停下的地方，继续向前。</p>
        </div>
        <div
          className="home-study-streak"
          title={streakTitle}
          aria-label={study ? `连续学习 ${study.currentStreak} 天。${streakTitle}` : streakTitle}
        >
          <span>连续学习</span>
          <strong>{study ? study.currentStreak : '—'}</strong>
          <span>天</span>
        </div>
        <img className="home-scholar-art" src="/assets/ink/home-scholar-v1.png" alt="" />
      </header>
      {error && (
        <div className="overview-error" role="alert">
          {error}
          <button onClick={onRetry} disabled={loading}>
            重新加载
          </button>
        </div>
      )}
      {!o ? (
        <div className="overview-loading" role="status">
          {loading ? '正在加载学习数据…' : '尚未加载学习数据'}
          {!loading && !error && <button onClick={onRetry}>重新加载</button>}
        </div>
      ) : (
        <>
          <div className="reference-grid">
            <Panel title="继续学习" className="reference-course">
              {courses.length ? (
                <div className="reference-course-body">
                  <CourseCover
                    token={token}
                    courseId={coverCourseId}
                    title={coverTitle}
                    className="home-course-cover"
                  />
                  <div className="reference-course-main">
                    <div className="reference-course-top">
                      <div>
                        <small className="course-kicker">
                          {recent?.course_title || '选择一门课程'}
                        </small>
                        <h2>{recent?.chapter_title || '从章节目录开始'}</h2>
                      </div>
                      <button
                        className="create-course"
                        onClick={() =>
                          recent
                            ? onOpenCourse(recent.course_id, {
                                chapterId: recent.chapter_id,
                                tab: 'materials',
                                resumeReading: true,
                              })
                            : onCourses()
                        }
                      >
                        继续学习 ↗
                      </button>
                    </div>
                    <Progress course={course} />
                    <div className="reference-metrics">
                      <button onClick={onCourses}>
                        <span>已学章节</span>
                        <strong>
                          {Number(course?.completed_count || 0)}
                          <span className="metric-total">
                            / {Number(course?.chapter_count || 0)}
                          </span>
                          <small>章</small>
                        </strong>
                      </button>
                      <button onClick={toHistory}>
                        <span>完成交卷</span>
                        <strong>
                          {courseStats?.attemptCount ?? 0}
                          <small> 次</small>
                        </strong>
                      </button>
                      <button onClick={toHistory}>
                        <span>客观题正确率</span>
                        <strong>
                          {courseStats?.accuracy == null ? (
                            '暂无'
                          ) : (
                            <>
                              {courseStats.accuracy}
                              <small>%</small>
                            </>
                          )}
                        </strong>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="reference-empty">
                  <p>从一份学习资料开始，建立你的第一门课程。</p>
                  <button className="create-course" onClick={onCreate}>
                    导入资料
                  </button>
                </div>
              )}
            </Panel>
            <div className="reference-today">{taskPanels[0]}</div>
            <details className="reference-more" open>
              <summary>
                <span className="record-heading">更多学习记录</span>
                <span className="record-toggle" aria-hidden="true">
                  <i />
                </span>
              </summary>
              <div className="record-tabs" role="tablist" aria-label="学习记录分类">
                {[
                  ['review', '复习安排'],
                  ['practice', '待完成练习'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    id={`record-tab-${key}`}
                    role="tab"
                    aria-selected={recordTab === key}
                    tabIndex={recordTab === key ? 0 : -1}
                    aria-controls={`record-panel-${key}`}
                    onClick={() => setRecordTab(key)}
                    onKeyDown={(e) => {
                      const keys = ['review', 'practice'];
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                        e.preventDefault();
                        const next =
                          e.key === 'Home'
                            ? 0
                            : e.key === 'End'
                              ? keys.length - 1
                              : (keys.indexOf(key) +
                                  (e.key === 'ArrowRight' ? 1 : keys.length - 1)) %
                                keys.length;
                        setRecordTab(keys[next]);
                        e.currentTarget.parentElement.children[next].focus();
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="record-tab-content"
                id={`record-panel-${recordTab}`}
                role="tabpanel"
                aria-labelledby={`record-tab-${recordTab}`}
              >
                {recordTab === 'review' ? (
                  <div className="reference-review-schedule">
                    {taskPanels[1]}
                    <button className="record-text-link" onClick={onOpenWrong}>
                      查看错题本 · {data.wrongCount} 题 →
                    </button>
                  </div>
                ) : (
                  <div className="record-practice-list">
                    {data.unfinished.length ? (
                      data.unfinished.map((a) => (
                        <button
                          key={a.practice_id}
                          onClick={() =>
                            onOpenCourse(a.course_id, {
                              chapterId: a.chapter_id,
                              practiceId: a.practice_id,
                            })
                          }
                        >
                          <span>
                            <strong>{a.practice_title}</strong>
                            <small>{a.course_title}</small>
                          </span>
                          <span>{a.has_progress ? '继续作答' : '开始答题'} →</span>
                        </button>
                      ))
                    ) : (
                      <div className="record-empty">
                        <svg
                          className="record-empty-art"
                          viewBox="0 0 96 64"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M48 18C36 10 23 10 10 15v39c14-5 26-4 38 3 12-7 24-8 38-3V15c-13-5-26-5-38 3Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                          <path
                            d="M48 18v39M18 24c8-2 16-1 23 3M18 32c8-2 16-1 23 3M18 40c8-2 16-1 23 3M55 27c7-4 15-5 23-3M55 35c7-4 15-5 23-3M55 43c7-4 15-5 23-3"
                            stroke="currentColor"
                            strokeLinecap="round"
                          />
                          <path
                            d="M79 9c1-5 5-7 10-7-1 5-4 8-10 7Z"
                            fill="currentColor"
                            opacity=".3"
                          />
                        </svg>
                        <strong>暂无待完成练习</strong>
                        <p>已生成的未完成练习会显示在这里。</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
            <Panel title="最近学习" className="reference-recent">
              <div className="overview-rows reference-activity">
                {o.activity.length ? (
                  o.activity.slice(0, 3).map((a) => (
                    <button key={`${a.kind}-${a.id}`} onClick={() => openActivity(a)}>
                      <ChapterIllustration
                        token={token}
                        courseId={a.courseId}
                        chapterId={a.chapterId}
                      />
                      <span>
                        <strong>{a.title}</strong>
                        <small>
                          {a.courseTitle} · {date(a.activityAt)}
                        </small>
                      </span>
                      <span aria-hidden="true">›</span>
                    </button>
                  ))
                ) : (
                  <p>阅读、记笔记或交卷后，在这里继续。</p>
                )}
              </div>
            </Panel>
          </div>
          {o.excludedAttempts > 0 && (
            <p className="overview-footnote">
              有 {o.excludedAttempts} 次旧记录或不完整记录未完整计入正确率。
            </p>
          )}
          <details className="reference-history" ref={history} open>
            <summary>
              <span className="record-heading">最近交卷</span>
              <span className="record-description">{data.history.length} 条记录</span>
              <span className="record-toggle" aria-hidden="true">
                <i />
              </span>
            </summary>
            <div className="record-table-wrap">
              <table className="record-table">
                <thead>
                  <tr>
                    <th>练习内容</th>
                    <th>提交时间</th>
                    <th>答题情况</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((a) => {
                    const percent = a.total_count
                      ? Math.round((a.correct_count / a.total_count) * 100)
                      : 0;
                    return (
                      <tr key={a.attempt_id}>
                        <td>
                          <strong>{a.practice_title}</strong>
                          <small>{a.course_title}</small>
                        </td>
                        <td>{date(a.created_at)}</td>
                        <td>
                          <div className="record-result">
                            <span>
                              {a.correct_count} / {a.total_count} 答对
                            </span>
                            <progress
                              value={a.correct_count}
                              max={Math.max(1, a.total_count)}
                              aria-label={`答对比例 ${percent}%`}
                            />
                            <span>{percent}%</span>
                          </div>
                        </td>
                        <td>
                          <button onClick={() => onOpenHistory(a)}>查看答卷 →</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!data.history.length && <p className="record-empty">交卷后会保留答题记录。</p>}
            </div>
          </details>
          <footer className="home-footer">数有方 · 让学习有迹可循</footer>
        </>
      )}
    </section>
  );
}
