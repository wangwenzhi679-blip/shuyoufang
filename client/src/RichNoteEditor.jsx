import { API_ROOT } from './api-base.mjs';
import PaperDialog from './PaperDialog.jsx';
import { registerAccountGuard } from './account-state.js';
import { cleanAiNoteText, cleanLegacyNoteDocument } from '../../shared/note-document.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Extension, Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import UniqueID from '@tiptap/extension-unique-id';
import {
  normalizeDocument,
  textDocument,
  documentText,
  replaceOrdinaryText,
} from '../../shared/note-document.mjs';
import { noteRequest, noteBase, draftKey, readDraft, pendingFile } from './note-api';
import { useNoteJobs } from './NoteJobs';

function Dialog({
  title,
  onClose,
  children,
  footer,
  compact = false,
  busy = false,
  variant = 'form',
}) {
  return (
    <div className="modal-backdrop">
      <PaperDialog
        busy={busy}
        onDismiss={onClose}
        className={`record-modal name-editor-modal rich-note-dialog student-dialog-${variant} ${compact ? 'note-ai-dialog' : ''}`}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
        <footer className="rename-actions">{footer}</footer>
      </PaperDialog>
    </div>
  );
}
const noteFontSize = Mark.create({
  name: 'fontSize',
  addAttributes() {
    return {
      size: {
        default: 16,
        parseHTML: (el) => Number.parseInt(el.style.fontSize, 10),
        renderHTML: (attrs) => ({ style: `font-size:${attrs.size}px` }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[style]',
        getAttrs: (el) =>
          [12, 14, 16, 18, 20, 24, 28, 32].includes(Number.parseInt(el.style.fontSize, 10))
            ? {}
            : false,
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});
const metadata = Extension.create({
  name: 'noteMetadata',
  addGlobalAttributes() {
    return [
      {
        types: [
          'paragraph',
          'heading',
          'blockquote',
          'bulletList',
          'orderedList',
          'listItem',
          'image',
        ],
        attributes: {
          important: {
            default: false,
            renderHTML: (attrs) => (attrs.important ? { 'data-important': 'true' } : {}),
          },
          question: {
            default: false,
            renderHTML: (attrs) => (attrs.question ? { 'data-question': 'true' } : {}),
          },
          resolved: {
            default: false,
            renderHTML: (attrs) => (attrs.resolved ? { 'data-resolved': 'true' } : {}),
          },
          source: {
            default: null,
            renderHTML: (attrs) =>
              attrs.source ? { 'data-source': JSON.stringify(attrs.source) } : {},
          },
        },
      },
    ];
  },
});
function createImageExtension(token, onRemove) {
  function NoteImage({ node, updateAttributes, selected, deleteNode }) {
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [large, setLarge] = useState(false);
    useEffect(() => {
      let live = true,
        blobUrl;
      fetch(`${API_ROOT}/notes/images/${node.attrs.attachmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('图片读取失败');
          return response.blob();
        })
        .then((blob) => {
          blobUrl = URL.createObjectURL(blob);
          if (live) setUrl(blobUrl);
        })
        .catch((reason) => {
          if (live) setError(reason.message);
        });
      return () => {
        live = false;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
    }, [node.attrs.attachmentId]);
    return (
      <NodeViewWrapper
        className={`note-image-block ${selected ? 'selected' : ''}`}
        data-note-id={node.attrs.noteId}
        contentEditable={false}
      >
        <figure style={{ width: `${node.attrs.width || 100}%` }}>
          {url ? (
            <img src={url} alt={node.attrs.alt || '笔记图片'} onClick={() => setLarge(true)} />
          ) : (
            <small>{error || '正在读取图片…'}</small>
          )}
          <figcaption>{node.attrs.alt || '图片说明可在选中后编辑'}</figcaption>
        </figure>
        {selected && (
          <div className="note-image-controls">
            <label>
              宽度
              <select
                value={node.attrs.width || 100}
                onChange={(event) => updateAttributes({ width: Number(event.target.value) })}
              >
                <option value="50">50%</option>
                <option value="75">75%</option>
                <option value="100">100%</option>
              </select>
            </label>
            <label>
              说明
              <input
                maxLength={500}
                value={node.attrs.alt || ''}
                onChange={(event) => updateAttributes({ alt: event.target.value })}
              />
            </label>
            <button onClick={() => onRemove(() => deleteNode())}>移除图片</button>
          </div>
        )}
        {large && (
          <div className="note-image-lightbox" onClick={() => setLarge(false)}>
            <button aria-label="关闭放大图片">×</button>
            <img src={url} alt={node.attrs.alt || '笔记图片'} />
          </div>
        )}
      </NodeViewWrapper>
    );
  }
  return Image.extend({
    addAttributes() {
      return { ...this.parent?.(), attachmentId: { default: null }, width: { default: 100 } };
    },
    addNodeView() {
      return ReactNodeViewRenderer(NoteImage);
    },
  });
}

export default function RichNoteEditor({ token, userId, courseId, chapter, onReadSource }) {
  const key = draftKey(userId, courseId, chapter.id),
    base = noteBase(courseId, chapter.id);
  const [ready, setReady] = useState(false),
    [status, setStatus] = useState('正在加载…'),
    [error, setError] = useState('');
  const [modal, setModal] = useState(null),
    [filter, setFilter] = useState('all'),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState([]),
    [busy, setBusy] = useState(false);
  const [requirements, setRequirements] = useState(''),
    [scope, setScope] = useState('all'),
    [result, setResult] = useState('');
  const state = useRef({
    document: readDraft(key)?.document || textDocument(''),
    version: 0,
    saved: '',
    ready: false,
    blocked: false,
    saving: null,
    live: true,
    hasPrevious: false,
    pending: 0,
  });
  const timer = useRef(null),
    picker = useRef(null),
    uploads = useRef(new Set()),
    selection = useRef(null),
    formatSelection = useRef(null),
    bypassDelete = useRef(false);
  const jobs = useNoteJobs(token);
  const chapterJobs = jobs.filter((job) => Number(job.chapter_id) === Number(chapter.id));
  const ui = (fn) => {
    if (state.current.live) fn();
  };
  const save = async (snapshot = true) => {
    clearTimeout(timer.current);
    if (state.current.saving) {
      await state.current.saving;
      return save(snapshot);
    }
    if (!state.current.ready || state.current.blocked)
      throw new Error('请先处理笔记加载或保存冲突');
    if (state.current.pending) throw new Error('图片仍待上传，请完成上传后保存或导出');
    const current = normalizeDocument(state.current.document),
      serialized = JSON.stringify(current);
    if (serialized === state.current.saved) {
      localStorage.removeItem(key);
      ui(() => {
        setStatus('已保存');
        setRevision((value) => value + 1);
      });
      return;
    }
    ui(() => setStatus('保存中…'));
    const operation = (async () => {
      try {
        const { note } = await noteRequest(token, base, {
          method: 'PUT',
          body: { document: current, version: state.current.version, snapshot },
        });
        state.current.version = note.version;
        state.current.saved = JSON.stringify(normalizeDocument(note.document));
        state.current.hasPrevious = note.hasPrevious;
        if (JSON.stringify(state.current.document) === serialized) {
          localStorage.removeItem(key);
          ui(() => {
            setStatus('已保存');
            setRevision((value) => value + 1);
          });
        } else {
          localStorage.setItem(
            key,
            JSON.stringify({ document: state.current.document, version: note.version }),
          );
          timer.current = setTimeout(() => save().catch(() => {}), 900);
        }
      } catch (reason) {
        state.current.blocked = true;
        ui(() => {
          setError(reason.message);
          setStatus('保存失败，草稿已保留');
        });
        throw reason;
      }
    })();
    state.current.saving = operation;
    try {
      await operation;
    } finally {
      state.current.saving = null;
    }
  };
  useEffect(
    () =>
      registerAccountGuard(async () => {
        clearTimeout(timer.current);
        await save();
      }),
    [],
  );
  const edit = (doc) => {
    doc = normalizeDocument(doc);
    state.current.document = doc;
    ui(() => {
      setStatus(
        state.current.pending
          ? '图片待上传'
          : state.current.blocked
            ? '保存失败，草稿待处理'
            : '待保存',
      );
      setRevision((value) => value + 1);
    });
    try {
      localStorage.setItem(key, JSON.stringify({ document: doc, version: state.current.version }));
    } catch {
      ui(() => setError('浏览器无法保存本地草稿，请保持页面打开，等待服务器保存完成。'));
    }
    clearTimeout(timer.current);
    if (!state.current.blocked && !state.current.pending)
      timer.current = setTimeout(() => save().catch(() => {}), 1000);
  };
  const requestRemoval = (action) => setModal({ type: 'remove', action });
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2] },
          codeBlock: false,
          link: false,
          trailingNode: false,
        }),
        metadata,
        noteFontSize,
        UniqueID.configure({
          attributeName: 'noteId',
          types: [
            'paragraph',
            'heading',
            'blockquote',
            'bulletList',
            'orderedList',
            'listItem',
            'image',
          ],
        }),
        createImageExtension(token, requestRemoval),
        Placeholder.configure({ placeholder: '记下这一章的理解与疑问' }),
      ],
      content: state.current.document,
      editable: false,
      onTransaction: ({ editor: current, transaction }) => {
        if (state.current.ready && transaction.docChanged && !transaction.getMeta('preventUpdate'))
          edit(current.getJSON());
        else setRevision((value) => value + 1);
      },
      onSelectionUpdate: ({ editor: current }) => {
        const { from, to, empty } = current.state.selection;
        formatSelection.current = { from, to, empty };
        setRevision((value) => value + 1);
      },
      editorProps: {
        attributes: { 'aria-label': '章节笔记', role: 'textbox', 'aria-multiline': 'true' },
        handlePaste: (view, event) => {
          const files = [...(event.clipboardData?.files || [])].filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length) {
            event.preventDefault();
            files.forEach((file) => queueImage(file, view.state.selection.from));
            return true;
          }
          return false;
        },
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files || [])];
          if (files.length) {
            event.preventDefault();
            files.forEach((file) =>
              queueImage(
                file,
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ||
                  view.state.selection.from,
              ),
            );
            return true;
          }
          return false;
        },
        handleKeyDown: (view, event) => {
          if (bypassDelete.current || !['Backspace', 'Delete'].includes(event.key)) return false;
          const { from, to } = view.state.selection;
          let images = false;
          view.state.doc.nodesBetween(
            Math.max(0, from - (from === to && event.key === 'Backspace' ? 1 : 0)),
            Math.min(
              view.state.doc.content.size,
              to + (from === to && event.key === 'Delete' ? 1 : 0),
            ),
            (node) => {
              if (node.type.name === 'image') images = true;
            },
          );
          if (images) {
            requestRemoval(() => {
              bypassDelete.current = true;
              editor.commands.keyboardShortcut(event.key);
              bypassDelete.current = false;
            });
            return true;
          }
          return false;
        },
        handleDOMEvents: {
          cut: (view, event) => {
            let image = false;
            view.state.doc.nodesBetween(
              view.state.selection.from,
              view.state.selection.to,
              (node) => {
                if (node.type.name === 'image') image = true;
              },
            );
            if (image) {
              event.preventDefault();
              setError('含图片的内容请使用移除操作并确认后删除。');
              return true;
            }
            return false;
          },
        },
      },
    },
    [chapter.id],
  );
  const replaceEditor = (doc) => {
    editor.commands.setContent(doc, { emitUpdate: false });
    edit(editor.getJSON());
  };
  useEffect(() => {
    if (!editor) return;
    state.current.live = true;
    let live = true;
    noteRequest(token, base)
      .then(({ note }) => {
        if (!live) return;
        const local = readDraft(key);
        const doc = cleanLegacyNoteDocument(local?.document || note.document);
        state.current.version = note.version;
        state.current.saved = JSON.stringify(normalizeDocument(note.document));
        state.current.ready = true;
        state.current.hasPrevious = note.hasPrevious;
        state.current.document = doc;
        editor.commands.setContent(doc, { emitUpdate: false });
        editor.setEditable(true);
        setReady(true);
        setStatus('已保存');
        setRevision((value) => value + 1);
        if (
          local &&
          local.version !== note.version &&
          JSON.stringify(doc) !== JSON.stringify(normalizeDocument(note.document))
        ) {
          state.current.blocked = true;
          setError('服务器笔记已更新，本地草稿已保留。请选择重新加载或明确保留本地内容。');
        } else if (
          local ||
          JSON.stringify(normalizeDocument(editor.getJSON())) !== state.current.saved
        )
          edit(editor.getJSON());
        pendingFile('get').then((items) => {
          if (!live) return;
          const mine = items.filter((item) => item.key === key);
          state.current.pending = mine.length;
          setPending(mine);
          mine.forEach((item) => uploadImage(item));
        });
      })
      .catch((reason) => {
        if (live) {
          state.current.blocked = true;
          setError(reason.message);
          setStatus('加载失败');
        }
      });
    return () => {
      live = false;
      state.current.live = false;
      clearTimeout(timer.current);
      if (state.current.ready && !state.current.blocked && !state.current.pending)
        save().catch(() => {});
    };
  }, [editor]);
  const recover = async (keep) => {
    try {
      const { note } = await noteRequest(token, base);
      state.current.version = note.version;
      state.current.saved = JSON.stringify(normalizeDocument(note.document));
      state.current.ready = true;
      state.current.blocked = false;
      state.current.hasPrevious = note.hasPrevious;
      setError('');
      setReady(true);
      editor.setEditable(true);
      if (!keep) {
        state.current.document = cleanLegacyNoteDocument(note.document);
        editor.commands.setContent(state.current.document, { emitUpdate: false });
        localStorage.removeItem(key);
        setStatus('已保存');
        setRevision((value) => value + 1);
      } else {
        edit(state.current.document);
        await save();
      }
    } catch (reason) {
      setError(reason.message);
    }
  };
  async function queueImage(file, position) {
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError('请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片');
      return;
    }
    const item = { id: crypto.randomUUID(), key, file, position };
    try {
      await pendingFile('put', item);
      state.current.pending++;
      setPending((current) => [...current, item]);
      setStatus('图片待上传');
      uploadImage(item);
    } catch {
      setError('无法保存图片上传草稿，请检查浏览器存储空间');
    }
  }
  async function uploadImage(item) {
    if (uploads.current.has(item.id)) return;
    uploads.current.add(item.id);
    ui(() =>
      setPending((current) =>
        current.map((value) =>
          value.id === item.id ? { ...value, error: '', uploading: true } : value,
        ),
      ),
    );
    try {
      const form = new FormData();
      form.append('image', item.file);
      const { attachment } = await noteRequest(token, `${base}/images`, {
        method: 'POST',
        body: form,
      });
      const image = {
        type: 'image',
        attrs: {
          src: `note-image:${attachment.id}`,
          attachmentId: attachment.id,
          width: 100,
          alt: '',
          noteId: crypto.randomUUID(),
        },
      };
      await pendingFile('delete', item.id);
      state.current.pending = Math.max(0, state.current.pending - 1);
      if (!editor.isDestroyed) {
        editor
          .chain()
          .focus()
          .insertContentAt(Math.min(item.position, editor.state.doc.content.size), image)
          .run();
      } else edit({ type: 'doc', content: [...state.current.document.content, image] });
      ui(() => setPending((current) => current.filter((value) => value.id !== item.id)));
      if (!state.current.pending) save().catch(() => {});
    } catch (reason) {
      ui(() => {
        setStatus('图片上传失败，文件草稿已保留');
        setPending((current) =>
          current.map((value) =>
            value.id === item.id ? { ...value, error: reason.message, uploading: false } : value,
          ),
        );
      });
    } finally {
      uploads.current.delete(item.id);
    }
  }
  const selectedBlock = () => {
    const selection = editor.state.selection;
    if (selection.node) return { node: selection.node, pos: selection.from };
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth);
      if (['paragraph', 'heading', 'blockquote', 'listItem'].includes(node.type.name))
        return { node, pos: selection.$from.before(depth) };
    }
    return null;
  };
  const mark = (field) => {
    const block = selectedBlock();
    if (block) {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeMarkup(block.pos, undefined, {
            ...block.node.attrs,
            [field]: !block.node.attrs[field],
          });
          return true;
        })
        .run();
    }
  };
  const marked = [];
  if (editor)
    editor.state.doc.descendants((node, pos) => {
      if (
        node.attrs.noteId &&
        (filter === 'important'
          ? node.attrs.important
          : node.attrs.question && !node.attrs.resolved)
      )
        marked.push({
          id: node.attrs.noteId,
          pos,
          label: node.textContent || node.attrs.alt || '图片',
          source: node.attrs.source,
        });
    });
  const startAi = async () => {
    setBusy(true);
    setError('');
    try {
      await save();
      const generating = modal.mode === 'generate';
      const range = !generating && scope === 'selection' ? selection.current : null;
      const text = range
        ? editor.state.doc.textBetween(range.from, range.to, '\n')
        : documentText(state.current.document);
      await noteRequest(token, `${base}/${generating ? 'generate' : 'organize'}`, {
        method: 'POST',
        body: { text, requirements, version: state.current.version, selection: range },
      });
      setModal(null);
      window.dispatchEvent(new Event('note-jobs-changed'));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const adopt = async (append) => {
    const cleanResult = cleanAiNoteText(result);
    setBusy(true);
    setError('');
    try {
      await save();
      if (!append && state.current.version !== modal.job.base_version)
        throw new Error('整理期间笔记已修改，请追加结果或重新整理，不能直接替换。');
      if (append)
        replaceEditor({
          type: 'doc',
          content: [...editor.getJSON().content, ...textDocument(cleanResult).content],
        });
      else if (modal.job.input_json.selection) {
        const range = modal.job.input_json.selection;
        let protectedContent = false;
        editor.state.doc.nodesBetween(range.from, range.to, (node) => {
          if (
            node.type.name === 'image' ||
            node.attrs.source ||
            node.attrs.important ||
            node.attrs.question
          )
            protectedContent = true;
        });
        if (protectedContent)
          throw new Error('选区包含图片、来源或标记，请追加结果，或改为整理全文。');
        editor.chain().focus().insertContentAt(range, textDocument(cleanResult).content).run();
      } else replaceEditor(replaceOrdinaryText(editor.getJSON(), cleanResult));
      await save(!append);
      setModal(null);
      await noteRequest(token, `notes/jobs/${modal.job.id}/dismiss`, { method: 'POST' });
      window.dispatchEvent(new Event('note-jobs-changed'));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const exportNotes = async (format, all) => {
    setBusy(true);
    setError('');
    try {
      await save();
      const other = await pendingFile('get');
      if (all && other.some((item) => item.key.startsWith(`chapter-note:${userId}:${courseId}:`)))
        throw new Error('本课程还有图片待上传，请先处理后导出。');
      if (
        all &&
        Object.keys(localStorage).some(
          (item) => item.startsWith(`chapter-note:${userId}:${courseId}:`) && item !== key,
        )
      )
        throw new Error('其他章节还有未同步草稿，请先打开对应章节保存后导出。');
      const response = await fetch(
        `${API_ROOT}/courses/${courseId}/notes/export?format=${format}${all ? '' : `&chapterId=${chapter.id}`}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error((await response.json()).message);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${all ? '课程' : chapter.title}-学习笔记.${format === 'pdf' ? 'pdf' : 'zip'}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setModal(null);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };
  if (!editor) return <p>正在加载笔记编辑器…</p>;
  const action = (label, command, active, unavailable = false) => (
    <button
      type="button"
      aria-pressed={typeof active === 'boolean' ? active : undefined}
      title={label === '加粗' ? '选中文字后加粗；未选中时，后续输入使用加粗格式（Ctrl+B）' : label}
      className={active ? 'active' : ''}
      disabled={!ready || busy || filter !== 'all' || unavailable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={command}
    >
      {label}
    </button>
  );
  const current = selectedBlock();
  return (
    <section className="learning-note rich-note">
      <header>
        <div>
          <h3>学习笔记</h3>
          <small role="status">{status}</small>
        </div>
        <div className="note-top-actions">
          <button
            disabled={!ready || busy}
            onClick={() => {
              setRequirements('');
              setScope('all');
              setModal({ type: 'ai', mode: 'generate' });
            }}
          >
            AI 生成笔记
          </button>
          <button
            disabled={!ready || busy}
            onClick={() => {
              selection.current = editor.state.selection.empty
                ? null
                : { from: editor.state.selection.from, to: editor.state.selection.to };
              setScope('all');
              setModal({ type: 'ai' });
            }}
          >
            AI 整理
          </button>
          <button disabled={!ready || busy} onClick={() => setModal({ type: 'export' })}>
            导出
          </button>
          <button
            disabled={!ready || busy || !state.current.hasPrevious}
            onClick={() => setModal({ type: 'restore' })}
          >
            恢复版本
          </button>
          <button disabled={!ready || busy} onClick={() => setModal({ type: 'clear' })}>
            删除笔记
          </button>
        </div>
      </header>
      {error && (
        <div className="note-error" role="alert">
          <p>{error}</p>
          {state.current.blocked ? (
            <>
              <button onClick={() => recover(false)}>重新加载服务器内容</button>
              <button onClick={() => setModal({ type: 'overwrite' })}>保留本地内容</button>
            </>
          ) : (
            <button onClick={() => setError('')}>关闭提示</button>
          )}
        </div>
      )}
      <div className="note-toolbar" role="toolbar" aria-label="笔记排版工具">
        <div className="note-tool-group">
          <label className="note-format-label" title="段落格式">
            <select
              aria-label="段落格式"
              disabled={!ready || busy || filter !== 'all'}
              value={
                editor.isActive('heading', { level: 1 })
                  ? 'h1'
                  : editor.isActive('heading', { level: 2 })
                    ? 'h2'
                    : 'paragraph'
              }
              onChange={(event) => {
                const chain = editor.chain().focus(undefined, { scrollIntoView: false });
                if (event.target.value === 'paragraph') chain.setParagraph().run();
                else chain.setHeading({ level: event.target.value === 'h1' ? 1 : 2 }).run();
              }}
            >
              <option value="paragraph">正文</option>
              <option value="h1">一级标题</option>
              <option value="h2">二级标题</option>
            </select>
          </label>
          <label className="note-size-label" title="选中文字修改局部；未选中时修改整篇字号">
            <select
              aria-label="笔记字号"
              disabled={!ready || busy || filter !== 'all'}
              value={editor.getAttributes('fontSize').size || ''}
              onChange={(event) => {
                const { from, to, empty } = formatSelection.current || editor.state.selection;
                const chain = editor.chain().setTextSelection({ from, to });
                if (empty) chain.selectAll();
                event.target.value
                  ? chain.setMark('fontSize', { size: Number(event.target.value) })
                  : chain.unsetMark('fontSize');
                if (empty) chain.setTextSelection({ from, to });
                chain.run();
              }}
            >
              <option value="">默认字号</option>
              {[12, 14, 16, 18, 20, 24, 28, 32].map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
          {action('加粗', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        </div>
        <div className="note-tool-group">
          {action(
            '列表',
            () => editor.chain().focus().toggleBulletList().run(),
            editor.isActive('bulletList'),
          )}
          {action(
            '编号',
            () => editor.chain().focus().toggleOrderedList().run(),
            editor.isActive('orderedList'),
          )}
          {action(
            '引用',
            () => editor.chain().focus().toggleBlockquote().run(),
            editor.isActive('blockquote'),
          )}
          {action('图片', () => picker.current.click())}
        </div>
        <div className="note-tool-group note-history-tools">
          {action(
            '撤销',
            () => editor.chain().focus().undo().run(),
            undefined,
            !editor.can().undo(),
          )}
          {action(
            '重做',
            () => editor.chain().focus().redo().run(),
            undefined,
            !editor.can().redo(),
          )}
        </div>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            [...event.target.files].forEach((file) =>
              queueImage(file, editor.state.selection.from),
            );
            event.target.value = '';
          }}
        />
      </div>
      <div className="note-format-hint">
        <span>选中文字设置加粗；段落格式用于正文和标题。</span>
        <span aria-live="polite">
          当前：
          {editor.isActive('heading', { level: 1 })
            ? '一级标题'
            : editor.isActive('heading', { level: 2 })
              ? '二级标题'
              : '正文'}
          {editor.isActive('bold') ? ' · 加粗' : ''}
        </span>
      </div>
      <div className="note-marker-bar">
        {action('重点', () => mark('important'), current?.node.attrs.important)}
        {action('疑问', () => mark('question'), current?.node.attrs.question)}
        {current?.node.attrs.question &&
          action(
            current.node.attrs.resolved ? '恢复疑问' : '标为已解决',
            () => mark('resolved'),
            current.node.attrs.resolved,
          )}
        <select
          aria-label="筛选笔记"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">全部内容</option>
          <option value="important">重点</option>
          <option value="questions">未解决疑问</option>
        </select>
      </div>
      {pending.length > 0 && (
        <div className="note-pending-files">
          {pending.map((item) => (
            <div key={item.id}>
              <span>
                {item.file.name || '截图'} · {item.uploading ? '正在上传…' : item.error || '待上传'}
              </span>
              {!item.uploading && (
                <>
                  <button onClick={() => uploadImage(item)}>重试</button>
                  <button
                    onClick={() =>
                      requestRemoval(async () => {
                        await pendingFile('delete', item.id);
                        state.current.pending--;
                        setPending((current) => current.filter((value) => value.id !== item.id));
                        if (!state.current.pending) save().catch(() => {});
                      })
                    }
                  >
                    移除
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {chapterJobs.map((job) => (
        <div className="note-job-result" key={job.id}>
          <span>
            {job.status === 'running'
              ? 'AI 正在后台处理笔记，可以继续编辑或切换页面。'
              : job.status === 'failed'
                ? job.error_text
                : 'AI 笔记结果已完成，原笔记尚未修改。'}
          </span>
          {job.status === 'done' && (
            <button
              onClick={() => {
                setResult(cleanAiNoteText(job.result_text));
                setModal({ type: 'result', job });
              }}
            >
              预览结果
            </button>
          )}
          {job.status === 'failed' && (
            <button
              onClick={() => {
                setRequirements(job.input_json.requirements);
                setModal({ type: 'ai', mode: job.input_json.mode });
              }}
            >
              重试
            </button>
          )}
        </div>
      ))}
      {filter !== 'all' && (
        <div className="note-filter-results">
          {marked.length ? (
            marked.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setFilter('all');
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(Math.min(item.pos + 1, editor.state.doc.content.size))
                    .scrollIntoView()
                    .run();
                }}
              >
                {item.label.slice(0, 160)}
              </button>
            ))
          ) : (
            <p>没有符合条件的笔记内容。</p>
          )}
        </div>
      )}
      <div
        className={filter === 'all' ? 'note-editor-wrap' : 'note-editor-wrap note-filter-hidden'}
      >
        <EditorContent editor={editor} />
      </div>
      <div className="note-source-list">
        {(() => {
          const sources = [];
          editor.state.doc.descendants((node) => {
            if (node.attrs.source) sources.push(node.attrs.source);
          });
          return sources.map((source, index) => (
            <button
              key={index}
              onClick={() => {
                try {
                  onReadSource?.(source);
                } catch (reason) {
                  setError(reason.message);
                }
              }}
            >
              来源：{source.name}
              {source.page ? ` · 第 ${source.page} 页` : ''}
            </button>
          ));
        })()}
      </div>
      {modal && (
        <Dialog
          busy={busy}
          variant={
            modal.type === 'result'
              ? 'wide'
              : ['clear', 'restore', 'overwrite', 'remove'].includes(modal.type)
                ? 'confirm'
                : 'form'
          }
          compact={modal.type === 'ai'}
          title={
            modal.type === 'ai'
              ? modal.mode === 'generate'
                ? 'AI 生成笔记'
                : 'AI 整理笔记'
              : modal.type === 'result'
                ? '预览笔记结果'
                : modal.type === 'export'
                  ? '导出学习笔记'
                  : modal.type === 'clear'
                    ? '删除整篇笔记？'
                    : modal.type === 'restore'
                      ? '恢复上一版本？'
                      : modal.type === 'overwrite'
                        ? '保留本地内容？'
                        : '移除图片？'
          }
          onClose={() => !busy && setModal(null)}
          footer={
            modal.type === 'result' ? (
              <>
                <button disabled={busy} onClick={() => setModal(null)}>
                  取消
                </button>
                <button disabled={busy} onClick={() => adopt(true)}>
                  追加到末尾
                </button>
                <button
                  className="primary"
                  disabled={busy || state.current.version !== modal.job.base_version}
                  onClick={() => adopt(false)}
                >
                  替换笔记内容
                </button>
              </>
            ) : modal.type === 'export' ? (
              <>
                <button disabled={busy} onClick={() => setModal(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => exportNotes(modal.format || 'md', modal.all || false)}
                >
                  {busy ? '正在导出…' : '导出'}
                </button>
              </>
            ) : (
              <>
                <button disabled={busy} onClick={() => setModal(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    if (modal.type === 'ai') return startAi();
                    setBusy(true);
                    try {
                      if (modal.type === 'remove') await modal.action();
                      if (modal.type === 'overwrite') await recover(true);
                      if (modal.type === 'clear') {
                        await save();
                        replaceEditor(textDocument(''));
                        await save(true);
                      }
                      if (modal.type === 'restore') {
                        await save();
                        const { note } = await noteRequest(token, `${base}/restore`, {
                          method: 'POST',
                          body: { version: state.current.version },
                        });
                        state.current.version = note.version;
                        state.current.saved = JSON.stringify(normalizeDocument(note.document));
                        state.current.hasPrevious = note.hasPrevious;
                        state.current.document = cleanLegacyNoteDocument(note.document);
                        editor.commands.setContent(state.current.document, { emitUpdate: false });
                        localStorage.removeItem(key);
                        setStatus('已保存');
                        setRevision((value) => value + 1);
                      }
                      setModal(null);
                    } catch (reason) {
                      setError(reason.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? '处理中…'
                    : modal.type === 'ai'
                      ? modal.mode === 'generate'
                        ? '后台生成'
                        : '后台整理'
                      : modal.type === 'clear'
                        ? '删除笔记'
                        : '确认'}
                </button>
              </>
            )
          }
        >
          {modal.type === 'ai' ? (
            <>
              <div className="note-ai-presets">
                {['整理结构', '提炼重点', '保留原意并精简'].map((value) => (
                  <button key={value} onClick={() => setRequirements(value)}>
                    {value}
                  </button>
                ))}
              </div>
              {modal.mode !== 'generate' && (
                <label>
                  整理范围
                  <select value={scope} onChange={(event) => setScope(event.target.value)}>
                    <option value="all">当前章节全文</option>
                    <option value="selection" disabled={!selection.current}>
                      选中文字
                    </option>
                  </select>
                </label>
              )}
              <label>
                向 AI 提要求
                <textarea
                  maxLength={500}
                  value={requirements}
                  onChange={(event) => setRequirements(event.target.value)}
                  placeholder="例如：按概念和例子分段，保留我的疑问。"
                />
              </label>
              <p className="note-ai-hint">
                {modal.mode === 'generate'
                  ? '依据当前章节匹配资料生成，预览采用前不会修改笔记。'
                  : '仅整理文字，图片和资料引用会保留。'}
              </p>
            </>
          ) : modal.type === 'result' ? (
            <>
              <div className="note-ai-original">
                <small>{modal.job.input_json.mode === 'generate' ? '本章参考资料' : '原文'}</small>
                <pre>{modal.job.input_json.text}</pre>
              </div>
              <label>
                整理结果
                <textarea
                  value={result}
                  maxLength={100000}
                  onChange={(event) => setResult(event.target.value)}
                />
              </label>
              {state.current.version !== modal.job.base_version && (
                <p>笔记已有修改，请追加结果或重新整理。</p>
              )}
            </>
          ) : modal.type === 'export' ? (
            <>
              <label>
                范围
                <select
                  value={modal.all ? 'all' : 'chapter'}
                  onChange={(event) => setModal({ ...modal, all: event.target.value === 'all' })}
                >
                  <option value="chapter">当前章节</option>
                  <option value="all">整门课程</option>
                </select>
              </label>
              <label>
                格式
                <select
                  value={modal.format || 'md'}
                  onChange={(event) => setModal({ ...modal, format: event.target.value })}
                >
                  <option value="md">Markdown 压缩包（含图片）</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
            </>
          ) : (
            <p>
              {modal.type === 'clear'
                ? '将删除本章整篇笔记内容，包括文字、图片与摘录。删除前保留恢复版本，可通过“恢复版本”找回。'
                : modal.type === 'restore'
                  ? '将恢复上一已保存版本的笔记内容，并保存当前版本以便随时切回。'
                  : modal.type === 'overwrite'
                    ? '本地草稿将替换服务器内容，请确认已核对两者。'
                    : '移除后仍被恢复版本引用的图片会保留。'}
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </Dialog>
      )}
    </section>
  );
}
