import { requestJson } from './api-client.mjs';
import WrongQuestionNote from './WrongQuestionNote.jsx';
import WrongReflections from './WrongReflections.jsx';
import PaperDialog from './PaperDialog.jsx';
import {
  questionTypeLabel,
  optionLetter,
  answerLetters,
  selectionLetters,
} from '../../shared/question-types.mjs';
import { SchedulePicker, ReviewSchedulePanel, reviewApi } from './ReviewSchedules';
import React, { useEffect, useState } from 'react';
import './wrong-review.css';
import './review-polish.css';

function ReviewIcon({ type }) {
  const paths = {
    collect: (
      <>
        <path d="M15 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-6-6Z" />
        <path d="M15 4v6h6M9 14h5M9 18h3" />
        <circle cx="20" cy="16" r="3" className="wr-icon-accent" />
      </>
    ),
    reflect: (
      <>
        <path d="M9 18c0-3-4-4-4-8a7 7 0 0 1 14 0c0 4-4 5-4 8M9 18h6M10 22h4M12 1V0M2 4l-2-2M22 4l2-2M1 11h-2M23 11h2" />
        <path d="m10 11 2 2 2-3" className="wr-icon-accent" />
      </>
    ),
    master: (
      <>
        <rect x="3" y="3" width="18" height="20" rx="3" />
        <path d="M8 17v-4M12 17V9M16 17V6" />
        <path d="M8 17v-4" className="wr-icon-accent" />
      </>
    ),
  };
  return (
    <svg
      viewBox="-2 -2 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}

function ReviewGuide() {
  return (
    <ol className="wr-guide" aria-label="错题复习方法">
      {[
        ['collect', '收录错题', '在练习中遇到不熟悉的题目，随手收录。'],
        ['reflect', '回顾思路', '重新审题，看看解题思路与关键点。'],
        ['master', '巩固掌握', '反复思考，真正弄懂，避免再错。'],
      ].map(([type, title, description], index) => (
        <li key={type}>
          <span className="wr-guide-index" aria-hidden="true">
            0{index + 1}
          </span>
          <ReviewIcon type={type} />
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReviewMarginNote({ onRhythm }) {
  return (
    <aside className="wr-margin-note" aria-label="复习小笺">
      <div className="wr-note-heading">
        <span className="wr-note-mark" aria-hidden="true">
          习
        </span>
        <span>复习小笺</span>
        <i aria-hidden="true" />
      </div>
      <h3>
        把错过的，
        <br />
        变成真正懂得的。
      </h3>
      <p>
        先独立作答，再对照解析。
        <br />
        把卡住的一步写下来，
        <br />
        下次回看，思路便更清楚。
      </p>
      <button className="wr-note-rhythm-link" onClick={onRhythm}>
        看看间隔复习节奏 <span aria-hidden="true">↗</span>
      </button>
      <div className="wr-note-bottom">
        <span>循思而进</span>
        <svg viewBox="0 0 82 62" fill="none" aria-hidden="true">
          <circle cx="40" cy="30" r="22" />
          <path d="M8 49h64M18 49 49 9l15 40M49 9v40" />
          <path d="M44 49v-5h5" />
        </svg>
      </div>
    </aside>
  );
}

export default function WrongReview({
  token,
  userId,
  scheduleId,
  wrongQuestionId,
  onCloseSchedule,
  onOpenSchedule,
}) {
  const [panel, setPanel] = useState(
    () => sessionStorage.getItem('math-auth-review-panel') || 'questions',
  );
  function changePanel(value) {
    setPanel(value);
    sessionStorage.setItem('math-auth-review-panel', value);
  }
  const [selected, setSelected] = useState([]),
    [scheduleIds, setScheduleIds] = useState(null),
    [notice, setNotice] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [course, setCourse] = useState('');
  const [chapter, setChapter] = useState('');
  const [mastered, setMastered] = useState(false);
  const [review, setReview] = useState(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  function api(path = '', method = 'GET', body) {
    return requestJson(`wrong-questions${path}`, {
      token,
      method,
      body,
      errorMessage: '操作失败，请重试',
    });
  }

  async function load() {
    const data = await api();
    setItems(data.questions);
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => {
    if (!scheduleId) return;
    let live = true;
    reviewApi(token, `/${scheduleId}`)
      .then((d) => {
        if (!live) return;
        if (!d.question) throw new Error('原错题已删除，此安排无法作答，请返回安排取消。');
        setReview({ ...d.question, schedule: d.task });
        setAnswer(d.task.answer ?? (d.question.options?.length ? [] : ''));
        setResult(d.task.status === 'completed' ? { correct: d.task.correct } : null);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [scheduleId, token]);
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => items.some((i) => i.id === id && !i.mastered)));
  }, [items]);
  useEffect(() => {
    if (wrongQuestionId && !loading) {
      const item = items.find((q) => Number(q.id) === Number(wrongQuestionId));
      if (item) start(item);
      else setError('原错题已删除，请返回搜索');
    }
  }, [wrongQuestionId, loading]);
  function start(item) {
    setReview(item);
    setAnswer(item.options?.length ? [] : '');
    setResult(null);
    setError('');
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const data = review.schedule
        ? await reviewApi(token, `/${review.schedule.id}/submit`, {
            answer,
            version: review.schedule.version,
          })
        : await api(`/${review.id}/review`, 'POST', { answer });
      setResult(data);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function mark() {
    setBusy(true);
    setError('');
    try {
      await api(`/${confirm.id}`, 'PATCH', { mastered: !confirm.mastered });
      await load();
      setConfirm(null);
      setReview(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const courses = [
    ...new Map(items.map((item) => [String(item.course_id), item.course_title])).entries(),
  ];
  const chapters = [
    ...new Map(
      items
        .filter((item) => !course || String(item.course_id) === course)
        .map((item) => [String(item.chapter_id), item.chapter_title]),
    ).entries(),
  ];
  const visible = items.filter(
    (item) =>
      item.mastered === mastered &&
      (!course || String(item.course_id) === course) &&
      (!chapter || String(item.chapter_id) === chapter),
  );
  const expectedLetters = review
    ? answerLetters(review.answer_text, review.options || [], review.question_type)
    : [];
  const selectedLetters = review
    ? selectionLetters(answer, review.options || [], review.question_type)
    : [];
  return (
    <section className="wrong-review review-garden">
      <header className="wr-hero">
        <div className="wr-hero-copy">
          <p>温故 · 知新</p>
          <div className="wr-title-line">
            <h1>错题复习</h1>
            <span className="wr-title-seal" aria-hidden="true">
              温故
            </span>
          </div>
          <span className="wr-hero-intro">温故而知新，让每一次回看都有收获。</span>
        </div>
        <div className="wr-hero-art" aria-hidden="true">
          <img src="/assets/ink/review-notebook-hero-v1.png" alt="" width="2172" height="724" />
        </div>
      </header>
      {!review && !scheduleId && (
        <nav className="wr-section-tabs" aria-label="错题复习页面切换">
          <button
            aria-pressed={panel === 'questions'}
            className={panel === 'questions' ? 'active' : ''}
            onClick={() => changePanel('questions')}
          >
            错题本
          </button>
          <button
            aria-pressed={panel === 'schedule'}
            className={panel === 'schedule' ? 'active' : ''}
            onClick={() => changePanel('schedule')}
          >
            复习安排
          </button>
          <button
            aria-pressed={panel === 'reflections'}
            className={panel === 'reflections' ? 'active' : ''}
            onClick={() => changePanel('reflections')}
          >
            学习心得
          </button>
        </nav>
      )}
      {notice && (
        <p className="wr-notice" role="status">
          {notice} 可在“复习安排”中查看。
        </p>
      )}
      {scheduleId && !review && <button onClick={onCloseSchedule}>返回复习安排</button>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {review ? (
        <article className="wrong-detail">
          <button
            className="wr-link"
            onClick={() => (review.schedule ? onCloseSchedule() : setReview(null))}
            disabled={busy}
          >
            {review.schedule
              ? '← 返回复习安排'
              : panel === 'reflections'
                ? '← 返回学习心得'
                : '← 返回错题列表'}
          </button>
          {review.schedule && (
            <p className="wr-meta">
              复习日期：{review.schedule.date}
              {result ? ' · 已完成（答案已保存）' : ''}
            </p>
          )}
          <p className="wr-meta">
            {review.course_title} / {review.chapter_title} ·{' '}
            {questionTypeLabel(review.question_type)}
          </p>
          <h2>{review.question_text}</h2>
          {review.question_type === '简答题' && (
            <p className="wr-meta">本题采用标准答案文字比对，结果仅供参考。</p>
          )}
          {review.options?.length ? (
            <div className="wr-options answer-state-options">
              {review.options.map((option, index) => {
                const key = optionLetter(option, index);
                const correct = expectedLetters.includes(key);
                const picked = selectedLetters.includes(key);
                const status = result
                  ? correct
                    ? 'right'
                    : picked
                      ? 'wrong'
                      : ''
                  : picked
                    ? 'selected'
                    : '';
                return (
                  <button
                    key={index}
                    disabled={busy || result !== null}
                    className={status}
                    aria-pressed={picked}
                    onClick={() =>
                      setAnswer(
                        review.question_type === '多选题'
                          ? picked
                            ? selectedLetters.filter((value) => value !== key)
                            : [...selectedLetters, key]
                          : [key],
                      )
                    }
                  >
                    <span className="answer-option-content">{option}</span>
                    {status && (
                      <small className="answer-option-state">
                        {status === 'right'
                          ? picked
                            ? '✓ 所选正确'
                            : '✓ 正确答案'
                          : status === 'wrong'
                            ? '✕ 所选错误'
                            : '已选'}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              aria-label="你的答案"
              value={answer}
              disabled={busy || result !== null}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="填写你的答案"
            />
          )}
          {result && (
            <div className={`wr-feedback ${result.correct ? 'is-correct' : 'is-wrong'}`}>
              <strong>{result.correct ? '回答正确' : '本次未答对'}</strong>
              <p>正确答案：{review.answer_text}</p>
              <p>{review.analysis_text}</p>
              <small>答对后仍保留在错题本中，可手动标记已掌握。</small>
            </div>
          )}
          <WrongQuestionNote
            key={review.question_id}
            token={token}
            userId={userId}
            questionId={review.question_id}
            onSaved={load}
          />
          <footer>
            {result ? (
              <>
                <button onClick={() => start({ ...review, schedule: null })}>再练一次</button>
                <button
                  onClick={() => setConfirm(items.find((item) => item.id === review.id) || review)}
                >
                  {' '}
                  {review.mastered ? '恢复待复习' : '标记已掌握'}
                </button>
              </>
            ) : (
              <button
                className="wr-primary"
                disabled={busy || (Array.isArray(answer) ? !answer.length : !answer.trim())}
                onClick={submit}
              >
                {busy ? '正在提交…' : '提交答案'}
              </button>
            )}
          </footer>
        </article>
      ) : !scheduleId && panel === 'reflections' ? (
        <WrongReflections
          token={token}
          userId={userId}
          courses={courses}
          onOpen={async (id) => {
            try {
              const data = await api();
              setItems(data.questions);
              const item = data.questions.find((item) => Number(item.id) === Number(id));
              if (item) start(item);
              else setError('原题已删除，请刷新学习心得列表。');
            } catch (reason) {
              setError(reason.message);
            }
          }}
        />
      ) : !scheduleId && panel === 'schedule' ? (
        <ReviewSchedulePanel
          token={token}
          onOpen={onOpenSchedule}
          onChooseQuestions={() => {
            changePanel('questions');
            setMastered(false);
          }}
        />
      ) : (
        <>
          <div className="wr-toolbar">
            <div className="wr-tabs" role="group" aria-label="错题掌握状态">
              {[false, true].map((value) => (
                <button
                  key={String(value)}
                  aria-pressed={mastered === value}
                  className={mastered === value ? 'active' : ''}
                  onClick={() => setMastered(value)}
                >
                  {value ? '已掌握' : '待复习'}{' '}
                  <span>{items.filter((item) => item.mastered === value).length}</span>
                </button>
              ))}
            </div>
            <div className="wr-filters">
              <label className="wr-filter">
                <span className="wr-sr-only">课程筛选</span>
                <select
                  aria-label="课程筛选"
                  value={course}
                  onChange={(e) => {
                    setCourse(e.target.value);
                    setChapter('');
                  }}
                >
                  <option value="">全部课程</option>
                  {courses.map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
                <span className="wr-select-arrow" aria-hidden="true">
                  ⌄
                </span>
              </label>
              <label className="wr-filter">
                <span className="wr-sr-only">章节筛选</span>
                <select
                  aria-label="章节筛选"
                  value={chapter}
                  onChange={(e) => setChapter(e.target.value)}
                >
                  <option value="">全部章节</option>
                  {chapters.map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
                <span className="wr-select-arrow" aria-hidden="true">
                  ⌄
                </span>
              </label>
            </div>
          </div>
          {!mastered && visible.length > 0 && (
            <div className="wr-batch">
              <label>
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((i) => selected.includes(i.id))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...new Set([...selected, ...visible.map((i) => i.id)])]
                        : selected.filter((id) => !visible.some((i) => i.id === id)),
                    )
                  }
                />
                选择当前筛选的题目
              </label>
              <button disabled={!selected.length} onClick={() => setScheduleIds(selected)}>
                安排复习（{selected.length}）
              </button>
              <button disabled={!selected.length} onClick={() => setSelected([])}>
                清除选择
              </button>
            </div>
          )}
          {loading ? (
            <p className="wr-empty" role="status">
              正在加载错题…
            </p>
          ) : error ? (
            <div className="wr-load-error">
              <p>错题暂时未能加载，请稍后重试。</p>
              <button
                onClick={() => {
                  setError('');
                  setLoading(true);
                  load()
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                重新加载
              </button>
            </div>
          ) : visible.length ? (
            <div className="wr-list">
              {visible.map((item) => (
                <article key={item.id}>
                  {!item.mastered && (
                    <label className="wr-select">
                      <input
                        type="checkbox"
                        aria-label={`选择错题：${item.question_text}`}
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, item.id]
                              : selected.filter((id) => id !== item.id),
                          )
                        }
                      />
                      选择此题
                    </label>
                  )}
                  <p className="wr-meta">
                    {item.course_title} / {item.chapter_title} · 答错 {item.wrong_count} 次
                  </p>
                  <h2>{item.question_text}</h2>
                  {item.options?.length > 0 && (
                    <ol className="wr-list-options">
                      {item.options.map((option, index) => (
                        <li key={index}>{option}</li>
                      ))}
                    </ol>
                  )}
                  <p className="wr-meta">
                    最近答案：
                    {Array.isArray(item.last_answer)
                      ? item.last_answer.join('、')
                      : item.last_answer}
                  </p>
                  <details>
                    <summary>查看答案与解析</summary>
                    <p>正确答案：{item.answer_text}</p>
                    <p>{item.analysis_text}</p>
                  </details>
                  <footer>
                    <button className="wr-primary" onClick={() => start(item)}>
                      重新作答
                    </button>
                    {!item.mastered && (
                      <button onClick={() => setScheduleIds([item.id])}>安排复习</button>
                    )}
                    <button onClick={() => setConfirm(item)}>
                      {item.mastered ? '恢复待复习' : '标记已掌握'}
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="wr-empty wr-empty-designed">
              <div className="wr-empty-main">
                <div className="wr-empty-drawing" aria-hidden="true">
                  <img
                    src="/assets/ink/review-book-sprout-v1.png"
                    alt=""
                    width="2172"
                    height="724"
                  />
                </div>
                <h2>
                  {course || chapter
                    ? '这里还没有符合筛选的错题'
                    : mastered
                      ? '每一次掌握，都值得留下'
                      : '暂无待复习的错题'}
                </h2>
                <p>
                  {course || chapter
                    ? '换一个课程或章节，看看其他学习记录。'
                    : mastered
                      ? '复习后标记“已掌握”，便会收录在这里。'
                      : '把需要再想一想的题目收进来，下次一起理清。'}
                </p>
                {course || chapter ? (
                  <button
                    onClick={() => {
                      setCourse('');
                      setChapter('');
                    }}
                  >
                    清除筛选
                  </button>
                ) : !mastered && items.some((item) => item.mastered) ? (
                  <button onClick={() => setMastered(true)}>
                    回看已掌握的题目 <span aria-hidden="true">↗</span>
                  </button>
                ) : null}
              </div>
              <ReviewMarginNote onRhythm={() => changePanel('schedule')} />
            </div>
          )}
        </>
      )}
      {!review && !scheduleId && panel === 'questions' && !loading && !error && <ReviewGuide />}
      <div className="wr-page-foot">
        <span>数有方 · 让学习有迹可循</span>
      </div>
      {scheduleIds && (
        <SchedulePicker
          token={token}
          ids={scheduleIds}
          onClose={() => setScheduleIds(null)}
          onSaved={(message) => {
            setNotice(message);
            setSelected([]);
            changePanel('schedule');
          }}
        />
      )}
      {confirm && (
        <div className="modal-backdrop">
          <PaperDialog
            busy={busy}
            onDismiss={() => setConfirm(null)}
            className="record-modal name-editor-modal student-dialog-confirm"
          >
            <h2>{confirm.mastered ? '恢复为待复习？' : '标记为已掌握？'}</h2>
            <p>这道题的答案和复习记录会保留。</p>
            <div className="rename-actions">
              <button className="outline-button" disabled={busy} onClick={() => setConfirm(null)}>
                取消
              </button>
              <button className="create-course" disabled={busy} onClick={mark}>
                {busy ? '保存中…' : '确认'}
              </button>
            </div>
          </PaperDialog>
        </div>
      )}
    </section>
  );
}
