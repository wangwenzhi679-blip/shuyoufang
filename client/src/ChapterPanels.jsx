import PaperDialog from './PaperDialog.jsx';
import { formatDateTime } from './date-format.mjs';
import { useEffect, useState } from 'react';
import { NoteExcerpt } from './LearningNotes';

export function ChapterDraftPreviewModal({ chapters, onClose, onAdopt }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
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
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <PaperDialog
        onDismiss={onClose}
        className="record-modal chapter-draft-preview"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">AI 整理章节 · 目录建议</p>
            <h2>查看建议目录</h2>
            <small>
              采用目录会替换原有章节，并清除其笔记、书签、练习、答卷及关联复习记录；原资料保留。已有学习记录时，请先备份再采用。
            </small>
          </div>
          <button className="icon-close" type="button" onClick={onClose} aria-label="关闭">
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
        <ol>
          {chapters.map((chapter, index) => (
            <li key={chapter.id || index}>
              <span>{index + 1}</span>
              <div>
                <strong>{chapter.title}</strong>
                {chapter.description && <small>{chapter.description}</small>}
              </div>
            </li>
          ))}
        </ol>
        <div className="rename-actions">
          <button className="outline-button" type="button" onClick={onClose}>
            暂不采用
          </button>
          <button
            className="create-course"
            type="button"
            onClick={() => {
              onClose();
              onAdopt(chapters);
            }}
          >
            采用此目录
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}

export function ChapterSummaryPanel({
  chapter,
  summary,
  hasMaterials,
  onGenerate,
  token,
  course,
  onViewNote,
}) {
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    setRequirementsOpen(false);
    setRequirements('');
  }, [chapter.id]);

  useEffect(() => {
    if (!requirementsOpen) return;
    const onKey = (event) => {
      if (event.key === 'Escape' && !generating) {
        event.preventDefault();
        setRequirementsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requirementsOpen, generating]);

  const generate = async (event) => {
    event.preventDefault();
    setGenerating(true);
    try {
      if (await onGenerate(chapter.id, requirements.trim())) setRequirementsOpen(false);
    } finally {
      setGenerating(false);
    }
  };

  const appendSuggestion = (text) => {
    setRequirements((current) => {
      const trimmed = current.trim();
      if (!trimmed) return text;
      if (trimmed.includes(text)) return trimmed;
      return `${trimmed}；${text}`;
    });
  };

  return (
    <>
      {!summary ? (
        <section className="chapter-summary-empty">
          <div className="summary-mark">AI</div>
          <h3>生成本章摘要与知识点</h3>
          <p>AI 会依据本章对应的课程资料进行整理，生成结果会自动保存。</p>
          <button
            className="create-course"
            type="button"
            disabled={!hasMaterials}
            onClick={() => setRequirementsOpen(true)}
          >
            {hasMaterials ? '生成章节总结' : '请先导入资料'}
          </button>
        </section>
      ) : (
        <section className="chapter-summary-panel">
          <header>
            <div>
              <p className="eyebrow">AI 章节总结</p>
              <small>更新于 {formatDateTime(summary.updatedAt)}</small>
            </div>
            <button
              className="outline-button"
              type="button"
              onClick={() => setRequirementsOpen(true)}
            >
              重新生成
            </button>
          </header>
          <NoteExcerpt
            onView={onViewNote}
            token={token}
            courses={[course]}
            courseId={course.id}
            chapterId={chapter.id}
            source="AI 章节总结"
            content={[
              summary.summary,
              ...(summary.knowledgePoints || []).map(
                (point) => `${point.title}：${point.explanation}`,
              ),
            ].join('\n\n')}
          />
          <article className="summary-overview">
            <span>本章摘要</span>
            <p>{summary.summary}</p>
          </article>
          <section className="summary-points">
            <h4>核心知识点</h4>
            <ol>
              {(summary.knowledgePoints || []).map((point, index) => (
                <li key={`${point.title}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{point.title}</strong>
                    <p>{point.explanation}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          {summary.sources?.length > 0 && (
            <footer>
              <span>依据资料</span>
              <p>{summary.sources.join('、')}</p>
            </footer>
          )}
        </section>
      )}
      {requirementsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !generating) setRequirementsOpen(false);
          }}
        >
          <PaperDialog
            as="form"
            busy={generating}
            onDismiss={() => setRequirementsOpen(false)}
            className="record-modal name-editor-modal chapter-requirements-modal"
            onSubmit={generate}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">AI 章节总结 · 智能提炼</p>
                <h2>{summary ? '重新生成章节总结' : '生成章节总结'}</h2>
                <small>告诉 AI 这次想重点整理什么，AI 会依据本章资料深入提炼。</small>
              </div>
              <button
                className="icon-close"
                type="button"
                disabled={generating}
                onClick={() => setRequirementsOpen(false)}
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
            <div className="requirement-tags-row">
              <span className="requirement-tags-label">推荐关注：</span>
              <div className="requirement-tags">
                {['概念辨析与定义', '核心公式与定理', '简明知识脉络', '结合典型例题说明'].map(
                  (tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="requirement-tag-chip"
                      onClick={() => appendSuggestion(tag)}
                    >
                      ＋ {tag}
                    </button>
                  ),
                )}
              </div>
            </div>
            <label>
              整理要求 <span>（可选）</span>
              <textarea
                autoFocus
                maxLength="500"
                value={requirements}
                disabled={generating}
                onChange={(event) => setRequirements(event.target.value)}
                placeholder="例如：重点总结核心概念；每个知识点用一句话解释；标记出易混淆点。"
                rows={3}
              />
            </label>
            <div className="rename-actions">
              <button
                className="outline-button"
                type="button"
                disabled={generating}
                onClick={() => setRequirementsOpen(false)}
              >
                取消
              </button>
              <button className="create-course" disabled={generating} type="submit">
                {generating ? '正在提交…' : '后台生成'}
              </button>
            </div>
          </PaperDialog>
        </div>
      )}
    </>
  );
}

export function ChapterSuggestModal({ onClose, onSuggest }) {
  const [requirements, setRequirements] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const appendSuggestion = (text) => {
    setRequirements((current) => {
      const trimmed = current.trim();
      if (!trimmed) return text;
      if (trimmed.includes(text)) return trimmed;
      return `${trimmed}；${text}`;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (await onSuggest(requirements.trim())) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <PaperDialog
        as="form"
        busy={submitting}
        onDismiss={onClose}
        className="record-modal name-editor-modal chapter-requirements-modal"
        onSubmit={submit}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">AI 整理章节 · 目录编排</p>
            <h2>整理章节</h2>
            <small>按导入资料智能拟定章节目录，可指定划分粒度与重点。</small>
          </div>
          <button
            className="icon-close"
            type="button"
            disabled={submitting}
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
        <div className="requirement-tags-row">
          <span className="requirement-tags-label">推荐要求：</span>
          <div className="requirement-tags">
            {['按原书主目录划分', '保留各章小节', '习题不单独成章', '控制在 6-10 章'].map((tag) => (
              <button
                key={tag}
                type="button"
                className="requirement-tag-chip"
                onClick={() => appendSuggestion(tag)}
              >
                ＋ {tag}
              </button>
            ))}
          </div>
        </div>
        <label>
          整理要求 <span>（可选）</span>
          <textarea
            autoFocus
            maxLength="500"
            value={requirements}
            disabled={submitting}
            onChange={(event) => setRequirements(event.target.value)}
            placeholder="例如：按原书目录划分；保留章标题；不要把习题单独分章。"
            rows={3}
          />
        </label>
        <div className="rename-actions">
          <button className="outline-button" type="button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button className="create-course" disabled={submitting} type="submit">
            {submitting ? '正在提交…' : '后台生成'}
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}
