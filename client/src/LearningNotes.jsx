import { API_ROOT } from './api-base.mjs';
import PaperDialog from './PaperDialog.jsx';
import React, { useEffect, useRef, useState } from 'react';
import RichNoteEditor from './RichNoteEditor';
import { textDocument, appendExcerpt } from '../../shared/note-document.mjs';

const endpoint = (course, chapter) => `${API_ROOT}/courses/${course}/chapters/${chapter}/note`;
const draftKey = (user, course, chapter) => `chapter-note:${user}:${course}:${chapter}`;
async function api(token, course, chapter, payload) {
  const response = await fetch(endpoint(course, chapter), {
    method: payload ? 'PUT' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '笔记保存失败');
  return data.note;
}
function draft(user, course, chapter) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(user, course, chapter)) || 'null');
  } catch {
    return null;
  }
}

export function LearningNotes(props) {
  return <RichNoteEditor {...props} />;
}

export function NoteExcerpt({
  token,
  courses,
  courseId,
  chapterId,
  content,
  source,
  onView,
  materialId,
  page,
  icon,
}) {
  const [open, setOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(String(courseId || ''));
  const [chapters, setChapters] = useState([]);
  const [target, setTarget] = useState(String(chapterId || ''));
  const [text, setText] = useState(content);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [doneTarget, setDoneTarget] = useState(null);
  const user = (() => {
    try {
      return JSON.parse(atob(token.split('.')[1])).sub;
    } catch {
      return '';
    }
  })();
  useEffect(() => {
    if (!open || !selectedCourse) return;
    let live = true;
    fetch(`${API_ROOT}/courses/${selectedCourse}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        return data;
      })
      .then((data) => {
        if (live) {
          setChapters(data.chapters || []);
          setTarget((current) =>
            data.chapters?.some((item) => String(item.id) === current)
              ? current
              : String(data.chapters?.[0]?.id || ''),
          );
        }
      })
      .catch((reason) => {
        if (live) setError(reason.message);
      });
    return () => {
      live = false;
    };
  }, [open, selectedCourse]);
  return (
    <>
      <button
        className="note-excerpt-button"
        disabled={done}
        onClick={() => {
          setText(content);
          setOpen(true);
        }}
      >
        {icon}
        {done ? '已加入笔记' : '加入笔记'}
      </button>
      {done && onView && (
        <button
          className="note-excerpt-button"
          onClick={() => onView(doneTarget.course, doneTarget.chapter)}
        >
          查看笔记
        </button>
      )}
      {open && (
        <div className="modal-backdrop">
          <PaperDialog
            busy={saving}
            onDismiss={() => setOpen(false)}
            className="record-modal name-editor-modal note-excerpt-modal"
          >
            <div className="modal-header">
              <h2>加入学习笔记</h2>
              <button className="icon-close" disabled={saving} onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <label>
              课程
              <select
                value={selectedCourse}
                disabled={saving}
                onChange={(event) => {
                  setSelectedCourse(event.target.value);
                  setChapters([]);
                  setTarget('');
                }}
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              目标章节
              <select
                value={target}
                disabled={saving}
                onChange={(event) => setTarget(event.target.value)}
              >
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </label>
            {!chapters.length && <p>请先为课程创建章节。</p>}
            <label>
              摘录内容
              <textarea
                value={text}
                maxLength={50000}
                disabled={saving}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="rename-actions">
              <button className="outline-button" disabled={saving} onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="create-course"
                disabled={saving || !target || !text.trim()}
                onClick={async () => {
                  setSaving(true);
                  setError('');
                  try {
                    const note = await api(token, selectedCourse, target);
                    const local = draft(user, selectedCourse, target);
                    if (
                      local &&
                      local.version !== note.version &&
                      JSON.stringify(local.document || textDocument(local.body || '')) !==
                        JSON.stringify(note.document)
                    )
                      throw new Error('目标章节有冲突草稿，请先打开学习笔记处理后再摘录。');
                    const existing =
                      local?.document || note.document || textDocument(local?.body ?? note.body);
                    const fingerprint = [
                      ...new Uint8Array(
                        await crypto.subtle.digest(
                          'SHA-256',
                          new TextEncoder().encode(
                            `${source}:${materialId || ''}:${page || ''}:${text.trim()}`,
                          ),
                        ),
                      ),
                    ]
                      .map((value) => value.toString(16).padStart(2, '0'))
                      .join('');
                    const document = appendExcerpt(existing, text.trim(), {
                      name: source,
                      materialId: materialId || null,
                      page: page || null,
                      date: new Date().toLocaleDateString('zh-CN'),
                      fingerprint,
                    });
                    await api(token, selectedCourse, target, { document, version: note.version });
                    localStorage.removeItem(draftKey(user, selectedCourse, target));
                    setDoneTarget({ course: selectedCourse, chapter: target });
                    setDone(true);
                    setOpen(false);
                  } catch (reason) {
                    setError(reason.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? '保存中…' : '确认加入'}
              </button>
            </div>
          </PaperDialog>
        </div>
      )}
    </>
  );
}
