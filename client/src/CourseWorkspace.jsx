import { ConfirmModal, NameEditor } from './CourseDialogs.jsx';
import { requestJson as request } from './api-client.mjs';
import AccountPanel, { AccountEntry } from './AccountPanel.jsx';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import { pendingAttempt } from './attempt-request.mjs';
import LearningOverview from './LearningOverview';
import Search from './Search';
import { ReviewSchedulePanel } from './ReviewSchedules';
import LearningPlanPanel, { useLearningPlans, PlanTaskTray } from './LearningPlans';
import { useEffect, useRef, useState } from 'react';
import WrongReview from './WrongReview';
import { NoteTaskTray } from './NoteJobs';
import CourseShelf from './CourseShelf.jsx';
import CourseForm from './CourseForm.jsx';
import { uploadFiles, api } from './student-api.mjs';
import { Brand } from './Brand.jsx';
import { AssistantLanding } from './StudentContent.jsx';
import { CourseDetail } from './CourseDetail.jsx';
import { ShelfLibraryModal } from './ShelfLibraryModal.jsx';

export function CourseWorkspace({
  token,
  user,
  logout,
  onUser,
  account,
  onAccount,
  onReloadAccount,
}) {
  const [accountDialog, setAccountDialog] = useState(null);
  const [courses, setCourses] = useState([]);
  const [activeCourse, setActiveCourse] = useState(null);
  const [activeView, setActiveView] = useState(
    () => sessionStorage.getItem('math-auth-active-view') || 'home',
  );
  const [reviewTarget, setReviewTarget] = useState(
    () => window.history.state?.reviewTaskId || null,
  );
  const [homeData, setHomeData] = useState(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');
  const [navigationTarget, setNavigationTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const learningPlans = useLearningPlans(token);
  const [nameEditor, setNameEditor] = useState(null);
  const [shelfLibrary, setShelfLibrary] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [error, setError] = useState('');
  const [aiJobs, setAiJobs] = useState([]);
  const [aiNotice, setAiNotice] = useState('');
  const observedJobs = useRef(new Map());
  const refreshGenerationJobs = async () => {
    const { jobs } = await request('generation-jobs', { token });
    setAiJobs(jobs);
    for (const job of jobs) {
      if (job.status === 'done' && observedJobs.current.get(job.id) !== 'done') {
        const data = await request('courses/' + job.course_id, { token });
        setActiveCourse((current) =>
          Number(current?.course?.id) === Number(job.course_id) ? data : current,
        );
      }
      observedJobs.current.set(job.id, job.status);
    }
  };
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (alive) refreshGenerationJobs().catch(() => {});
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);
  const startGeneration = async (input) => {
    try {
      await request('generation-jobs', { token, method: 'POST', body: input });
      await refreshGenerationJobs();
      return true;
    } catch (reason) {
      setError(reason.message);
      return false;
    }
  };
  const actOnGeneration = async (job, action) => {
    try {
      await request('generation-jobs/' + job.id + '/' + action, { token, method: 'POST' });
      await refreshGenerationJobs();
    } catch (reason) {
      setError(reason.message);
    }
  };

  useEffect(() => {
    if (!aiNotice) return;
    const timer = window.setTimeout(() => setAiNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [aiNotice]);

  useEffect(() => {
    if (!error?.startsWith('暂未从资料中定位到本章内容')) return;
    const timer = window.setTimeout(
      () => setError((current) => (current === error ? '' : current)),
      5000,
    );
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!window.history.state?.mathAuthView)
      window.history.replaceState(
        { mathAuthView: sessionStorage.getItem('math-auth-active-view') || 'home' },
        '',
        window.location.href,
      );
  }, []);

  const loadHome = async () => {
    setHomeLoading(true);
    try {
      const data = await request('learning-home', { token });
      setHomeData(data);
      setHomeError('');
    } catch (reason) {
      setHomeError(reason.message);
    } finally {
      setHomeLoading(false);
    }
  };

  const [searchWrong, setSearchWrong] = useState(() => window.history.state?.searchWrongId || null);
  const openSearchResult = async (item) => {
    if (item.type === 'wrong') {
      const d = await request('wrong-questions', { token });
      if (!d.questions.some((q) => Number(q.id) === Number(item.id)))
        throw new Error('原错题已删除，请重新搜索');
      showView('wrong-review');
      setSearchWrong(item.id);
      window.history.replaceState(
        { ...window.history.state, searchWrongId: item.id },
        '',
        window.location.href,
      );
      return;
    }
    const d = await request(`courses/${item.courseId}`, { token });
    if (item.chapterId && !d.chapters.some((ch) => Number(ch.id) === Number(item.chapterId)))
      throw new Error('章节已删除，请重新搜索');
    if (item.type === 'material' && !d.materials.some((m) => Number(m.id) === Number(item.id)))
      throw new Error('资料已删除，请重新搜索');
    await openCourse(item.courseId, {
      chapterId: item.chapterId,
      notes: item.type === 'note',
      materialId: item.type === 'material' ? item.id : null,
    });
  };
  const openScheduledReview = (id) => {
    showView('wrong-review');
    setReviewTarget(id);
    window.history.replaceState(
      { ...window.history.state, reviewTaskId: id },
      '',
      window.location.href,
    );
  };
  const showView = (view) => {
    setReviewTarget(null);
    setSearchWrong(null);
    sessionStorage.removeItem('math-auth-active-course');
    sessionStorage.removeItem('math-auth-active-chapter');
    setActiveCourse(null);
    setNavigationTarget(null);
    setActiveView(view);
    window.history.pushState(
      { mathAuthView: view, searchCanGoBack: view === 'search' },
      '',
      window.location.href,
    );
  };

  const loadCourses = async () => {
    setLoading(true);
    try {
      const data = await request('courses', { token });
      setCourses(data.courses);
      setError('');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  const openCourse = async (courseId, target = null) => {
    try {
      const data = await request(`courses/${courseId}`, { token });
      setActiveCourse(data);
      setActiveView('courses');
      setNavigationTarget(target);
      if (target?.chapterId)
        sessionStorage.setItem('math-auth-active-chapter', String(target.chapterId));
      window.history.pushState(
        {
          mathAuthView: 'course',
          courseId,
          chapterId: target?.chapterId || null,
          navigationTarget: target,
        },
        '',
        window.location.href,
      );
      setError('');
    } catch (reason) {
      setError(reason.message);
    }
  };

  const openHistory = async (item) => {
    try {
      const data = await request(`learning-home/attempts/${item.attempt_id}`, { token });
      await openCourse(item.course_id, {
        chapterId: item.chapter_id,
        practiceId: item.practice_id,
        attempt: data.attempt,
      });
    } catch (reason) {
      setError(reason.message);
    }
  };

  useEffect(() => {
    loadCourses();
  }, []);
  useEffect(() => {
    if (['home', 'courses'].includes(activeView) && !activeCourse) loadHome();
  }, [activeView, activeCourse]);
  useEffect(() => {
    if (activeView !== 'home' || activeCourse) return;
    const update = () => loadHome();
    window.addEventListener('study-activity-changed', update);
    return () => window.removeEventListener('study-activity-changed', update);
  }, [activeView, activeCourse, token]);
  useEffect(() => {
    if (activeView !== 'home' || activeCourse) return;
    let live = true;
    const timer = setInterval(
      () =>
        request('learning-home', { token })
          .then((data) => {
            if (live) {
              setHomeData(data);
              setHomeError('');
            }
          })
          .catch((e) => {
            if (live) setHomeError(e.message);
          }),
      30000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [activeView, activeCourse, token]);
  useEffect(() => {
    sessionStorage.setItem('math-auth-active-view', activeView);
    const saved = {
      'math-auth-active-view': activeView,
      'math-auth-active-course': activeCourse?.course?.id
        ? String(activeCourse.course.id)
        : sessionStorage.getItem('math-auth-active-course'),
      'math-auth-active-chapter': sessionStorage.getItem('math-auth-active-chapter'),
    };
    localStorage.setItem('math-auth-last-view:' + user.id, JSON.stringify(saved));
  }, [activeView, activeCourse]);
  useEffect(() => {
    if (activeCourse?.course?.id)
      sessionStorage.setItem('math-auth-active-course', String(activeCourse.course.id));
  }, [activeCourse]);
  useEffect(() => {
    const handleBrowserBack = (event) => {
      const state = event.state;
      setReviewTarget(state?.reviewTaskId || null);
      setSearchWrong(state?.searchWrongId || null);
      setActiveView(
        ['home', 'courses', 'assistant', 'wrong-review', 'plans', 'search'].includes(
          state?.mathAuthView,
        )
          ? state.mathAuthView
          : 'courses',
      );
      if (!state?.mathAuthView || state.mathAuthView !== 'course') {
        sessionStorage.removeItem('math-auth-active-course');
        setActiveCourse(null);
        return;
      }
      if (
        state.mathAuthView === 'course' &&
        Number(state.courseId) !== Number(activeCourse?.course?.id)
      ) {
        request(`courses/${state.courseId}`, { token })
          .then((data) => {
            setActiveCourse(data);
            setNavigationTarget(state.navigationTarget || { chapterId: state.chapterId });
          })
          .catch(() => {
            sessionStorage.removeItem('math-auth-active-course');
            setActiveCourse(null);
          });
      }
    };
    window.addEventListener('popstate', handleBrowserBack);
    return () => window.removeEventListener('popstate', handleBrowserBack);
  }, [activeCourse, token]);
  useEffect(() => {
    const savedCourseId = sessionStorage.getItem('math-auth-active-course');
    if (activeView !== 'courses' || activeCourse || !savedCourseId || !courses.length) return;
    request(`courses/${savedCourseId}`, { token })
      .then((data) => {
        setActiveCourse(data);
        setNavigationTarget(window.history.state?.navigationTarget || null);
        if (window.history.state?.mathAuthView !== 'course')
          window.history.pushState(
            { mathAuthView: 'course', courseId: data.course.id },
            '',
            window.location.href,
          );
      })
      .catch(() => sessionStorage.removeItem('math-auth-active-course'));
  }, [courses, activeView, activeCourse, token]);

  const createCourse = async (values) => {
    const { files, ...courseValues } = values;
    const data = await request('courses', { token, method: 'POST', body: courseValues });
    try {
      await uploadFiles(`courses/${data.course.id}/materials`, { token, files });
      setCreating(false);
      await loadCourses();
      await openCourse(data.course.id);
    } catch (reason) {
      await request(`courses/${data.course.id}`, { token, method: 'DELETE' });
      throw reason;
    }
  };

  const uploadMaterials = async (files) => {
    const data = await uploadFiles(`courses/${activeCourse.course.id}/materials`, { token, files });
    setActiveCourse((current) => ({
      ...current,
      materials: [...(current.materials || []), ...data.materials],
    }));
    await loadCourses();
  };

  const suggestChapters = (requirements) =>
    startGeneration({ kind: 'chapters', courseId: activeCourse.course.id, requirements });

  const applyDraft = async (chapters, replaceExisting) => {
    try {
      const data = await request(`courses/${activeCourse.course.id}/chapters/confirm-draft`, {
        token,
        method: 'POST',
        body: { chapters, replaceExisting },
      });
      setActiveCourse((current) => ({ ...current, chapters: data.chapters, chapterDrafts: [] }));
      await loadCourses();
    } catch (reason) {
      setError(reason.message);
    }
  };

  const confirmDraft = (chapters) => {
    const replaceExisting = activeCourse.chapters.length > 0;
    if (!replaceExisting) {
      applyDraft(chapters, replaceExisting);
      return;
    }
    setConfirmAction({
      eyebrow: '课程结构',
      title: '采用 AI 整理的目录？',
      message: '采用新目录会替换当前所有章节。',
      confirmText: '采用目录',
      danger: true,
      onConfirm: () => applyDraft(chapters, replaceExisting),
    });
  };

  const previewMaterial = async (material) => {
    try {
      return await request(`courses/${activeCourse.course.id}/materials/${material.id}`, { token });
    } catch (reason) {
      setError(reason.message);
      return null;
    }
  };

  const renameMaterial = async (material, nextName) => {
    const originalName = nextName || material.original_name;
    if (!originalName.trim()) return;
    try {
      const data = await request(`courses/${activeCourse.course.id}/materials/${material.id}`, {
        token,
        method: 'PUT',
        body: { originalName },
      });
      setActiveCourse((current) => ({
        ...current,
        materials: current.materials.map((item) =>
          item.id === material.id ? { ...item, original_name: data.material.original_name } : item,
        ),
      }));
    } catch (reason) {
      setError(reason.message);
    }
  };

  const deleteMaterial = (material) => {
    setConfirmAction({
      eyebrow: '资料管理',
      title: '删除资料？',
      message: `确定删除“${material.original_name}”吗？目录草稿也会清除。`,
      confirmText: '删除资料',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await request(
            `courses/${activeCourse.course.id}/materials/${material.id}`,
            { token, method: 'DELETE' },
          );
          setActiveCourse((current) => ({
            ...current,
            materials: current.materials.filter((item) => item.id !== material.id),
            chapterDrafts: [],
          }));
          if (result.cleanupFailed)
            setError('资料已删除，但原文件清理失败。请检查服务器对 E 盘资料目录的写入权限。');
        } catch (reason) {
          setError(reason.message);
        }
      },
    });
  };

  const openMaterialFile = async (material) => {
    try {
      const response = await fetch(
        `${api}courses/${activeCourse.course.id}/materials/${material.id}/file`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法打开原文件');
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      setError(reason.message);
    }
  };

  const openMaterialPreview = async (material) => {
    try {
      const response = await fetch(
        `${api}courses/${activeCourse.course.id}/materials/${material.id}/preview`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法生成原样预览');
      }
      const url = URL.createObjectURL(await response.blob());
      return { url, material };
    } catch (reason) {
      setError(reason.message);
    }
  };

  const updateCourse = async (values, targetCourseId = activeCourse?.course?.id) => {
    if (!targetCourseId) return;
    try {
      const data = await request(`courses/${targetCourseId}`, {
        token,
        method: 'PUT',
        body: values,
      });
      if (Number(activeCourse?.course?.id) === Number(targetCourseId)) {
        setActiveCourse((current) => ({ ...current, course: data.course }));
      }
      if (Number(shelfLibrary?.course?.id) === Number(targetCourseId)) {
        setShelfLibrary((current) => ({ ...current, course: data.course }));
      }
      await loadCourses();
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const deleteCourse = (targetCourse = activeCourse?.course) => {
    if (!targetCourse) return;
    setConfirmAction({
      eyebrow: '课程管理',
      title: '删除课程？',
      message: `确定删除“${targetCourse.title}”吗？其中的章节也会删除。`,
      confirmText: '删除课程',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await request(`courses/${targetCourse.id}`, { token, method: 'DELETE' });
          if (Number(activeCourse?.course?.id) === Number(targetCourse.id)) setActiveCourse(null);
          if (Number(shelfLibrary?.course?.id) === Number(targetCourse.id)) setShelfLibrary(null);
          await loadCourses();
          if (result.cleanupFailed)
            setError('课程已删除，但部分原文件清理失败。请检查服务器对 E 盘资料目录的写入权限。');
        } catch (reason) {
          setError(reason.message);
        }
      },
    });
  };

  const openShelfMaterials = async (course) => {
    try {
      const data = await request(`courses/${course.id}`, { token });
      setShelfLibrary(data);
    } catch (reason) {
      setError(reason.message);
    }
  };

  const addChapter = async (values) => {
    const data = await request(`courses/${activeCourse.course.id}/chapters`, {
      token,
      method: 'POST',
      body: values,
    });
    const chapters = [...activeCourse.chapters, data.chapter];
    const afterIndex = values.afterChapterId
      ? chapters.findIndex((item) => Number(item.id) === Number(values.afterChapterId)) + 1
      : 0;
    const createdIndex = chapters.findIndex((item) => item.id === data.chapter.id);
    chapters.splice(createdIndex, 1);
    chapters.splice(afterIndex, 0, data.chapter);
    await request(`courses/${activeCourse.course.id}/chapters/order`, {
      token,
      method: 'PUT',
      body: { chapterIds: chapters.map((chapter) => chapter.id) },
    });
    setActiveCourse((current) => ({ ...current, chapters }));
    await loadCourses();
  };

  const editChapter = async (chapter, title) => {
    try {
      const data = await request(`courses/${activeCourse.course.id}/chapters/${chapter.id}`, {
        token,
        method: 'PUT',
        body: { title, description: chapter.description || '' },
      });
      setActiveCourse((current) => ({
        ...current,
        chapters: current.chapters.map((item) => (item.id === chapter.id ? data.chapter : item)),
      }));
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const deleteChapter = (chapter) => {
    setConfirmAction({
      eyebrow: '章节管理',
      title: '删除章节？',
      message: `确定删除“${chapter.title}”吗？`,
      confirmText: '删除章节',
      danger: true,
      onConfirm: async () => {
        try {
          await request(`courses/${activeCourse.course.id}/chapters/${chapter.id}`, {
            token,
            method: 'DELETE',
          });
          setActiveCourse((current) => ({
            ...current,
            chapters: current.chapters.filter((item) => item.id !== chapter.id),
          }));
          await loadCourses();
        } catch (reason) {
          setError(reason.message);
        }
      },
    });
  };

  const moveChapter = async (chapterId, direction) => {
    const chapters = [...activeCourse.chapters];
    const index = chapters.findIndex((chapter) => chapter.id === chapterId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= chapters.length) return;
    [chapters[index], chapters[nextIndex]] = [chapters[nextIndex], chapters[index]];
    try {
      await request(`courses/${activeCourse.course.id}/chapters/order`, {
        token,
        method: 'PUT',
        body: { chapterIds: chapters.map((chapter) => chapter.id) },
      });
      setActiveCourse((current) => ({ ...current, chapters }));
    } catch (reason) {
      setError(reason.message);
    }
  };

  const loadChapterContent = async (chapter) => {
    try {
      return await request(`courses/${activeCourse.course.id}/chapters/${chapter.id}/content`, {
        token,
      });
    } catch (reason) {
      setError(reason.message);
      return null;
    }
  };

  const generateChapterSummary = (chapterId, requirements = '') =>
    startGeneration({ kind: 'summary', courseId: activeCourse.course.id, chapterId, requirements });
  const generatePractice = (chapterId, chapterTitle, settings) =>
    startGeneration({ kind: 'practice', courseId: activeCourse.course.id, chapterId, settings });

  const generateQuestions = async (chapterId, settings) => {
    try {
      const data = await request(`courses/${activeCourse.course.id}/questions/generate`, {
        token,
        method: 'POST',
        body: { chapterId, ...settings },
      });
      if (settings.persist !== false)
        setActiveCourse((current) => ({
          ...current,
          questionDrafts: [
            ...(current.questionDrafts || []).filter(
              (item) => Number(item.chapterId) !== Number(chapterId),
            ),
            { chapterId, settings: data.settings, questions: data.questions },
          ],
        }));
      return data;
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const saveQuestionDraft = async (chapterId, settings, questions) => {
    try {
      await request(`courses/${activeCourse.course.id}/chapters/${chapterId}/question-draft`, {
        token,
        method: 'PUT',
        body: { settings, questions },
      });
      setActiveCourse((current) => ({
        ...current,
        questionDrafts: [
          ...(current.questionDrafts || []).filter(
            (item) => Number(item.chapterId) !== Number(chapterId),
          ),
          { chapterId, settings, questions },
        ],
      }));
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const savePractice = async (chapterId, title, questions) => {
    try {
      const data = await request(
        `courses/${activeCourse.course.id}/chapters/${chapterId}/practices`,
        { token, method: 'POST', body: { title, questions } },
      );
      setActiveCourse((current) => ({
        ...current,
        practices: [data.practice, ...(current.practices || [])],
        questionDrafts: (current.questionDrafts || []).filter(
          (item) => Number(item.chapterId) !== Number(chapterId),
        ),
      }));
      return data.practice;
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const savePracticeAttempt = async (practice, answers) => {
    try {
      const correctCount = answers.filter((item) => item.correct).length;
      const totalCount = practice.questions?.length || answers.length;
      const requestKey = `math-auth-attempt-request:${user.id}:${practice.id}`;
      const requestId = pendingAttempt(sessionStorage, requestKey, answers, () =>
        crypto.randomUUID(),
      );
      const data = await request(
        `courses/${activeCourse.course.id}/practices/${practice.id}/attempts`,
        { token, method: 'POST', body: { answers, correctCount, totalCount, requestId } },
      );
      sessionStorage.removeItem(requestKey);
      setActiveCourse((current) => ({
        ...current,
        practices: (current.practices || []).map((item) =>
          Number(item.id) === Number(practice.id)
            ? {
                ...item,
                attempt_count:
                  Number(item.attempt_count || 0) +
                  (Number(item.latest_attempt?.id) === Number(data.attempt.id) ? 0 : 1),
                latest_attempt: data.attempt,
                in_progress: null,
              }
            : item,
        ),
      }));
      return data.attempt;
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const savePracticeProgress = async (practice, answers) => {
    await request(`courses/${practice.course_id}/practices/${practice.id}/progress`, {
      token,
      method: 'PUT',
      body: { answers },
    });
    setActiveCourse((current) =>
      Number(current?.course?.id) === Number(practice.course_id)
        ? {
            ...current,
            practices: (current.practices || []).map((item) =>
              Number(item.id) === Number(practice.id)
                ? {
                    ...item,
                    in_progress: Object.keys(answers).length
                      ? { answers, updated_at: new Date().toISOString() }
                      : null,
                  }
                : item,
            ),
          }
        : current,
    );
  };

  const visitChapter = async (chapterId) => {
    const courseId = activeCourse?.course?.id;
    if (!courseId) return;
    try {
      await request('learning-progress', { token, method: 'POST', body: { courseId, chapterId } });
      sessionStorage.setItem('math-auth-active-chapter', String(chapterId));
    } catch (reason) {
      setError(`学习位置保存失败：${reason.message}`);
    }
  };

  const deletePractice = async (practice) => {
    try {
      await request(`courses/${activeCourse.course.id}/practices/${practice.id}`, {
        token,
        method: 'DELETE',
      });
      localStorage.removeItem(`math-auth-draft-${user.id}-${practice.id}`);
      setActiveCourse((current) => ({
        ...current,
        practices: (current.practices || []).filter(
          (item) => Number(item.id) !== Number(practice.id),
        ),
      }));
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const discardQuestionDraft = async (chapterId) => {
    try {
      await request(`courses/${activeCourse.course.id}/chapters/${chapterId}/question-draft`, {
        token,
        method: 'DELETE',
      });
      setActiveCourse((current) => ({
        ...current,
        questionDrafts: (current.questionDrafts || []).filter(
          (item) => Number(item.chapterId) !== Number(chapterId),
        ),
      }));
    } catch (reason) {
      setError(reason.message);
      throw reason;
    }
  };

  const setChapterProgress = async (chapter, completed) => {
    await request(`courses/${activeCourse.course.id}/chapters/${chapter.id}/progress`, {
      token,
      method: 'PATCH',
      body: { completed },
    });
    const data = await request(`courses/${activeCourse.course.id}`, { token });
    setActiveCourse(data);
    const list = await request('courses', { token });
    setCourses(list.courses);
    await learningPlans.reload();
  };
  return (
    <div className="learning-layout student-top-layout">
      <aside className="sidebar student-topbar">
        <Brand compact />

        <nav>
          <button
            className={activeView === 'home' && !activeCourse ? 'nav-active' : ''}
            onClick={() => showView('home')}
          >
            <span className="nav-idx">壹</span>
            <span>学习首页</span>
          </button>
          <button
            className={activeView === 'courses' ? 'nav-active' : ''}
            onClick={() => showView('courses')}
          >
            <span className="nav-idx">贰</span>
            <span>我的课程</span>
          </button>
          <button
            className={activeView === 'assistant' ? 'nav-active' : ''}
            onClick={() => showView('assistant')}
          >
            <span className="nav-idx">叁</span>
            <span>AI 助手</span>
          </button>
          <button
            className={activeView === 'wrong-review' ? 'nav-active' : ''}
            onClick={() => showView('wrong-review')}
          >
            <span className="nav-idx">肆</span>
            <span>错题复习</span>
          </button>
          <button
            className={activeView === 'plans' ? 'nav-active' : ''}
            onClick={() => showView('plans')}
          >
            <span className="nav-idx">伍</span>
            <span>学习计划</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className="student-search"
            aria-label="搜索学习内容"
            onClick={() => showView('search')}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          </button>
          <AccountEntry
            user={user}
            onProfile={() => setAccountDialog('profile')}
            onSettings={() => setAccountDialog('settings')}
          />
        </div>
      </aside>
      <main className="workspace course-workspace">
        {activeView === 'home' && !activeCourse && <AnnouncementBanner placement="home" />}
        {activeView !== 'search' && !activeCourse && (
          <div className="workspace-search-entry">
            <span className="workspace-top-title">
              {
                {
                  home: '学习首页',
                  courses: '我的课程',
                  assistant: 'AI 学习助手',
                  'wrong-review': '错题复习',
                  plans: '学习计划',
                }[activeView]
              }
            </span>
            <button
              type="button"
              className={activeView === 'search' ? 'search-entry-active' : ''}
              onClick={() => showView('search')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <span>搜索学习内容</span>
            </button>
          </div>
        )}
        {error && (
          <div
            className={`toast ${error.startsWith('暂未从资料中定位到本章内容') ? 'toast-temporary' : ''}`}
            role="alert"
          >
            <span>!</span>
            {error}
            <button type="button" aria-label="关闭提示" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {aiNotice && (
          <div className="ai-job-notice" role="status">
            {aiNotice}
          </div>
        )}
        <div className="background-tasks">
          {aiJobs.length > 0 && (
            <details className="generation-tray">
              <summary>
                生成任务 · {aiJobs.length}
                <span role="status">
                  {aiJobs.some((job) => ['running', 'saving'].includes(job.status))
                    ? '正在生成'
                    : aiJobs.some((job) => job.status !== 'done')
                      ? '需要处理'
                      : '已完成'}
                </span>
              </summary>
              {aiJobs.map((job) => (
                <div key={job.id}>
                  <div>
                    <strong>
                      {
                        { chapters: '章节目录', summary: '章节总结', practice: '章节练习' }[
                          job.kind
                        ]
                      }
                    </strong>
                    <span role="status">
                      {job.status === 'running'
                        ? job.progress_text || '正在生成'
                        : job.status === 'saving'
                          ? '正在保存'
                          : job.status === 'done'
                            ? '已完成'
                            : job.error_text || '生成失败'}
                    </span>
                  </div>
                  {job.status === 'running' ? (
                    <button onClick={() => actOnGeneration(job, 'cancel')}>取消</button>
                  ) : job.status === 'saving' ? null : (
                    <>
                      {job.status === 'done' ? (
                        <button
                          onClick={() =>
                            openCourse(
                              job.course_id,
                              job.chapter_id
                                ? {
                                    chapterId: job.chapter_id,
                                    tab: job.kind === 'practice' ? 'practice' : 'summary',
                                  }
                                : undefined,
                            )
                          }
                        >
                          查看结果
                        </button>
                      ) : (
                        <>
                          <button onClick={() => actOnGeneration(job, 'retry')}>重试</button>
                          {job.chapter_id && job.error_text?.includes('未识别的公式') && (
                            <button
                              onClick={() =>
                                openCourse(job.course_id, {
                                  chapterId: job.chapter_id,
                                  tab: 'materials',
                                })
                              }
                            >
                              修正资料
                            </button>
                          )}
                        </>
                      )}
                      <button
                        aria-label="关闭生成任务"
                        onClick={() => actOnGeneration(job, 'dismiss')}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}
            </details>
          )}
          {activeView !== 'plans' && (
            <PlanTaskTray data={learningPlans.data} onOpen={() => showView('plans')} />
          )}
          <NoteTaskTray
            token={token}
            onFix={(courseId, chapterId) => openCourse(courseId, { chapterId, tab: 'materials' })}
            onOpen={(courseId, chapterId) => openCourse(courseId, { chapterId, notes: true })}
          />
        </div>
        {activeView === 'search' ? (
          <Search
            token={token}
            userId={user.id}
            courses={courses}
            onOpen={openSearchResult}
            onBack={() => {
              if (window.history.state?.searchCanGoBack) window.history.back();
              else showView('courses');
            }}
          />
        ) : activeView === 'plans' ? (
          <LearningPlanPanel
            token={token}
            courses={courses}
            {...learningPlans}
            onOpenTask={openCourse}
          />
        ) : activeView === 'wrong-review' ? (
          <WrongReview
            key={reviewTarget || searchWrong || 'list'}
            wrongQuestionId={searchWrong}
            token={token}
            scheduleId={reviewTarget}
            onOpenSchedule={openScheduledReview}
            onCloseSchedule={() => {
              sessionStorage.setItem('math-auth-review-panel', 'schedule');
              showView('wrong-review');
            }}
          />
        ) : activeView === 'assistant' ? (
          <AssistantLanding
            user={user}
            onOpenCourse={openCourse}
            onOpenNotes={(courseId, chapterId) => openCourse(courseId, { chapterId, notes: true })}
            courses={courses}
            token={token}
            onCourses={() => showView('courses')}
          />
        ) : activeCourse ? (
          <CourseDetail
            token={token}
            key={`${activeCourse.course.id}-${navigationTarget?.practiceId || ''}-${navigationTarget?.attempt?.id || ''}-${navigationTarget?.chapterId || ''}-${navigationTarget?.tab || ''}`}
            onSetChapterProgress={setChapterProgress}
            courseData={activeCourse}
            navigationTarget={navigationTarget}
            userId={user.id}
            onVisitChapter={visitChapter}
            onSavePracticeProgress={savePracticeProgress}
            onBack={() => {
              if (window.history.state?.mathAuthView === 'course') window.history.back();
              else {
                sessionStorage.removeItem('math-auth-active-course');
                setActiveCourse(null);
              }
            }}
            onUpdate={() =>
              setNameEditor({
                kind: 'course',
                courseId: activeCourse.course.id,
                title: activeCourse.course.title,
                description: activeCourse.course.description || '',
              })
            }
            onDelete={() => deleteCourse(activeCourse.course)}
            onAddChapter={addChapter}
            onEditChapter={(chapter) =>
              setNameEditor({ kind: 'chapter', chapter, title: chapter.title })
            }
            onDeleteChapter={deleteChapter}
            onMoveChapter={moveChapter}
            onLoadChapterContent={loadChapterContent}
            onGenerateChapterSummary={generateChapterSummary}
            onGeneratePractice={generatePractice}
            onSavePracticeAttempt={savePracticeAttempt}
            onDeletePractice={deletePractice}
            onUploadMaterials={uploadMaterials}
            onSuggestChapters={suggestChapters}
            onConfirmDraft={confirmDraft}
            onPreviewMaterial={previewMaterial}
            onRenameMaterial={renameMaterial}
            onDeleteMaterial={deleteMaterial}
            onOpenMaterialPreview={openMaterialPreview}
            onOpenMaterialFile={openMaterialFile}
            onAskAssistant={(course, chapter, excerpt) => {
              const key = `scholar-assistant:${user.id}`;
              sessionStorage.setItem(`${key}:course`, String(course.id));
              sessionStorage.setItem(
                `${key}:target-chapter:${course.id}`,
                String(chapter?.id || ''),
              );
              if (excerpt)
                sessionStorage.setItem(
                  `${key}:new-draft:${course.id}`,
                  `关于《${chapter?.title || course.title}》中的这段内容：\n> ${excerpt}\n\n请帮我详细讲解一下：`,
                );
              showView('assistant');
            }}
          />
        ) : activeView === 'home' ? (
          <LearningOverview
            token={token}
            user={user}
            data={homeData}
            loading={homeLoading || loading}
            error={homeError}
            onRetry={loadHome}
            courses={courses}
            onCourses={() => showView('courses')}
            onCreate={() => setCreating(true)}
            onOpenCourse={openCourse}
            onOpenWrong={() => {
              sessionStorage.setItem('math-auth-review-panel', 'questions');
              showView('wrong-review');
            }}
            onOpenHistory={openHistory}
            tasks={
              <>
                <LearningPlanPanel
                  compact
                  token={token}
                  courses={courses}
                  {...learningPlans}
                  onOpenTask={openCourse}
                  onAll={() => showView('plans')}
                />
                <ReviewSchedulePanel
                  compact
                  token={token}
                  onOpen={openScheduledReview}
                  onAll={() => {
                    sessionStorage.setItem('math-auth-review-panel', 'schedule');
                    sessionStorage.setItem('math-auth-review-due-only', 'true');
                    showView('wrong-review');
                  }}
                />
              </>
            }
          />
        ) : (
          <CourseShelf
            token={token}
            courses={courses}
            loading={loading}
            recent={homeData?.recent}
            onOpen={(course, options) => openCourse(course.id, options)}
            onCreate={(files) => setCreating(Array.isArray(files) && files.length ? files : true)}
            onPlan={(course) => {
              sessionStorage.setItem('math-auth-plan-course', String(course.id));
              showView('plans');
            }}
            onMaterials={openShelfMaterials}
            onEdit={(course) =>
              setNameEditor({
                kind: 'course',
                courseId: course.id,
                title: course.title,
                description: course.description || '',
              })
            }
            onDelete={(course) => deleteCourse(course)}
          />
        )}
      </main>
      {accountDialog && (
        <AccountPanel
          {...account}
          kind={accountDialog}
          token={token}
          user={user}
          onUser={onUser}
          onPreferences={(value) => onAccount((current) => ({ ...current, ...value }))}
          onClose={() => setAccountDialog(null)}
          onLogout={logout}
          onReload={onReloadAccount}
        />
      )}
      {creating && (
        <CourseForm
          title="添加课程"
          submitLabel="创建课程"
          initialFiles={Array.isArray(creating) ? creating : []}
          onClose={() => setCreating(false)}
          onSubmit={createCourse}
        />
      )}
      {nameEditor && (
        <NameEditor
          editor={nameEditor}
          onClose={() => setNameEditor(null)}
          onSave={async (values) => {
            if (nameEditor.kind === 'course') await updateCourse(values, nameEditor.courseId);
            else await editChapter(nameEditor.chapter, values.title);
            setNameEditor(null);
          }}
        />
      )}
      {shelfLibrary && (
        <ShelfLibraryModal
          token={token}
          courseData={shelfLibrary}
          onChange={setShelfLibrary}
          onClose={() => setShelfLibrary(null)}
          onReloadCourses={loadCourses}
          onReadMaterial={(material) => {
            const cId = shelfLibrary.course.id;
            setShelfLibrary(null);
            openCourse(cId, { materialId: material.id });
          }}
          onConfirmDelete={setConfirmAction}
          onError={setError}
        />
      )}
      {confirmAction && (
        <ConfirmModal action={confirmAction} onClose={() => setConfirmAction(null)} />
      )}
    </div>
  );
}
