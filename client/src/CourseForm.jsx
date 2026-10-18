import React, { useEffect, useRef, useState } from 'react';
import './course-form.css';

const deriveTitleFromFiles = (list) =>
  list?.[0]?.name
    ? list[0].name
        .replace(/\.(pdf|docx|pptx)$/i, '')
        .trim()
        .slice(0, 100)
    : '';

export default function CourseForm({ title, submitLabel, initialFiles = [], onClose, onSubmit }) {
  const [courseTitle, setCourseTitle] = useState(() => deriveTitleFromFiles(initialFiles));
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState(() => (Array.isArray(initialFiles) ? initialFiles : []));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const panel = useRef(null),
    nameInput = useRef(null);
  const busy = useRef(false),
    close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    nameInput.current?.focus({ preventScroll: true });
    const keyboard = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy.current) close.current();
      }
      if (event.key !== 'Tab') return;
      const elements = [
        ...panel.current.querySelectorAll(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled)',
        ),
      ].filter((element) => element.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  const applyFiles = (picked) => {
    setFiles(picked);
    setError('');
    setCourseTitle((current) => (current.trim() ? current : deriveTitleFromFiles(picked)));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy.current) return;
    if (!files.length) {
      setError('请先选择 PDF、Word 或 PPT 资料');
      return;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await onSubmit({ title: courseTitle.trim(), description: description.trim(), files });
    } catch (reason) {
      setError(reason.message || '导入失败，请重试');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop account-backdrop course-create-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy.current) onClose();
      }}
    >
      <form
        ref={panel}
        className="record-modal account-panel settings-paper-dialog course-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-create-title"
        aria-busy={saving}
        onSubmit={submit}
      >
        <header className="account-header">
          <div>
            <h2 id="course-create-title">{title}</h2>
          </div>
          <button
            type="button"
            className="account-close"
            aria-label="关闭添加课程"
            disabled={saving}
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
        </header>
        <div className="account-body course-create-body">
          <p className="course-create-intro">从一份课本或讲义，开始新的学习。</p>
          <fieldset disabled={saving}>
            <label className="course-create-field">
              课程名称
              <input
                ref={nameInput}
                required
                maxLength="100"
                value={courseTitle}
                onChange={(event) => setCourseTitle(event.target.value)}
                placeholder="例如：高等数学"
              />
            </label>
            <label className="course-create-field">
              <span>
                课程简介 <small>选填</small>
              </span>
              <textarea
                maxLength="500"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="简单记下这门课的学习内容"
                rows="2"
              />
            </label>
            <div className="course-create-materials">
              <h3>学习资料</h3>
              <label
                className="course-create-picker"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = [...(event.dataTransfer?.files || [])].filter((file) =>
                    /\.(pdf|docx|pptx)$/i.test(file.name),
                  );
                  if (dropped.length) applyFiles(dropped);
                }}
              >
                <input
                  type="file"
                  required={!files.length}
                  aria-label="选择学习资料"
                  accept=".pdf,.docx,.pptx"
                  multiple
                  onChange={(event) => {
                    applyFiles([...event.target.files]);
                  }}
                />
                <svg
                  width="30"
                  height="30"
                  viewBox="0 0 32 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 3h11l6 6v19H8ZM19 3v7h6M12 22l4-4 4 4M16 18v8" />
                  <path d="M5 7H3v22h18" opacity=".45" />
                </svg>
                <span>
                  {files.length ? `已选择 ${files.length} 份资料` : '选择或拖入课本与讲义'}
                </span>
                <small>{files.length ? '点击重新选择' : 'PDF · Word · PPT'}</small>
              </label>
              <p className="course-create-file-hint">可选择或拖入多个文件，每个不超过 200MB。</p>
              {files.length > 0 && (
                <ul className="course-create-files" aria-label="已选择的资料">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      <span title={file.name}>{file.name}</span>
                      <small>
                        {file.size < 1024 * 1024
                          ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                          : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </fieldset>
          {error && (
            <p className="form-error course-create-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="account-footer">
          <span className="course-create-saving" role="status">
            {saving ? '正在导入并解析…' : ''}
          </span>
          <button type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? '导入中…' : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
