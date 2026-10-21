import { requestJson as request } from './api-client.mjs';
import PaperDialog from './PaperDialog.jsx';
import { registerAccountGuard } from './account-state.js';
import {
  questionTypeLabel,
  optionLetter,
  answerLetters,
  selectionLetters,
} from '../../shared/question-types.mjs';
import { formatDate } from './date-format.mjs';
import { useEffect, useRef, useState } from 'react';

export const practiceTypes = ['单选题', '多选题', '判断题', '填空题', '简答题'];

export function PracticePanel({ chapter, practices, onGenerate, onStart, onDeletePractice }) {
  return (
    <section className="practice-panel">
      <div className="practice-panel-head">
        <div className="practice-panel-intro">
          <p className="eyebrow">章节练习 · 温故知新</p>
          <h3>{chapter?.title || '本章练习'}</h3>
          <p>从本章资料生成题目并直接开始答题，巩固核心概念与方法。</p>
        </div>
        <button className="create-course practice-ai-trigger" type="button" onClick={onGenerate}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M8 1.8 9.4 5.2 12.8 6.6 9.4 8 8 11.4 6.6 8 3.2 6.6 6.6 5.2 8 1.8Z"
              strokeLinejoin="round"
            />
            <path
              d="M12.6 10.8 13.2 12.3 14.7 12.9 13.2 13.5 12.6 15 12 13.5 10.5 12.9 12 12.3 12.6 10.8Z"
              strokeLinejoin="round"
            />
          </svg>
          <span>AI 出题</span>
        </button>
      </div>
      {practices.length ? (
        <div className="practice-list">
          {practices.map((practice, index) => (
            <article key={practice.id}>
              <div>
                <span>练习 {practices.length - index}</span>
                <strong>{practice.title}</strong>
                <small>
                  {practice.attempt_count
                    ? `已完成 ${practice.attempt_count} 次 · 最近 ${practice.latest_attempt?.correct_count ?? 0}/${practice.latest_attempt?.total_count ?? practice.questions?.length ?? 0} 正确 · `
                    : ''}
                  {practice.questions?.length || practice.question_count || 0} 道题 ·{' '}
                  {formatDate(practice.created_at)} 保存
                </small>
              </div>
              <div className="practice-card-actions">
                <button className="outline-button" type="button" onClick={() => onStart(practice)}>
                  {practice.in_progress ? '继续答题' : '开始答题'}
                </button>
                <button
                  className="practice-delete"
                  type="button"
                  onClick={() => onDeletePractice(practice)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="practice-empty">
          <span className="practice-empty-seal" aria-hidden="true">
            习
          </span>
          <strong>本章还没有练习</strong>
          <p>点击“AI 出题”即可按章节内容智能拟定习题，开始针对性练习。</p>
          <div className="practice-empty-tags" aria-hidden="true">
            <span>快速巩固 · 5题</span>
            <span>综合练习 · 10题</span>
            <span>进阶挑战 · 10题</span>
            <span>支持自定义题型</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function PracticeAnswering({
  practice,
  userId,
  onBack,
  onComplete,
  onSaveProgress,
  onReadChapter,
}) {
  const draftKey = `math-auth-draft-${userId}-${practice.id}`;
  const localDraft = (() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || 'null')?.answers || null;
    } catch {
      return null;
    }
  })();
  const savedAnswers = practice.latest_attempt?.answers || [];
  const [answers, setAnswers] = useState(() =>
    practice.history_view
      ? Object.fromEntries(savedAnswers.map((item) => [item.questionIndex, item.answer]))
      : localDraft ||
        practice.in_progress?.answers ||
        Object.fromEntries(savedAnswers.map((item) => [item.questionIndex, item.answer])),
  );
  const [gradedAttempt, setGradedAttempt] = useState(
    practice.history_view || (!localDraft && !practice.in_progress)
      ? practice.latest_attempt || null
      : null,
  );
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [saveState, setSaveState] = useState('');
  const pendingSave = useRef(null);
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const [addedWrong, setAddedWrong] = useState(() =>
    Object.fromEntries(
      (practice.questions || []).map((question, index) => [index, Boolean(question.in_wrong_book)]),
    ),
  );
  const [addingWrong, setAddingWrong] = useState(null);
  const [wrongError, setWrongError] = useState('');
  const [completing, setCompleting] = useState(false);
  const flushProgress = () => {
    window.clearTimeout(saveTimer.current);
    if (pendingSave.current === null) return saveQueue.current;
    const snapshot = pendingSave.current;
    pendingSave.current = null;
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => onSaveProgress(snapshot))
      .then(() => {
        if (pendingSave.current === null) {
          localStorage.removeItem(draftKey);
          setSaveState('已保存');
        }
      })
      .catch((reason) => setSaveState(`同步失败，答案已保存在本机：${reason.message}`));
    return saveQueue.current;
  };
  const saveProgress = (next) => {
    localStorage.setItem(draftKey, JSON.stringify({ answers: next }));
    pendingSave.current = next;
    setSaveState('正在保存…');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushProgress, 400);
  };
  useEffect(
    () =>
      registerAccountGuard(async () => {
        await flushProgress();
        if (localStorage.getItem(draftKey)) throw new Error('答案尚未同步，请先重试保存后切换账号');
      }),
    [],
  );
  useEffect(
    () => () => {
      if (pendingSave.current !== null) flushProgress();
    },
    [],
  );
  const choose = (question, index, option, optionIndex) => {
    if (gradedAttempt) return;
    const letter = optionLetter(option, optionIndex);
    const current = selectionLetters(answers[index], question.options || [], question.type);
    const next =
      question.type === '多选题'
        ? current.includes(letter)
          ? current.filter((item) => item !== letter)
          : [...current, letter]
        : [letter];
    const updated = { ...answers, [index]: next };
    setAnswers(updated);
    saveProgress(updated);
  };
  const retry = () => {
    // 空对象表示删除进度；逐题空答案表示已开始新一轮作答。
    const freshAnswers = Object.fromEntries(
      (practice.questions || []).map((question, index) => [
        index,
        question.options?.length ? [] : '',
      ]),
    );
    setOnlyWrong(false);
    setAnswers(freshAnswers);
    setGradedAttempt(null);
    saveProgress(freshAnswers);
    requestAnimationFrame(() =>
      document
        .querySelector('.answer-question')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };
  const submitPaper = async () => {
    const records = (practice.questions || []).map((question, index) => {
      const answer = answers[index] ?? (question.options?.length ? [] : '');
      const correctLetters = answerLetters(question.answer, question.options || [], question.type);
      const correct = question.options?.length
        ? Array.isArray(answer) &&
          answer.length === correctLetters.length &&
          answer.every((letter) => correctLetters.includes(letter))
        : String(answer).trim().toLowerCase() ===
          String(question.answer || '')
            .trim()
            .toLowerCase();
      return { questionIndex: index, answer, correct };
    });
    setCompleting(true);
    try {
      await flushProgress();
      await saveQueue.current;
      const attempt = await onComplete(records);
      localStorage.removeItem(draftKey);
      setSaveState('');
      setGradedAttempt(attempt);
      requestAnimationFrame(() =>
        document
          .querySelector('.practice-answering-header')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    } catch {
      /* The course page shows the request error. */
    } finally {
      setCompleting(false);
    }
  };
  const addWrong = async (index) => {
    if (!gradedAttempt?.id || addingWrong !== null) return;
    setAddingWrong(index);
    setWrongError('');
    try {
      await request(
        `courses/${practice.course_id}/practices/${practice.id}/attempts/${gradedAttempt.id}/wrong-questions/${index}`,
        { token: localStorage.token, method: 'POST' },
      );
      setAddedWrong((current) => ({ ...current, [index]: true }));
    } catch (reason) {
      setWrongError(reason.message);
    } finally {
      setAddingWrong(null);
    }
  };
  return (
    <section className="practice-answering">
      <header className="practice-answering-header">
        <div>
          <p className="eyebrow">同步练习</p>
          <h3>{practice.title}</h3>
          <p>
            {gradedAttempt
              ? `已交卷 · 答对 ${gradedAttempt.correct_count}/${gradedAttempt.total_count} 题`
              : '完成整份练习后交卷，再查看对错和解析。'}
          </p>
          {!gradedAttempt && saveState && (
            <small
              className={
                saveState.startsWith('同步失败') ? 'practice-save-error' : 'practice-save-state'
              }
            >
              {saveState}
            </small>
          )}
          {wrongError && <p className="form-error">{wrongError}</p>}
        </div>
      </header>
      {gradedAttempt && (
        <div className="practice-review-tools">
          <label>
            <input
              type="checkbox"
              checked={onlyWrong}
              onChange={(event) => setOnlyWrong(event.target.checked)}
            />
            只看错题和未答题
          </label>
          <button type="button" onClick={onReadChapter}>
            复习本章资料
          </button>
        </div>
      )}
      <div className="answer-question-list">
        {(practice.questions || []).map((question, index) => {
          const options = question.options || [];
          const selected = selectionLetters(answers[index], options, question.type);
          const result = gradedAttempt?.answers?.find(
            (item) => Number(item.questionIndex) === index,
          );
          if (gradedAttempt && onlyWrong && result?.correct) return null;
          const correctLetters = answerLetters(
            question.answer,
            question.options || [],
            question.type,
          );
          const isChoice = options.length > 0;
          return (
            <article className="answer-question" key={question.id || index}>
              <div className="answer-question-title">
                <span>{index + 1}</span>
                <small>{questionTypeLabel(question.type)}</small>
              </div>
              <p>{question.question}</p>
              {isChoice ? (
                <div className="answer-options answer-state-options">
                  {options.map((option, optionIndex) => {
                    const letter = optionLetter(option, optionIndex);
                    const picked = selected.includes(letter);
                    const right = correctLetters.includes(letter);
                    const status = gradedAttempt
                      ? right
                        ? 'correct'
                        : picked
                          ? 'wrong'
                          : ''
                      : picked
                        ? 'picked'
                        : '';
                    return (
                      <button
                        className={status}
                        key={optionIndex}
                        type="button"
                        disabled={Boolean(gradedAttempt)}
                        aria-pressed={picked}
                        onClick={() => choose(question, index, option, optionIndex)}
                      >
                        <b>{letter}</b>
                        <span className="answer-option-content">
                          {String(option).replace(/^[A-Z][、.．:：\s]*/i, '')}
                        </span>
                        {status && (
                          <small className="answer-option-state">
                            {status === 'correct'
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
                <div className="text-answer">
                  <textarea
                    value={answers[index] || ''}
                    placeholder="输入你的答案"
                    disabled={Boolean(gradedAttempt)}
                    onChange={(event) => {
                      const updated = { ...answers, [index]: event.target.value };
                      setAnswers(updated);
                      saveProgress(updated);
                    }}
                  />
                </div>
              )}
              {gradedAttempt && (
                <div className={`answer-feedback ${result?.correct ? 'is-correct' : 'is-wrong'}`}>
                  <strong>
                    {result?.correct ? '回答正确' : result?.answered ? '回答不正确' : '未作答'}
                  </strong>
                  <p>正确答案：{question.answer}</p>
                  {question.analysis && (
                    <details className="answer-analysis">
                      <summary>查看解析</summary>
                      <p>{question.analysis}</p>
                    </details>
                  )}
                  {result?.answered && !result.correct && (
                    <button
                      className="answer-add-wrong"
                      type="button"
                      disabled={addedWrong[index] || addingWrong === index}
                      onClick={() => addWrong(index)}
                    >
                      {addedWrong[index]
                        ? '已加入错题本'
                        : addingWrong === index
                          ? '正在加入…'
                          : '加入错题本'}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {gradedAttempt && onlyWrong && gradedAttempt.answers?.every((item) => item.correct) && (
          <p>这次全部答对了。</p>
        )}
      </div>
      <footer className="practice-answering-footer">
        {gradedAttempt ? (
          <>
            {!practice.history_view && (
              <button className="outline-button" type="button" onClick={retry}>
                再练一次
              </button>
            )}
            <button className="create-course" type="button" onClick={onBack}>
              完成
            </button>
          </>
        ) : (
          <button
            className="create-course"
            type="button"
            disabled={completing}
            onClick={submitPaper}
          >
            {completing ? '正在交卷…' : '交卷'}
          </button>
        )}
      </footer>
    </section>
  );
}

export const practiceTemplates = [
  {
    id: 'quick',
    name: '快速巩固',
    detail: '5 道 · 基础',
    desc: '单选为主，快速回顾核心概念',
    difficulty: '基础',
    questionCounts: [{ type: '单选题', count: 5 }],
  },
  {
    id: 'standard',
    name: '综合练习',
    detail: '10 道 · 适中',
    desc: '单选 6 · 多选 2 · 判断 2',
    difficulty: '适中',
    questionCounts: [
      { type: '单选题', count: 6 },
      { type: '多选题', count: 2 },
      { type: '判断题', count: 2 },
    ],
  },
  {
    id: 'challenge',
    name: '进阶挑战',
    detail: '10 道 · 提高',
    desc: '单选 4 · 多选 4 · 判断 2',
    difficulty: '提高',
    questionCounts: [
      { type: '单选题', count: 4 },
      { type: '多选题', count: 4 },
      { type: '判断题', count: 2 },
    ],
  },
];

export function QuestionSettingsModal({ chapter, onClose, onGenerate }) {
  const [templateId, setTemplateId] = useState('standard');
  const [counts, setCounts] = useState({ 单选题: 3, 多选题: 0, 判断题: 0, 填空题: 0, 简答题: 0 });
  const [difficulty, setDifficulty] = useState('适中');
  const [requirements, setRequirements] = useState('');
  const template = practiceTemplates.find((item) => item.id === templateId);
  const questionCounts = template
    ? template.questionCounts
    : practiceTypes
        .filter((type) => Number(counts[type]) > 0)
        .map((type) => ({ type, count: Number(counts[type]) }));
  const total = questionCounts.reduce((sum, item) => sum + item.count, 0);
  const activeDifficulty = template?.difficulty || difficulty;
  const submit = async (event) => {
    event.preventDefault();
    if (!total || total > 20) return;
    if (await onGenerate({ questionCounts, difficulty: activeDifficulty, requirements })) onClose();
  };
  return (
    <div className="modal-backdrop">
      <PaperDialog
        as="form"
        onDismiss={onClose}
        className="record-modal question-settings-modal"
        onSubmit={submit}
      >
        <div className="modal-header">
          <div className="question-modal-title-group">
            <p className="eyebrow">AI 智能出题 · 研习策问</p>
            <h2>选择练习模板</h2>
            <small className="question-chapter-badge">当前章节：{chapter.title}</small>
          </div>
          <button className="icon-close" type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="practice-template-list">
          {practiceTemplates.map((item) => (
            <button
              className={templateId === item.id ? 'selected' : ''}
              type="button"
              aria-pressed={templateId === item.id}
              key={item.id}
              onClick={() => setTemplateId(item.id)}
            >
              <div className="template-card-top">
                <strong>{item.name}</strong>
                <span className="template-pill">{item.detail}</span>
              </div>
              <small className="template-desc">{item.desc}</small>
            </button>
          ))}
          <button
            className={templateId === 'custom' ? 'selected' : ''}
            type="button"
            aria-pressed={templateId === 'custom'}
            onClick={() => setTemplateId('custom')}
          >
            <div className="template-card-top">
              <strong>自定义</strong>
              <span className="template-pill">按需调整</span>
            </div>
            <small className="template-desc">自由搭配 5 类题型与难度</small>
          </button>
        </div>
        {templateId === 'custom' && (
          <div className="question-custom-panel">
            <div className="question-type-grid">
              {practiceTypes.map((type) => (
                <label key={type}>
                  <span>{type}</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={counts[type]}
                    onChange={(event) =>
                      setCounts((current) => ({
                        ...current,
                        [type]:
                          event.target.value === ''
                            ? 0
                            : Math.min(10, Math.max(0, Number(event.target.value))),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <fieldset className="difficulty-field">
              <legend>难度</legend>
              {['基础', '适中', '提高'].map((item) => (
                <label key={item} className={difficulty === item ? 'is-checked' : ''}>
                  <input
                    type="radio"
                    name="difficulty"
                    checked={difficulty === item}
                    onChange={() => setDifficulty(item)}
                  />
                  {item}
                </label>
              ))}
            </fieldset>
          </div>
        )}
        <div className="question-summary-bar">
          <p className={total > 20 ? 'form-error' : 'question-total'}>
            共 <b>{total}</b> 道题{total > 20 ? '，一次最多 20 道' : ''}
          </p>
          <span className="question-summary-meta">
            难度：{activeDifficulty} ·{' '}
            {questionCounts.map((q) => `${q.type} ${q.count}`).join(' / ') || '请选择题量'}
          </span>
        </div>
        <label className="question-requirements">
          <span>给 AI 的补充意见（可选）</span>
          <textarea
            value={requirements}
            maxLength="500"
            onChange={(event) => setRequirements(event.target.value)}
            placeholder="例如：侧重概念辨析与原理理解，结合教材实例出题…"
          />
        </label>
        <div className="rename-actions">
          <button className="outline-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="create-course" disabled={!total || total > 20} type="submit">
            后台生成题目
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}

export function QuestionPreviewModal({
  data,
  onClose,
  onSaveDraft,
  onSavePractice,
  onRegenerateOne,
}) {
  const [questions, setQuestions] = useState(data.questions);
  const [title, setTitle] = useState(`${data.chapter.title}练习`);
  const [saving, setSaving] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);
  const updateQuestion = (index, field, value) =>
    setQuestions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    );
  const updateOption = (index, optionIndex, value) =>
    setQuestions((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              options: item.options.map((option, currentIndex) =>
                currentIndex === optionIndex ? value : option,
              ),
            }
          : item,
      ),
    );
  return (
    <PaperDialog
      busy={saving || regeneratingIndex !== null}
      onDismiss={onClose}
      className="question-preview-modal"
    >
      <header className="modal-header">
        <div>
          <p className="eyebrow">AI 智能出题</p>
          <h2>预览并整理题目</h2>
          <small>确认后保存为章节练习。答案和解析默认收起。</small>
        </div>
        <button className="icon-close" type="button" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="question-preview-body">
        {questions.map((question, index) => (
          <QuestionEditor
            key={index}
            question={question}
            index={index}
            regenerating={regeneratingIndex === index}
            onChange={updateQuestion}
            onOptionChange={updateOption}
            onRegenerate={async () => {
              setRegeneratingIndex(index);
              try {
                const next = await onRegenerateOne(question);
                if (next)
                  setQuestions((current) =>
                    current.map((item, itemIndex) => (itemIndex === index ? next : item)),
                  );
              } finally {
                setRegeneratingIndex(null);
              }
            }}
            onDelete={() =>
              setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        ))}
        {!questions.length && (
          <div className="practice-empty">
            <strong>还没有题目</strong>
            <p>关闭后可以重新生成。</p>
          </div>
        )}
      </div>
      <footer className="question-preview-footer">
        <label>
          练习名称
          <input value={title} maxLength="120" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div>
          <button
            className="outline-button"
            type="button"
            disabled={saving || !questions.length}
            onClick={async () => {
              setSaving(true);
              try {
                await onSaveDraft(data.settings, questions);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '正在保存…' : '保存草稿'}
          </button>
          <button
            className="create-course"
            type="button"
            disabled={saving || !questions.length || !title.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSavePractice(title.trim(), questions);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '正在保存…' : '确认并保存练习'}
          </button>
        </div>
      </footer>
    </PaperDialog>
  );
}

export function QuestionEditor({
  question,
  index,
  regenerating,
  onChange,
  onOptionChange,
  onRegenerate,
  onDelete,
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="question-editor">
      <header>
        <span>{index + 1}</span>
        <select
          value={question.type}
          onChange={(event) => onChange(index, 'type', event.target.value)}
        >
          {practiceTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <button
          className="regenerate-question"
          type="button"
          disabled={regenerating}
          onClick={onRegenerate}
        >
          {regenerating ? '正在生成…' : '重新生成'}
        </button>
        <button className="danger-text" type="button" onClick={onDelete}>
          删除
        </button>
      </header>
      <label>
        题干
        <textarea
          value={question.question}
          onChange={(event) => onChange(index, 'question', event.target.value)}
        />
      </label>
      {question.options?.length > 0 && (
        <div className="question-options">
          {question.options.map((option, optionIndex) => (
            <input
              key={optionIndex}
              value={option}
              onChange={(event) => onOptionChange(index, optionIndex, event.target.value)}
            />
          ))}
        </div>
      )}
      <button
        className="answer-toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? '收起答案与解析' : '查看答案与解析'}
      </button>
      {expanded && (
        <div className="question-answer">
          <label>
            答案
            <input
              value={question.answer}
              onChange={(event) => onChange(index, 'answer', event.target.value)}
            />
          </label>
          <label>
            解析
            <textarea
              value={question.analysis}
              onChange={(event) => onChange(index, 'analysis', event.target.value)}
            />
          </label>
        </div>
      )}
    </article>
  );
}

export function PracticeRemovalModal({ removal, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  busy.current = saving;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy.current) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <PaperDialog
        busy={saving}
        onDismiss={onClose}
        className="record-modal name-editor-modal confirm-action-modal practice-removal-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">章节练习 · 删除确认</p>
            <h2>{removal.title}</h2>
            <small>{removal.message}</small>
          </div>
          <button
            className="icon-close"
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="关闭"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="rename-actions">
          <button className="outline-button" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            className="create-course confirm-danger"
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '正在删除…' : '删除练习'}
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}
