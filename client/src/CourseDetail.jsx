import { AddChapterModal, RenameMaterialModal } from './CourseDialogs.jsx';
import { requestJson as request } from './api-client.mjs';
import PaperDialog from './PaperDialog.jsx';
import { startChapterIllustration } from './ChapterIllustration.jsx';
import ChapterSourceEditor from './ChapterSourceEditor';
import { formatDateTime } from './date-format.mjs';
import { ReadingArea, PagedMaterialReader, readingApi } from './Reading';
import { useEffect, useRef, useState } from 'react';
import { LearningNotes } from './LearningNotes';
import {
  ChapterSummaryPanel,
  ChapterDraftPreviewModal,
  ChapterSuggestModal,
} from './ChapterPanels.jsx';
import {
  QuestionSettingsModal,
  PracticeAnswering,
  PracticePanel,
  PracticeRemovalModal,
} from './PracticeWorkspace.jsx';
import { MaterialNoteExcerpt, ChapterMaterialContent } from './MaterialContent.jsx';

export function CourseDetail({
  onSetChapterProgress,
  token,
  courseData,
  navigationTarget,
  userId,
  onVisitChapter,
  onSavePracticeProgress,
  onBack,
  onUpdate,
  onDelete,
  onAddChapter,
  onEditChapter,
  onDeleteChapter,
  onMoveChapter,
  onLoadChapterContent,
  onGenerateChapterSummary,
  onGeneratePractice,
  onSavePracticeAttempt,
  onDeletePractice,
  onUploadMaterials,
  onSuggestChapters,
  onConfirmDraft,
  onPreviewMaterial,
  onRenameMaterial,
  onDeleteMaterial,
  onOpenMaterialPreview,
  onOpenMaterialFile,
  onAskAssistant,
}) {
  const [chapterTitle, setChapterTitle] = useState('');
  const [addingChapter, setAddingChapter] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [chapterRequirementsOpen, setChapterRequirementsOpen] = useState(false);
  const [chapterRequirements, setChapterRequirements] = useState('');
  const [drafts, setDrafts] = useState(courseData.chapterDrafts || []);
  const [preview, setPreview] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  useEffect(() => {
    if (window.history.state?.mathAuthPanel === 'reader') {
      const m = courseData.materials.find(
        (m) => Number(m.id) === Number(window.history.state.materialId),
      );
      if (m) onOpenMaterialPreview(m).then((r) => r && setDocumentPreview(r));
    }
  }, []);
  const [materialsOpen, setMaterialsOpen] = useState(
    window.history.state?.mathAuthPanel === 'materials',
  );
  const [chapterContent, setChapterContent] = useState(null);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sideNotesOpen, setSideNotesOpen] = useState(
    () => sessionStorage.getItem(`reading-notes:${userId}:${courseData.course.id}`) === 'open',
  );
  useEffect(() => {
    sessionStorage.setItem(
      `reading-notes:${userId}:${courseData.course.id}`,
      sideNotesOpen ? 'open' : 'closed',
    );
  }, [sideNotesOpen, userId, courseData.course.id]);
  const [selectedChapterId, setSelectedChapterId] = useState(() => {
    const preferred =
      navigationTarget?.chapterId || Number(sessionStorage.getItem('math-auth-active-chapter'));
    return (
      courseData.chapters.find((chapter) => Number(chapter.id) === Number(preferred))?.id ||
      courseData.chapters[0]?.id ||
      null
    );
  });
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [activeTab, setActiveTab] = useState(
    navigationTarget?.tab ||
      (navigationTarget?.notes
        ? 'notes'
        : navigationTarget?.practiceId
          ? 'practice'
          : sessionStorage.getItem(`chapter-tab:${userId}:${courseData.course.id}`) || 'materials'),
  );
  useEffect(() => {
    sessionStorage.setItem(`chapter-tab:${userId}:${courseData.course.id}`, activeTab);
  }, [activeTab, userId, courseData.course.id]);
  const [practiceMode, setPracticeMode] = useState(
    navigationTarget?.practiceId ? 'answering' : 'list',
  );
  const [questionPreview, setQuestionPreview] = useState(null);
  const [activePractice, setActivePractice] = useState(() => {
    const practice = (courseData.practices || []).find(
      (item) => Number(item.id) === Number(navigationTarget?.practiceId),
    );
    return practice && navigationTarget?.attempt
      ? {
          ...practice,
          latest_attempt: navigationTarget.attempt,
          in_progress: null,
          history_view: true,
        }
      : practice || null;
  });
  useEffect(() => {
    const state = window.history.state;
    if (state?.mathAuthView !== 'course' || Number(state.courseId) !== Number(courseData.course.id))
      return;
    const target = { chapterId: selectedChapterId, tab: activeTab };
    if (activeTab === 'practice' && practiceMode === 'answering' && activePractice) {
      target.practiceId = activePractice.id;
      if (activePractice.history_view) target.attempt = activePractice.latest_attempt;
    }
    // 刷新恢复当前内容，不能继续使用最初从首页或搜索进入时的目标。
    window.history.replaceState(
      { ...state, chapterId: selectedChapterId, navigationTarget: target },
      '',
      window.location.href,
    );
  }, [selectedChapterId, activeTab, practiceMode, activePractice, courseData.course.id]);
  const [practiceRemoval, setPracticeRemoval] = useState(null);
  const [chapterDraftPreview, setChapterDraftPreview] = useState(false);
  useEffect(() => setDrafts(courseData.chapterDrafts || []), [courseData.chapterDrafts]);
  useEffect(() => {
    if (!courseData.chapters.some((chapter) => chapter.id === selectedChapterId))
      setSelectedChapterId(courseData.chapters[0]?.id || null);
  }, [courseData.chapters, selectedChapterId]);
  const initialChapter = useRef(true);
  useEffect(() => {
    if (initialChapter.current) {
      initialChapter.current = false;
      return;
    }
    setPracticeMode('list');
    setQuestionPreview(null);
    setActivePractice(null);
  }, [selectedChapterId]);
  useEffect(() => {
    if (selectedChapterId) onVisitChapter(selectedChapterId);
  }, [selectedChapterId]);
  useEffect(() => {
    if (!selectedChapterId) return;
    const controller = new AbortController();
    startChapterIllustration(
      token,
      courseData.course.id,
      selectedChapterId,
      controller.signal,
    ).catch(() => {});
    return () => controller.abort();
  }, [token, courseData.course.id, selectedChapterId]);
  useEffect(
    () => () => {
      if (documentPreview?.url) URL.revokeObjectURL(documentPreview.url);
    },
    [documentPreview],
  );
  useEffect(() => {
    const handleBrowserBack = (event) => {
      const panel = event.state?.mathAuthPanel;
      if (panel === 'reader') {
        const material = courseData.materials?.find(
          (item) => Number(item.id) === Number(event.state?.materialId),
        );
        setMaterialsOpen(false);
        if (material && Number(documentPreview?.material?.id) !== Number(material.id))
          onOpenMaterialPreview(material).then((result) => {
            if (result) setDocumentPreview(result);
          });
        return;
      }
      if (panel === 'materials') {
        setDocumentPreview(null);
        setMaterialsOpen(true);
        return;
      }
      setDocumentPreview(null);
      setMaterialsOpen(false);
    };
    window.addEventListener('popstate', handleBrowserBack);
    return () => window.removeEventListener('popstate', handleBrowserBack);
  }, [courseData.materials, documentPreview, onOpenMaterialPreview]);
  const openMaterials = () => {
    setMaterialsOpen(true);
    window.history.pushState(
      {
        ...window.history.state,
        mathAuthView: 'course',
        courseId: courseData.course.id,
        mathAuthPanel: 'materials',
      },
      '',
      window.location.href,
    );
  };
  const closeMaterials = () => {
    if (window.history.state?.mathAuthPanel === 'materials') window.history.back();
    else setMaterialsOpen(false);
  };
  const closeDocumentPreview = () => {
    if (window.history.state?.mathAuthPanel === 'reader') window.history.back();
    else setDocumentPreview(null);
  };
  const readMaterial = async (material, page = null, bookmarkPosition = null) => {
    const result = await onOpenMaterialPreview(material);
    if (result) {
      window.history.pushState(
        {
          ...window.history.state,
          mathAuthView: 'course',
          courseId: courseData.course.id,
          mathAuthPanel: 'reader',
          materialId: material.id,
        },
        '',
        window.location.href,
      );
      setDocumentPreview(
        page && result.url
          ? { ...result, initialPage: page, bookmarkPosition, url: `${result.url}#page=${page}` }
          : result,
      );
    }
  };
  useEffect(() => {
    let live = true;
    if (navigationTarget?.resumeReading && selectedChapterId)
      readingApi(token, `courses/${courseData.course.id}/chapters/${selectedChapterId}/reading`)
        .then((d) => {
          const m = courseData.materials.find((m) => Number(m.id) === Number(d.latestMaterialId));
          if (live && m && window.history.state?.mathAuthPanel !== 'reader') readMaterial(m);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (navigationTarget?.materialId) {
      const m = courseData.materials.find(
        (m) => Number(m.id) === Number(navigationTarget.materialId),
      );
      if (m && window.history.state?.mathAuthPanel !== 'reader') readMaterial(m);
    }
  }, []);
  const readingRequest = useRef(0);
  const readChapter = async (chapter) => {
    if (!chapter) return;
    const request = ++readingRequest.current;
    setSelectedChapterId(chapter.id);
    setLoadingChapter(true);
    const result = await onLoadChapterContent(chapter);
    if (request !== readingRequest.current) return;
    setLoadingChapter(false);
    if (result) setChapterContent(result);
  };
  const submitChapter = async (event) => {
    event.preventDefault();
    if (!chapterTitle.trim()) return;
    setSaving(true);
    try {
      await onAddChapter({ title: chapterTitle, description: '' });
      setChapterTitle('');
    } finally {
      setSaving(false);
    }
  };
  const [chapterPercent, setChapterPercent] = useState({});
  useEffect(() => {
    let live = true;
    Promise.allSettled(
      courseData.chapters.map(async (ch) => {
        const d = await readingApi(
          token,
          `courses/${courseData.course.id}/chapters/${ch.id}/reading`,
        );
        return [ch.id, d.position?.progress || 0];
      }),
    ).then((results) => {
      if (live)
        setChapterPercent(
          Object.fromEntries(results.filter((r) => r.status === 'fulfilled').map((r) => r.value)),
        );
    });
    return () => {
      live = false;
    };
  }, [token, courseData.course.id, courseData.chapters.map((ch) => ch.id).join(',')]);
  const [progressBusy, setProgressBusy] = useState(false);
  const [progressError, setProgressError] = useState('');
  const toggleProgress = async () => {
    setProgressBusy(true);
    setProgressError('');
    try {
      await onSetChapterProgress(selectedChapter, !selectedChapter.completed_at);
    } catch (e) {
      setProgressError(e.message);
    } finally {
      setProgressBusy(false);
    }
  };
  const selectedChapter =
    courseData.chapters.find((chapter) => chapter.id === selectedChapterId) ||
    courseData.chapters[0] ||
    null;
  const selectedChapterIndex = selectedChapter
    ? courseData.chapters.findIndex((chapter) => chapter.id === selectedChapter.id)
    : -1;
  const prevChapter =
    selectedChapterIndex > 0 ? courseData.chapters[selectedChapterIndex - 1] : null;
  const nextChapter =
    selectedChapterIndex >= 0 && selectedChapterIndex < courseData.chapters.length - 1
      ? courseData.chapters[selectedChapterIndex + 1]
      : null;
  const selectAndScrollChapter = (chapter) => {
    if (!chapter) return;
    setSelectedChapterId(chapter.id);
    if (activeTab === 'materials') readChapter(chapter);
    requestAnimationFrame(() =>
      document
        .querySelector('.reading-header')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };
  const isCurrentContent = selectedChapter && chapterContent?.chapter?.id === selectedChapter.id;
  useEffect(() => {
    if (selectedChapterId && activeTab === 'materials')
      readChapter(courseData.chapters.find((ch) => ch.id === selectedChapterId));
  }, [selectedChapterId, activeTab]);
  const selectedPractices = selectedChapter
    ? (courseData.practices || []).filter(
        (item) => Number(item.chapter_id) === Number(selectedChapter.id),
      )
    : [];
  const selectedSummary = selectedChapter
    ? (courseData.chapterSummaries || []).find(
        (item) => Number(item.chapterId) === Number(selectedChapter.id),
      )
    : null;
  return (
    <>
      <div className="course-detail-backbar">
        <button className="back-link" type="button" onClick={onBack}>
          ← 返回我的课程
        </button>
      </div>
      <section className="course-learning-layout">
        <aside className="chapter-outline">
          <div className="chapter-outline-head">
            <div>
              <p className="eyebrow">课程目录</p>
              <h2>章节</h2>
            </div>
            <button className="outline-add" type="button" onClick={() => setAddingChapter(true)}>
              ＋
            </button>
          </div>
          <div className="chapter-ai-actions">
            <button
              type="button"
              disabled={!courseData.materials?.length}
              onClick={() => setChapterRequirementsOpen(true)}
            >
              AI 整理章节
            </button>
          </div>
          {drafts.length > 0 ? (
            <section className="outline-draft">
              <strong>AI 已整理出 {drafts.length} 个章节</strong>
              <p>可先查看每个章节，再决定是否采用。</p>
              <button
                className="outline-button"
                type="button"
                onClick={() => setChapterDraftPreview(true)}
              >
                查看并采用目录
              </button>
            </section>
          ) : courseData.chapters.length ? (
            <ol className="outline-list">
              {courseData.chapters.map((chapter, index) => (
                <li key={chapter.id} className="outline-item">
                  <button
                    className={
                      selectedChapter?.id === chapter.id
                        ? 'outline-chapter active'
                        : 'outline-chapter'
                    }
                    type="button"
                    onClick={() => selectAndScrollChapter(chapter)}
                  >
                    <span>{index + 1}</span>
                    <strong title={chapter.title}>{chapter.title}</strong>
                    <small className="chapter-percent">
                      {chapter.completed_at ? 100 : chapterPercent[chapter.id] || 0}%
                    </small>
                    <i
                      className={chapter.completed_at ? 'chapter-done completed' : 'chapter-done'}
                      aria-label={chapter.completed_at ? '已学完' : undefined}
                      aria-hidden={!chapter.completed_at}
                    >
                      {chapter.completed_at && (
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                          <path
                            d="m5 10 3.2 3.2L15 6.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </i>
                  </button>
                  {courseData.chapters.length > 1 && (
                    <div className="outline-move-group" aria-label={`调整“${chapter.title}”顺序`}>
                      <button
                        type="button"
                        className="outline-move-btn"
                        disabled={index === 0}
                        title="上移章节"
                        aria-label={`上移“${chapter.title}”`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveChapter?.(chapter.id, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="outline-move-btn"
                        disabled={index === courseData.chapters.length - 1}
                        title="下移章节"
                        aria-label={`下移“${chapter.title}”`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveChapter?.(chapter.id, 1);
                        }}
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <div className="outline-empty">
              <p>还没有章节</p>
              <button type="button" onClick={() => setAddingChapter(true)}>
                添加第一章
              </button>
            </div>
          )}
        </aside>
        <section
          className={`chapter-reading-panel ${activeTab === 'materials' && sideNotesOpen ? 'reading-notes-layout' : ''}`}
        >
          {selectedChapter ? (
            <>
              <header className="reading-header">
                <div>
                  <p className="eyebrow">第 {selectedChapterIndex + 1} 章</p>
                  <h2>{selectedChapter.title}</h2>
                </div>
                <div className="reading-actions">
                  <button onClick={() => onEditChapter(selectedChapter)}>编辑</button>
                  <button className="danger-text" onClick={() => onDeleteChapter(selectedChapter)}>
                    删除
                  </button>
                </div>
              </header>
              <nav className="chapter-tabs" aria-label="章节功能">
                <button
                  className={activeTab === 'notes' ? 'active' : ''}
                  onClick={() => setActiveTab('notes')}
                >
                  学习笔记
                </button>
                <button
                  className={activeTab === 'materials' ? 'active' : ''}
                  onClick={() => setActiveTab('materials')}
                >
                  学习资料
                </button>
                <button
                  className={activeTab === 'summary' ? 'active' : ''}
                  onClick={() => setActiveTab('summary')}
                >
                  章节总结
                </button>
                <button
                  className={activeTab === 'practice' ? 'active' : ''}
                  onClick={() => setActiveTab('practice')}
                >
                  章节练习
                </button>
                <div className="chapter-tab-tools">
                  {activeTab === 'materials' && courseData.materials.length > 0 && (
                    <button
                      type="button"
                      className="source-correction-button"
                      onClick={() => setSourceEditorOpen(true)}
                    >
                      修正资料
                    </button>
                  )}
                  {activeTab === 'materials' && (
                    <button
                      type="button"
                      className="reading-note-toggle"
                      aria-expanded={sideNotesOpen}
                      aria-controls="reading-side-notes"
                      onClick={() => setSideNotesOpen((value) => !value)}
                    >
                      {sideNotesOpen ? '收起笔记' : '边读边记'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="chapter-ask-assistant-btn"
                    title="围绕本章内容向学习助手提问（若已划选正文会自动带入）"
                    onClick={() => {
                      const excerpt = window.getSelection?.()?.toString().trim() || '';
                      onAskAssistant?.(courseData.course, selectedChapter, excerpt);
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
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
                    <span>问助手</span>
                  </button>
                </div>
              </nav>
              {progressError && (
                <p className="form-error" role="alert">
                  {progressError}
                </p>
              )}
              <div
                className={`reading-with-notes ${activeTab === 'materials' && sideNotesOpen ? 'notes-open' : ''}`}
              >
                <div className="chapter-reading-content">
                  {activeTab === 'notes' ? (
                    <LearningNotes
                      onReadSource={(source) => {
                        const material = courseData.materials.find(
                          (item) => Number(item.id) === Number(source.materialId),
                        );
                        if (material) readMaterial(material, source.page);
                        else throw new Error('原资料已删除或来源不在资料库中。摘录内容仍保留。');
                      }}
                      key={selectedChapter.id}
                      token={token}
                      userId={userId}
                      courseId={courseData.course.id}
                      chapter={selectedChapter}
                    />
                  ) : activeTab === 'summary' ? (
                    <ChapterSummaryPanel
                      onViewNote={() => setActiveTab('notes')}
                      token={token}
                      course={courseData.course}
                      chapter={selectedChapter}
                      summary={selectedSummary}
                      hasMaterials={Boolean(courseData.materials?.length)}
                      onGenerate={onGenerateChapterSummary}
                    />
                  ) : activeTab === 'practice' ? (
                    practiceMode === 'settings' ? (
                      <QuestionSettingsModal
                        chapter={selectedChapter}
                        onClose={() => setPracticeMode('list')}
                        onGenerate={(settings) =>
                          onGeneratePractice(selectedChapter.id, selectedChapter.title, settings)
                        }
                      />
                    ) : practiceMode === 'answering' && activePractice ? (
                      <PracticeAnswering
                        onReadChapter={() => setActiveTab('materials')}
                        practice={activePractice}
                        userId={userId}
                        onSaveProgress={(answers) =>
                          onSavePracticeProgress(activePractice, answers)
                        }
                        onComplete={(records) => onSavePracticeAttempt(activePractice, records)}
                        onBack={() => {
                          setActivePractice(null);
                          setPracticeMode('list');
                        }}
                      />
                    ) : (
                      <PracticePanel
                        chapter={selectedChapter}
                        practices={selectedPractices}
                        onGenerate={() => setPracticeMode('settings')}
                        onStart={(practice) => {
                          setActivePractice(practice);
                          setPracticeMode('answering');
                        }}
                        onDeletePractice={(practice) =>
                          setPracticeRemoval({
                            kind: 'practice',
                            practice,
                            title: '删除这份练习？',
                            message: `确定删除“${practice.title}”吗？`,
                          })
                        }
                      />
                    )
                  ) : loadingChapter ? (
                    <div className="reading-state">正在展开本章内容…</div>
                  ) : isCurrentContent ? (
                    chapterContent.found ? (
                      <ReadingArea
                        key={`${selectedChapter.id}:${chapterContent.sections.map((s) => s.materialId).join('-')}`}
                        token={token}
                        courseId={courseData.course.id}
                        chapterId={selectedChapter.id}
                        title={selectedChapter.title}
                        zoomable={chapterContent.sections.some(
                          (section) => section.originalPages?.length,
                        )}
                        completed={Boolean(selectedChapter.completed_at)}
                        onProgress={(percent) =>
                          setChapterPercent((current) =>
                            current[selectedChapter.id] === percent
                              ? current
                              : { ...current, [selectedChapter.id]: percent },
                          )
                        }
                        onBookmarkMaterial={(mark) => {
                          const m = courseData.materials.find(
                            (m) => Number(m.id) === Number(mark.material_id),
                          );
                          if (m) readMaterial(m, mark.position.page, mark.position);
                        }}
                      >
                        <div className="chapter-sections">
                          {chapterContent.sections.map((section, index) => (
                            <article key={`${section.materialId}-${index}`}>
                              <small>
                                {section.materialName} ·{' '}
                                {section.displayMode === 'pdf-images'
                                  ? 'PDF 原图'
                                  : section.corrected
                                    ? '已修正'
                                    : '原始提取'}
                              </small>
                              <MaterialNoteExcerpt
                                token={token}
                                course={courseData.course}
                                chapter={selectedChapter}
                                section={section}
                                onView={() => setActiveTab('notes')}
                              />
                              <ChapterMaterialContent
                                section={section}
                                courseId={courseData.course.id}
                                onReadOriginal={() => {
                                  const material = courseData.materials.find(
                                    (item) => Number(item.id) === Number(section.materialId),
                                  );
                                  if (material) readMaterial(material);
                                }}
                              />
                            </article>
                          ))}
                        </div>
                      </ReadingArea>
                    ) : (
                      <div className="reading-state">
                        <strong>暂未定位到本章内容</strong>
                        <p>可以调整章节名称后重试，或从资料库打开原资料阅读。</p>
                        <button type="button" onClick={() => readChapter(selectedChapter)}>
                          重新展开
                        </button>
                        <button
                          className="outline-button"
                          type="button"
                          onClick={() =>
                            courseData.materials.length === 1
                              ? readMaterial(courseData.materials[0])
                              : openMaterials()
                          }
                        >
                          阅读原文
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="reading-state">
                      <strong>展开本章内容</strong>
                      <p>点击右侧按钮，将从已导入的资料中展示与本章对应的原文。</p>
                      <button
                        className="outline-button"
                        disabled={!courseData.materials?.length}
                        type="button"
                        onClick={() => readChapter(selectedChapter)}
                      >
                        {courseData.materials?.length ? '展开本章内容' : '请先导入资料'}
                      </button>
                    </div>
                  )}
                  {!(activeTab === 'practice' && practiceMode === 'answering') && (
                    <footer className="chapter-progression-bar" aria-label="章节连贯翻页">
                      <div className="progression-side">
                        {prevChapter ? (
                          <button
                            type="button"
                            className="progression-step-btn is-prev"
                            onClick={() => selectAndScrollChapter(prevChapter)}
                          >
                            <span className="progression-arrow">←</span>
                            <span className="progression-meta">
                              <small>上一章 · 第 {selectedChapterIndex} 章</small>
                              <strong>{prevChapter.title}</strong>
                            </span>
                          </button>
                        ) : (
                          <span className="progression-boundary">已至首章</span>
                        )}
                      </div>
                      <div className="progression-center">
                        {activeTab === 'materials' && (
                          <button
                            type="button"
                            className={
                              selectedChapter.completed_at
                                ? 'progression-complete-btn is-done'
                                : 'progression-complete-btn'
                            }
                            disabled={progressBusy}
                            aria-pressed={Boolean(selectedChapter.completed_at)}
                            onClick={toggleProgress}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 20 20"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="m5 10 3.2 3.2L15 6.5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span>
                              {progressBusy
                                ? '保存中…'
                                : selectedChapter.completed_at
                                  ? '本章已学完'
                                  : '标记本章学完'}
                            </span>
                          </button>
                        )}
                      </div>
                      <div className="progression-side is-end">
                        {nextChapter ? (
                          <button
                            type="button"
                            className="progression-step-btn is-next"
                            onClick={() => selectAndScrollChapter(nextChapter)}
                          >
                            <span className="progression-meta">
                              <small>下一章 · 第 {selectedChapterIndex + 2} 章</small>
                              <strong>{nextChapter.title}</strong>
                            </span>
                            <span className="progression-arrow">→</span>
                          </button>
                        ) : (
                          <span className="progression-boundary">已至末章</span>
                        )}
                      </div>
                    </footer>
                  )}
                </div>
                {activeTab === 'materials' && sideNotesOpen && (
                  <aside
                    id="reading-side-notes"
                    className="reading-side-notes"
                    aria-label="本章笔记"
                  >
                    <div className="side-note-heading">
                      <span>本章笔记</span>
                      <button
                        type="button"
                        aria-label="收起本章笔记"
                        onClick={() => setSideNotesOpen(false)}
                      >
                        ×
                      </button>
                    </div>
                    <LearningNotes
                      key={selectedChapter.id}
                      token={token}
                      userId={userId}
                      courseId={courseData.course.id}
                      chapter={selectedChapter}
                      onReadSource={(source) => {
                        const material = courseData.materials.find(
                          (item) => Number(item.id) === Number(source.materialId),
                        );
                        if (material) readMaterial(material, source.page);
                        else throw new Error('原资料已删除，摘录内容仍保留。');
                      }}
                    />
                  </aside>
                )}
              </div>
            </>
          ) : (
            <div className="reading-state">
              <strong>选择一个章节</strong>
              <p>从左侧目录快速切换，即可在这里展开内容。</p>
            </div>
          )}
        </section>
      </section>
      {practiceRemoval && (
        <PracticeRemovalModal
          removal={practiceRemoval}
          onClose={() => setPracticeRemoval(null)}
          onConfirm={() => onDeletePractice(practiceRemoval.practice)}
        />
      )}
      {chapterDraftPreview && (
        <ChapterDraftPreviewModal
          chapters={drafts}
          onClose={() => setChapterDraftPreview(false)}
          onAdopt={onConfirmDraft}
        />
      )}
      {chapterRequirementsOpen && (
        <ChapterSuggestModal
          onClose={() => setChapterRequirementsOpen(false)}
          onSuggest={onSuggestChapters}
        />
      )}
      {sourceEditorOpen && selectedChapter && (
        <ChapterSourceEditor
          token={token}
          courseId={courseData.course.id}
          chapter={selectedChapter}
          materials={courseData.materials}
          onClose={() => setSourceEditorOpen(false)}
          onSaved={() => readChapter(selectedChapter)}
          onRead={(material) => readMaterial(material)}
        />
      )}
      {materialsOpen && (
        <div className="modal-backdrop library-overlay">
          <PaperDialog onDismiss={closeMaterials} className="library-dialog">
            <header className="library-dialog-header">
              <div className="library-title-row">
                <span className="library-symbol">▤</span>
                <div>
                  <p>课程资料</p>
                  <h2>资料库</h2>
                  <small>{courseData.course.title}</small>
                </div>
              </div>
              <button
                className="library-close"
                type="button"
                onClick={closeMaterials}
                aria-label="关闭资料库"
              >
                ×
              </button>
            </header>
            <div className="library-dialog-body">
              <div className="library-summary">
                <div>
                  <strong>{courseData.materials?.length || 0}</strong>
                  <span>份学习资料</span>
                </div>
                <label className="library-import">
                  <input
                    type="file"
                    accept=".pdf,.docx,.pptx"
                    multiple
                    onChange={async (event) => {
                      const files = event.target.files;
                      if (!files?.length) return;
                      setUploadError('');
                      setUploading(true);
                      try {
                        await onUploadMaterials(files);
                        event.target.value = '';
                      } catch (reason) {
                        setUploadError(reason.message);
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                  {uploading ? '正在解析…' : '导入资料'}
                </label>
              </div>
              {uploadError && <p className="form-error">{uploadError}</p>}
              {courseData.materials?.length ? (
                <div className="library-files">
                  {courseData.materials.map((material) => (
                    <article className="library-file-card" key={material.id}>
                      <div className="library-file-info">
                        <span>文档</span>
                        <div>
                          <strong title={material.original_name}>{material.original_name}</strong>
                          <small>已提取 {material.text_length} 字</small>
                          {material.admin_status === 'paused' && (
                            <small className="content-paused-note">
                              已暂停 · {material.admin_reason} ·{' '}
                              {formatDateTime(material.admin_changed_at)}
                            </small>
                          )}
                        </div>
                      </div>
                      <div className="library-file-actions">
                        <button className="library-read" onClick={() => readMaterial(material)}>
                          阅读
                        </button>
                        <button
                          onClick={async () => {
                            const data = await onPreviewMaterial(material);
                            if (data) setPreview(data.material);
                          }}
                        >
                          文字
                        </button>
                        <button onClick={() => onOpenMaterialFile(material)}>下载</button>
                        <button onClick={() => setRenameTarget(material)}>改名</button>
                        <button
                          className="library-delete"
                          onClick={() => onDeleteMaterial(material)}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="library-empty-state">
                  <span>▤</span>
                  <strong>还没有学习资料</strong>
                  <p>导入 PDF、Word 或 PPT 后，在这里统一阅读和管理。</p>
                </div>
              )}
            </div>
          </PaperDialog>
        </div>
      )}{' '}
      {addingChapter && (
        <AddChapterModal
          chapters={courseData.chapters}
          onClose={() => setAddingChapter(false)}
          onSave={async (values) => {
            await onAddChapter(values);
            setAddingChapter(false);
          }}
        />
      )}
      {renameTarget && (
        <RenameMaterialModal
          material={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={onRenameMaterial}
        />
      )}
      {preview && (
        <div className="modal-backdrop">
          <PaperDialog onDismiss={() => setPreview(null)} className="record-modal material-preview">
            <div className="modal-header">
              <div>
                <p className="eyebrow">资料文字预览</p>
                <h2>{preview.original_name}</h2>
              </div>
              <button className="icon-close" onClick={() => setPreview(null)}>
                ×
              </button>
            </div>
            <pre>{preview.extracted_text}</pre>
          </PaperDialog>
        </div>
      )}
      {false && chapterContent && (
        <div className="modal-backdrop">
          <PaperDialog
            onDismiss={() => setChapterContent(null)}
            className="record-modal chapter-content-modal"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">
                  {chapterContent.contentType === 'question-bank' ? '本章相关原题' : '本章原文内容'}
                </p>
                <h2>{chapterContent.chapter.title}</h2>
              </div>
              <button className="icon-close" onClick={() => setChapterContent(null)}>
                ×
              </button>
            </div>
            {chapterContent.found ? (
              <div className="chapter-content-body">
                {chapterContent.sections.map((section, index) => (
                  <article key={`${section.materialId}-${index}`}>
                    <small>来源：{section.materialName}</small>
                    <ChapterMaterialContent
                      section={section}
                      courseId={courseData.course.id}
                      onReadOriginal={() => {
                        const material = courseData.materials.find(
                          (item) => Number(item.id) === Number(section.materialId),
                        );
                        if (material) readMaterial(material);
                      }}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="chapter-content-empty">
                <strong>暂未从资料文字中定位到这一章</strong>
                <p>可以从右侧“开始阅读”查看完整原资料，或调整章节名称后再试。</p>
              </div>
            )}
          </PaperDialog>
        </div>
      )}
      {documentPreview && (
        <section className="material-reader-page">
          <header>
            <div>
              <button className="back-link" onClick={closeDocumentPreview}>
                ← 返回课程
              </button>
              <h1>{documentPreview.material.original_name}</h1>
              <p>课程资料阅读</p>
            </div>
            <div>
              <button
                className="reader-download"
                type="button"
                onClick={() => onOpenMaterialFile(documentPreview.material)}
              >
                下载原文件
              </button>
              <button className="icon-close" type="button" onClick={closeDocumentPreview}>
                ×
              </button>
            </div>
          </header>
          <main>
            {selectedChapter ? (
              <PagedMaterialReader
                key={`${selectedChapter.id}:${documentPreview.material.id}`}
                token={token}
                courseId={courseData.course.id}
                chapterId={selectedChapter.id}
                material={documentPreview.material}
                title={documentPreview.material.original_name}
                initialPage={documentPreview.initialPage}
                bookmarkPosition={documentPreview.bookmarkPosition}
                originalUrl={documentPreview.url}
              />
            ) : (
              <iframe
                title={`阅读 ${documentPreview.material.original_name}`}
                src={documentPreview.url}
              />
            )}
          </main>
        </section>
      )}
    </>
  );
}
