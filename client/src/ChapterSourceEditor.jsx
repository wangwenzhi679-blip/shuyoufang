import PaperDialog from './PaperDialog.jsx';
import React, { useEffect, useState } from 'react';
import { noteRequest } from './note-api';

export default function ChapterSourceEditor({
  token,
  courseId,
  chapter,
  materials,
  onClose,
  onSaved,
  onRead,
}) {
  const [materialId, setMaterialId] = useState(materials[0]?.id || '');
  const [content, setContent] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [corrected, setCorrected] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const route = `courses/${courseId}/chapters/${chapter.id}/materials/${materialId}/correction`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setContent('');
    setVersion(0);
    setCorrected(false);
    setHasPrevious(false);
    noteRequest(token, route)
      .then((data) => {
        if (live) {
          setContent(data.content);
          setVersion(data.version);
          setCorrected(data.corrected);
          setHasPrevious(data.hasPrevious);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [token, route]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault();
        if (confirm) setConfirm(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [confirm, saving, onClose]);

  const save = async (event) => {
    event.preventDefault();
    if (saving || loading) return;
    setSaving(true);
    setError('');
    try {
      await noteRequest(token, route, { method: 'PUT', body: { content, version } });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await noteRequest(token, `${route}/${confirm}`, { method: 'POST', body: { version } });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
      setConfirm(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving && !confirm) onClose();
      }}
    >
      <PaperDialog
        as="form"
        busy={saving}
        onDismiss={onClose}
        className="record-modal chapter-source-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-editor-title"
        onSubmit={save}
      >
        <div className="modal-header">
          <div className="source-editor-title-group">
            <p className="eyebrow">资料内容 · 文本校正</p>
            <h2 id="source-editor-title">修正本章资料</h2>
            <small className="source-chapter-badge">当前章节：{chapter.title}</small>
          </div>
          <button
            className="icon-close"
            type="button"
            disabled={saving || Boolean(confirm)}
            aria-label="关闭修正资料"
            onClick={onClose}
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
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <label>
          <span>来源资料</span>
          <select
            value={materialId}
            disabled={saving || Boolean(confirm)}
            onChange={(e) => setMaterialId(e.target.value)}
          >
            {materials.map((m) => (
              <option value={m.id} key={m.id}>
                {m.original_name}
              </option>
            ))}
          </select>
        </label>

        <div className="source-editor-help">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4m0-4h.01" />
          </svg>
          <span>修正文字或公式，保留本章完整内容。保存后用于阅读和 AI 生成，原文件不会改动。</span>
          <button
            type="button"
            disabled={saving || Boolean(confirm)}
            onClick={() => onRead(materials.find((m) => Number(m.id) === Number(materialId)))}
          >
            查看原文 ↗
          </button>
        </div>

        <div className="source-version-actions">
          <div className="source-status-pill">
            <span
              className={`source-status-dot ${corrected ? 'is-corrected' : ''}`}
              aria-hidden="true"
            />
            <span>{loading ? '读取中…' : corrected ? '已修正' : '原始提取'}</span>
          </div>
          <div className="source-history-buttons">
            <button
              type="button"
              disabled={loading || saving || !hasPrevious || Boolean(confirm)}
              onClick={() => setConfirm('undo')}
            >
              撤销上次修改
            </button>
            <button
              type="button"
              disabled={loading || saving || !corrected || Boolean(confirm)}
              onClick={() => setConfirm('restore')}
            >
              恢复原始内容
            </button>
          </div>
        </div>

        <label>
          <span>本章内容</span>
          <textarea
            aria-label="本章修正内容"
            value={loading ? '' : content}
            disabled={loading || saving || Boolean(confirm)}
            maxLength={100000}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              loading ? '正在读取…' : '粘贴或填写本章完整内容，矩阵可写成 [[1,2],[3,4]]。'
            }
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="rename-actions">
          <button
            className="outline-button"
            type="button"
            disabled={saving || Boolean(confirm)}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="create-course"
            type="button"
            onClick={save}
            disabled={loading || saving || !content.trim() || Boolean(confirm)}
          >
            {saving ? '保存中…' : '保存修正'}
          </button>
        </div>

        {confirm && (
          <div
            className="source-confirm-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !saving) setConfirm(null);
            }}
          >
            <PaperDialog
              busy={saving}
              onDismiss={() => setConfirm(null)}
              className="source-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="source-confirm-title"
            >
              <div className="modal-header">
                <div>
                  <p className="eyebrow">版本回退</p>
                  <h3 id="source-confirm-title">
                    {confirm === 'restore' ? '恢复原始内容？' : '撤销上次修改？'}
                  </h3>
                </div>
                <button
                  className="icon-close"
                  type="button"
                  disabled={saving}
                  aria-label="关闭确认弹窗"
                  onClick={() => setConfirm(null)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <p className="source-confirm-msg">
                {confirm === 'restore'
                  ? '重新使用导入时提取的内容，原有乱码可能再次出现。当前修正会保留，可通过撤销恢复。'
                  : '恢复到上次变更前的内容。'}
              </p>
              <small className="source-confirm-sub">
                当前未保存的编辑不会保留；已有笔记、总结和练习不会改变。
              </small>
              <div className="rename-actions">
                <button
                  className="outline-button"
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirm(null)}
                >
                  取消
                </button>
                <button
                  className="create-course"
                  type="button"
                  autoFocus
                  disabled={saving}
                  onClick={restore}
                >
                  {saving ? '处理中…' : '确认恢复'}
                </button>
              </div>
            </PaperDialog>
          </div>
        )}
      </PaperDialog>
    </div>
  );
}
