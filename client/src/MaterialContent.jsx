import { useEffect, useRef, useState } from 'react';
import { NoteExcerpt } from './LearningNotes';
import { splitImportedContent } from './imported-content.mjs';
import { api } from './student-api.mjs';

export function OriginalPdfPage({ courseId, materialId, page, onReadOriginal }) {
  const element = useRef(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!globalThis.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    setError('');
    setUrl('');
    setLoaded(false);
    let alive = true;
    let objectUrl;
    const controller = new AbortController();
    fetch(`${api}courses/${courseId}/materials/${materialId}/pages/${page}`, {
      headers: { Authorization: `Bearer ${localStorage.token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('原页加载失败，请打开原文件阅读。');
        objectUrl = URL.createObjectURL(await response.blob());
        if (alive) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((reason) => {
        if (alive && reason.name !== 'AbortError') setError(reason.message);
      });
    return () => {
      alive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [courseId, materialId, page, retry, visible]);
  return (
    <figure
      ref={element}
      className="original-pdf-page"
      data-reading-anchor={`pdf:${materialId}:${page}`}
      data-reading-state={loaded ? 'ready' : error ? 'error' : 'loading'}
      style={{ minHeight: 300 }}
    >
      <figcaption>原资料 · 第 {page} 页</figcaption>
      {error ? (
        <div>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="outline-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </button>{' '}
          <button type="button" className="outline-button" onClick={onReadOriginal}>
            阅读原文
          </button>
        </div>
      ) : url ? (
        <img
          src={url}
          alt={`原资料第 ${page} 页，保留原文与排版`}
          onLoad={() => setLoaded(true)}
          onError={() => setError('原页暂时无法显示，请重试或阅读原文。')}
        />
      ) : (
        <p>正在加载原页…</p>
      )}
    </figure>
  );
}

export function ChapterMaterialContent({ section, courseId, onReadOriginal }) {
  if (!section.originalRequired) return <ImportedContent content={section.content} />;
  return (
    <div className="original-chapter-content">
      <div className="original-page-notice">
        <span>
          {section.displayMode === 'pdf-images'
            ? '本章按 PDF 原页图片展示，保留公式与排版。'
            : '部分公式或符号未能完整提取，请以原资料为准。'}
        </span>
        <button type="button" onClick={onReadOriginal}>
          打开原文件
        </button>
      </div>
      {section.originalPages?.length ? (
        section.originalPages.map((page) => (
          <OriginalPdfPage
            key={page}
            courseId={courseId}
            materialId={section.materialId}
            page={page}
            onReadOriginal={onReadOriginal}
          />
        ))
      ) : (
        <p>未能准确定位原页，请打开原资料查看完整内容。</p>
      )}
    </div>
  );
}

export function MaterialNoteExcerpt({ token, course, chapter, section, onView }) {
  const [selected, setSelected] = useState('');
  const capture = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const container = selection.getRangeAt(0).commonAncestorContainer;
    const article =
      container.nodeType === 1
        ? container.closest('article')
        : container.parentElement?.closest('article');
    if (
      selection.toString().trim() &&
      article?.querySelector(`[data-note-material="${section.materialId}"]`)
    )
      setSelected(selection.toString().trim());
  };
  useEffect(() => {
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, [section.materialId]);
  return (
    <div data-note-material={section.materialId} className="material-note-excerpt">
      {selected && (
        <NoteExcerpt
          key={`${chapter.id}:${selected}`}
          token={token}
          courses={[course]}
          courseId={course.id}
          chapterId={chapter.id}
          content={selected}
          source={section.materialName}
          materialId={section.materialId}
          onView={onView}
        />
      )}
      {section.originalRequired && <small>原页中的公式或扫描内容可截图后插入学习笔记。</small>}
    </div>
  );
}

export function ImportedContent({ content }) {
  const { introduction, blocks } = splitImportedContent(content);
  return (
    <div className="imported-content">
      {introduction && <p className="imported-introduction">{introduction}</p>}
      <div className="imported-question-list">
        {blocks.map((block, index) => (
          <div className="imported-question" key={index}>
            <p>{block}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
