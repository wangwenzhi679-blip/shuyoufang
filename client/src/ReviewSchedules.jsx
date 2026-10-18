import { requestJson } from './api-client.mjs';
import PaperDialog from './PaperDialog.jsx';
import { formatDateTime, formatDate } from './date-format.mjs';
import {
  buildReviewDates,
  addReviewDays,
  summarizeReviewRhythm,
} from '../../shared/review-rhythm.mjs';
import ReviewRhythm from './ReviewRhythm.jsx';
import React, { useEffect, useMemo, useState } from 'react';
import './review-schedules.css';
export const reviewApi = (token, path = '', body, method = 'POST') =>
  requestJson(`review-schedules${path}`, {
    token,
    body,
    method: body ? method : 'GET',
    errorMessage: '复习安排操作失败',
  });

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
function ReviewModal({ title, children, onClose, onSave, busy, canSave = true, action = '保存' }) {
  return (
    <div className="modal-backdrop">
      <PaperDialog
        busy={busy}
        onDismiss={onClose}
        className={`record-modal review-schedule-dialog ${title === '安排错题复习' ? 'student-dialog-wide' : title === '修改复习日期' ? 'student-dialog-form' : 'student-dialog-confirm'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button aria-label="关闭复习安排弹窗" disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>
        {children}
        <footer className="rename-actions">
          <button disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !canSave} onClick={onSave}>
            {busy ? '处理中…' : action}
          </button>
        </footer>
      </PaperDialog>
    </div>
  );
}
export function SchedulePicker({ token, ids, onClose, onSaved }) {
  const [strategy, setStrategy] = useState('spaced');
  const [firstDay, setFirstDay] = useState(() => addReviewDays(today(), 1));
  const [singleDay, setSingleDay] = useState(today);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const day = strategy === 'spaced' ? firstDay : singleDay;
  let dates = [];
  try {
    dates = buildReviewDates(day, strategy);
  } catch {}
  const canSave =
    dates.length > 0 &&
    dates.every((date) => date >= today() && date <= addReviewDays(today(), 366));
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const d = await reviewApi(token, '', { wrongQuestionIds: ids, date: day, strategy });
      onSaved(d.message);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ReviewModal
      title="安排错题复习"
      onClose={onClose}
      onSave={save}
      busy={busy}
      canSave={canSave}
      action={strategy === 'spaced' ? '确认五轮安排' : '确认安排'}
    >
      <p className="rhy-picker-intro">
        已选择 <strong>{ids.length}</strong> 道错题，为它们留出回看的时间。
      </p>
      <div className="rhy-strategies" role="group" aria-label="复习方式">
        <button
          aria-pressed={strategy === 'spaced'}
          className={strategy === 'spaced' ? 'active' : ''}
          disabled={busy}
          onClick={() => {
            setStrategy('spaced');
            setError('');
          }}
        >
          <strong>
            间隔复习 <small>推荐</small>
          </strong>
          <span>分五轮，逐步拉长间隔</span>
        </button>
        <button
          aria-pressed={strategy === 'single'}
          className={strategy === 'single' ? 'active' : ''}
          disabled={busy}
          onClick={() => {
            setStrategy('single');
            setError('');
          }}
        >
          <strong>单次复习</strong>
          <span>自己选一天回看</span>
        </button>
      </div>
      <label>
        {strategy === 'spaced' ? '首次复习日期' : '复习日期'}
        <input
          type="date"
          required
          disabled={busy}
          min={today()}
          max={addReviewDays(today(), strategy === 'spaced' ? 337 : 366)}
          value={day}
          onChange={(e) => {
            strategy === 'spaced' ? setFirstDay(e.target.value) : setSingleDay(e.target.value);
            setError('');
          }}
        />
      </label>
      {strategy === 'spaced' && (
        <div className="rhy-date-preview">
          <div>
            <strong>五轮复习</strong>
            <span>首次为第1天，后续在第3、7、14、30天回看</span>
          </div>
          <ol>
            {dates.map((date, index) => (
              <li key={date}>
                <span>第{index + 1}轮</span>
                <time dateTime={date} title={formatDate(date)}>
                  {date.slice(5).replace('-', ' / ')}
                </time>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="rhy-picker-foot">
        {strategy === 'spaced'
          ? '保存后可逐项改期或取消；同题同日已有的安排会保留。'
          : '同一道题同一天保留一份安排，交卷后记录完成。'}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </ReviewModal>
  );
}
export function ReviewSchedulePanel({ token, compact = false, onOpen, onAll, onChooseQuestions }) {
  const [data, setData] = useState({ today: today(), tasks: [] }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [mode, setMode] = useState('pending'),
    [dueOnly, setDueOnly] = useState(
      () => sessionStorage.getItem('math-auth-review-due-only') === 'true',
    ),
    [selectedRound, setSelectedRound] = useState(null),
    [modal, setModal] = useState(null),
    [day, setDay] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const d = await reviewApi(token);
    setData(d);
    setError('');
    setLoading(false);
  };
  useEffect(() => {
    let live = true;
    const refresh = () =>
      reviewApi(token)
        .then((d) => {
          if (live) {
            setData(d);
            setError('');
            setLoading(false);
          }
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setLoading(false);
          }
        });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token]);
  const rhythm = useMemo(
    () => summarizeReviewRhythm(data.tasks, data.today),
    [data.tasks, data.today],
  );
  const activeRoundInfo = selectedRound
    ? rhythm.rounds.find((r) => r.round === selectedRound)
    : null;
  const tasks = data.tasks.filter((t) => {
    if (compact) return t.status === 'pending' && t.available && t.date <= data.today;
    if (t.status !== mode) return false;
    if (dueOnly && mode === 'pending' && !(t.available && t.date <= data.today)) return false;
    if (selectedRound && rhythm.taskRoundMap[t.id]?.round !== selectedRound) return false;
    return true;
  });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await reviewApi(
        token,
        `/${modal.task.id}`,
        { version: modal.task.version, ...(modal.type === 'date' ? { date: day } : {}) },
        modal.type === 'date' ? 'PATCH' : 'DELETE',
      );
      setModal(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!compact && (
        <ReviewRhythm
          tasks={data.tasks}
          today={data.today}
          rhythm={rhythm}
          selectedRound={selectedRound}
          onSelectRound={setSelectedRound}
          onChooseQuestions={onChooseQuestions}
        />
      )}
      <section className={`review-schedule-panel ${compact ? 'compact' : ''}`}>
        <header>
          <div>
            <h2>{compact ? '待复习错题' : '错题复习安排'}</h2>
            {compact && <p>今天和之前尚未完成的复习。</p>}
          </div>
          {!compact && activeRoundInfo && (
            <button
              type="button"
              className="schedule-round-filter-chip"
              onClick={() => setSelectedRound(null)}
            >
              仅看：{activeRoundInfo.label}（{activeRoundInfo.dayLabel}·{activeRoundInfo.title}） ×
            </button>
          )}
          {compact && <button onClick={onAll}>全部安排</button>}
        </header>
        {!compact && (
          <div className="schedule-tabs">
            {['pending', 'completed'].map((m) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
                {m === 'pending' ? '待复习' : '已完成'}（
                {
                  data.tasks.filter(
                    (t) =>
                      t.status === m &&
                      (!selectedRound || rhythm.taskRoundMap[t.id]?.round === selectedRound),
                  ).length
                }
                ）
              </button>
            ))}
          </div>
        )}
        {!compact && mode === 'pending' && (
          <label className="schedule-due-filter">
            <input
              type="checkbox"
              checked={dueOnly}
              onChange={(e) => {
                setDueOnly(e.target.checked);
                sessionStorage.setItem('math-auth-review-due-only', String(e.target.checked));
              }}
            />
            只看今天及逾期安排
          </label>
        )}
        {error && !modal && (
          <p className="form-error" role="alert">
            {error}
            <button onClick={() => load().catch((e) => setError(e.message))}>重新加载</button>
          </p>
        )}
        {loading ? (
          <p>正在加载复习安排…</p>
        ) : !tasks.length ? (
          <p className="schedule-empty">
            {compact
              ? '目前没有需要复习的错题。'
              : selectedRound
                ? `当前筛选的${activeRoundInfo?.label || ''}暂无${mode === 'completed' ? '已完成' : '待复习'}记录。`
                : mode === 'completed'
                  ? '完成复习后会在这里保留答案与结果。'
                  : '从错题本选择未掌握的题目，设置复习日期。'}
          </p>
        ) : (
          <div className="schedule-rows">
            {(compact ? tasks.slice(0, 8) : tasks).map((t) => {
              const roundInfo = rhythm.taskRoundMap[t.id];
              return (
                <article key={t.id}>
                  <div>
                    <strong>{t.title}</strong>
                    <small>
                      {roundInfo && (
                        <span className="schedule-round-badge">
                          {roundInfo.label} · {roundInfo.dayLabel}
                        </span>
                      )}
                      {t.courseTitle} · {t.chapterTitle} · {t.date}
                      {t.status === 'pending' && t.date < data.today ? ' · 已逾期' : ''}
                      {!t.available ? ' · 原错题已删除' : ''}
                    </small>
                    {t.status === 'completed' && (
                      <small>
                        {t.correct ? '回答正确' : '本次未答对'} · {formatDateTime(t.completedAt)}
                      </small>
                    )}
                  </div>
                  <div className="schedule-actions">
                    {(t.available || t.status === 'completed') && (
                      <button className="schedule-open" onClick={() => onOpen(t.id)}>
                        {t.status === 'completed' ? '查看结果' : '开始复习'}
                      </button>
                    )}
                    {t.status === 'pending' && (
                      <>
                        {t.available && (
                          <button
                            onClick={() => {
                              setDay(t.date);
                              setError('');
                              setModal({ type: 'date', task: t });
                            }}
                          >
                            改日期
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setError('');
                            setModal({ type: 'cancel', task: t });
                          }}
                        >
                          取消安排
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {compact && tasks.length > 8 && (
          <button onClick={onAll}>查看其余 {tasks.length - 8} 项</button>
        )}
        {modal && (
          <ReviewModal
            title={modal.type === 'date' ? '修改复习日期' : '取消复习安排？'}
            busy={busy}
            onClose={() => setModal(null)}
            onSave={save}
            action={modal.type === 'date' ? '保存日期' : '取消安排'}
          >
            {modal.type === 'date' ? (
              <label>
                复习日期
                <input
                  type="date"
                  min={data.today}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
            ) : (
              <p>取消“{modal.task.title}”的这次安排，错题和已有答题历史会保留。</p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </ReviewModal>
        )}
      </section>
    </>
  );
}
