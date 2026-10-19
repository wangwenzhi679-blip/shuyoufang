import React, { useEffect, useRef, useState } from 'react';
import PaperDialog from './PaperDialog.jsx';

// 课程与资料编辑弹窗仅通过回调保存数据，工作区继续负责接口请求与列表刷新。
export function ConfirmModal({ action, onClose }) {
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
        className="record-modal name-editor-modal confirm-action-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">
              {action.eyebrow || (action.danger ? '谨慎操作 · 删除确认' : '确认操作')}
            </p>
            <h2>{action.title}</h2>
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
        <p className="student-confirm-description">{action.message}</p>
        <div className="rename-actions">
          <button className="outline-button" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            className={action.danger ? 'create-course confirm-danger' : 'create-course'}
            disabled={saving}
            type="button"
            onClick={async () => {
              setSaving(true);
              try {
                await action.onConfirm();
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? '正在处理…' : action.confirmText || (action.danger ? '确认删除' : '确认')}
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}

export function NameEditor({ editor, onClose, onSave }) {
  const [title, setTitle] = useState(editor.title);
  const [description, setDescription] = useState(editor.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isCourse = editor.kind === 'course';
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
        as="form"
        busy={saving}
        onDismiss={onClose}
        className="record-modal name-editor-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || !title.trim()) return;
          setError('');
          setSaving(true);
          try {
            await onSave(
              isCourse
                ? { title: title.trim(), description: description.trim() }
                : { title: title.trim() },
            );
          } catch (reason) {
            setError(reason.message || '保存失败，请重试');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{isCourse ? '课程管理 · 信息修改' : '章节管理 · 目录调整'}</p>
            <h2>修改{isCourse ? '课程' : '章节'}名称</h2>
            <small>
              {isCourse
                ? '更新课程名称与简介，将实时同步至研习空间。'
                : '更新后会同步显示在课程目录与章节标题中。'}
            </small>
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
        <label>
          {isCourse ? '课程名称' : '章节名称'}
          <input
            autoFocus
            required
            maxLength="120"
            value={title}
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {isCourse && (
          <label>
            课程简介 <span>（可选）</span>
            <textarea
              maxLength="500"
              value={description}
              disabled={saving}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="简单说明这门课程的学习内容与目标"
              rows={3}
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="rename-actions">
          <button className="outline-button" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="create-course" disabled={saving || !title.trim()} type="submit">
            {saving ? '正在保存…' : '保存修改'}
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}

export function AddChapterModal({ chapters, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [afterChapterId, setAfterChapterId] = useState(
    chapters.length ? chapters[chapters.length - 1].id : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
        as="form"
        busy={saving}
        onDismiss={onClose}
        className="record-modal name-editor-modal add-chapter-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || !title.trim()) return;
          setError('');
          setSaving(true);
          try {
            await onSave({ title: title.trim(), description: '', afterChapterId });
          } catch (reason) {
            setError(reason.message || '保存失败，请重试');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">课程结构 · 新增章节</p>
            <h2>添加章节</h2>
            <small>可将新章节插入到课程目录中的指定位置。</small>
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
        <label>
          章节名称
          <input
            autoFocus
            required
            maxLength="120"
            value={title}
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：第三章 概念与方法"
          />
        </label>
        <label>
          插入位置
          <select
            value={afterChapterId}
            disabled={saving}
            onChange={(event) => setAfterChapterId(event.target.value)}
          >
            <option value="">放在第一章前</option>
            {chapters.map((chapter, index) => (
              <option value={chapter.id} key={chapter.id}>
                放在第 {index + 1} 章“{chapter.title}”之后
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="rename-actions">
          <button className="outline-button" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="create-course" disabled={saving || !title.trim()} type="submit">
            {saving ? '正在添加…' : '添加章节'}
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}

export function RenameMaterialModal({ material, onClose, onSave }) {
  const [name, setName] = useState(material.original_name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (saving || !trimmed) return;
    setError('');
    setSaving(true);
    try {
      await onSave(material, trimmed);
      onClose();
    } catch (reason) {
      setError(reason.message || '保存名称失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <PaperDialog
        as="form"
        busy={saving}
        onDismiss={onClose}
        className="record-modal name-editor-modal rename-material-modal"
        onSubmit={submit}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">资料管理 · 重命名</p>
            <h2>修改资料名称</h2>
            <small>此名称仅用于课程内展示，不会改动存储的原文件。</small>
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
        <label>
          资料名称
          <input
            name="originalName"
            autoFocus
            required
            maxLength="180"
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="rename-actions">
          <button className="outline-button" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="create-course" disabled={saving || !name.trim()} type="submit">
            {saving ? '正在保存…' : '保存名称'}
          </button>
        </div>
      </PaperDialog>
    </div>
  );
}
