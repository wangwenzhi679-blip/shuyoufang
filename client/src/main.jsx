import AdminStartup from './AdminStartup.jsx';
import AuthScreen from './AuthScreen.jsx';
import {
  ConfirmModal,
  NameEditor,
  AddChapterModal,
  RenameMaterialModal,
} from './CourseDialogs.jsx';
import { requestJson, requestJson as request } from './api-client.mjs';
import { API_ROOT } from './api-base.mjs';
import PaperDialog from './PaperDialog.jsx';
import AssistantReading from './AssistantReading.jsx';

import { startChapterIllustration } from './ChapterIllustration.jsx';
import AccountPanel, { AccountEntry, accountRequest } from './AccountPanel.jsx';
import {
  applyPreferences,
  activePreferences,
  listenPreferences,
  registerAccountGuard,
  saveBeforeAccountChange,
} from './account-state.js';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import {
  questionTypeLabel,
  optionLetter,
  answerLetters,
  selectionLetters,
} from '../../shared/question-types.mjs';
import ChapterSourceEditor from './ChapterSourceEditor';
import { formatDate, formatDateTime } from './date-format.mjs';
import { pendingAttempt } from './attempt-request.mjs';
import LearningOverview from './LearningOverview';
import Search from './Search';
import { ReviewSchedulePanel } from './ReviewSchedules';
import { ReadingArea, PagedMaterialReader, readingApi } from './Reading';
import LearningPlanPanel, { useLearningPlans, PlanTaskTray } from './LearningPlans';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import WrongReview from './WrongReview';
import { LearningNotes, NoteExcerpt } from './LearningNotes';
import { NoteTaskTray } from './NoteJobs';
import { splitImportedContent } from './imported-content.mjs';
import './editorial-theme.css';
import './account.css';

import './ink-cover.css';
import './atelier-theme.css';
import './home-refinement.css';
import CourseShelf from './CourseShelf.jsx';
import CourseForm from './CourseForm.jsx';
import AssistantDesk from './AssistantDesk.jsx';
import AtelierBamboo from './AtelierBamboo.jsx';
import './student-dialogs.css';

const api = `${API_ROOT}/`;

async function uploadFiles(path, { token, files }) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return requestJson(path, { token, method: 'POST', body: form, errorMessage: '资料上传失败' });
}

function loadSavedUser() {
  try {
    const savedUser = JSON.parse(localStorage.user || 'null');
    if (savedUser) {
      delete savedUser.grade;
      localStorage.user = JSON.stringify(savedUser);
    }
    return savedUser;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

function renderInlineMarkdown(text) {
  if (!text) return '';
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={match.index} className="inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

function AssistantAnswer({ content }) {
  return <AssistantReading content={content} />;
}

function App() {
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState('');
  const [token, setToken] = useState(localStorage.token || '');
  const [user, setUser] = useState(loadSavedUser);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.token));
  const [pendingEmail, setPendingEmail] = useState('');

  const clearSession = (message = '', preserveOtherLogin = false) => {
    if (!preserveOtherLogin) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    sessionStorage.removeItem('math-auth-active-view');
    sessionStorage.removeItem('math-auth-active-course');
    sessionStorage.removeItem('math-auth-active-chapter');
    setToken('');
    setUser(null);
    setDashboard(null);
    setMode('login');
    setMessage(message);
    sessionStorage.removeItem('math-auth-view-owner');
    applyPreferences({});
    window.history.replaceState({}, '', window.location.pathname);
  };
  const logout = async (mode = 'logout', alreadyRevoked = false, message = '') => {
    if (!alreadyRevoked) {
      try {
        await request('auth/logout', { token, method: 'POST' });
      } catch (e) {
        if (e.message !== '请先登录') throw e;
      }
    }
    clearSession(message || (mode === 'switch' ? '请登录其他账号' : ''));
  };
  useEffect(() => {
    const sync = (e) => {
      if (e.key === 'token' && e.newValue !== token)
        clearSession('登录状态已变化，请重新登录', Boolean(e.newValue));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [token]);
  const updateUser = (value) => {
    setUser(value);
    setDashboard(value);
    localStorage.user = JSON.stringify(value);
  };
  const loadDashboard = async (activeToken) => {
    setLoading(true);
    try {
      const data = await request('auth/me', { token: activeToken });
      setDashboard(data);
      setUser(data);
      localStorage.user = JSON.stringify(data);
    } catch (error) {
      if (error.message === '请先登录') clearSession();
      else setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (token) loadDashboard(token);
  }, []);

  const submitAuth = async (values) => {
    if (mode === 'login') {
      const data = await request('auth/login', { method: 'POST', body: values });
      localStorage.token = data.token;
      localStorage.user = JSON.stringify(data.user);
      setToken(data.token);
      setUser(data.user);
      setMessage('登录成功，正在打开你的学习空间。');
      await loadDashboard(data.token);
      return;
    }
    if (mode === 'register') {
      const { confirmPassword, ...registerData } = values;
      if (registerData.password !== confirmPassword) throw new Error('两次输入的密码不一致');
      const data = await request('auth/register', { method: 'POST', body: registerData });
      setPendingEmail(data.email);
      setMode('verify');
      setMessage('验证码已发送，请到邮箱查收。');
      return;
    }
    if (mode === 'verify') {
      await request('auth/verify-email', {
        method: 'POST',
        body: { email: values.email || pendingEmail, code: values.code },
      });
      setMode('login');
      setMessage('邮箱验证成功，请使用账号密码登录。');
      return;
    }
    if (mode === 'loginCodeRequest') {
      await request('auth/send-login-code', { method: 'POST', body: { email: values.email } });
      setPendingEmail(values.email);
      setMode('loginCode');
      setMessage('验证码已发送，请查看邮箱。');
      return;
    }
    if (mode === 'loginCode') {
      const data = await request('auth/login-code', {
        method: 'POST',
        body: { email: values.email || pendingEmail, code: values.code },
      });
      localStorage.token = data.token;
      localStorage.user = JSON.stringify(data.user);
      setToken(data.token);
      setUser(data.user);
      setMessage('登录成功，正在打开你的学习空间。');
      await loadDashboard(data.token);
      return;
    }
    if (mode === 'forgot') {
      await request('auth/forgot-password', { method: 'POST', body: { email: values.email } });
      setPendingEmail(values.email);
      setMode('reset');
      setMessage('如果邮箱已绑定并完成验证，验证码已发送。');
      return;
    }
    if (values.password !== values.confirmPassword) throw new Error('两次输入的密码不一致');
    await request('auth/reset-password', {
      method: 'POST',
      body: { email: values.email || pendingEmail, code: values.code, password: values.password },
    });
    setMode('login');
    setMessage('密码已重置，请登录。');
  };

  const requestLoginCode = async (email) => {
    if (!email) throw new Error('请先填写邮箱');
    await request('auth/send-login-code', { method: 'POST', body: { email } });
    setPendingEmail(email);
    setMessage('验证码已发送，请查看邮箱。');
  };

  if (token && loading && !dashboard)
    return (
      <div className="loading-screen">
        <span>Σ</span>
        <p>正在打开学习空间…</p>
      </div>
    );
  if (user && dashboard)
    return <AccountWorkspace token={token} user={user} logout={logout} onUser={updateUser} />;
  return (
    <>
      <AnnouncementBanner placement="login" />
      <AuthScreen
        mode={mode}
        pendingEmail={pendingEmail}
        setMode={(next) => {
          setMode(next);
          setMessage('');
        }}
        message={message}
        submit={submitAuth}
        requestLoginCode={requestLoginCode}
      />
    </>
  );
}

function AccountWorkspace({ token, user, logout, onUser }) {
  const [account, setAccount] = useState(null),
    [error, setError] = useState('');
  const load = async () => {
    const data = await accountRequest(token);
    setAccount(data);
    applyPreferences(data.preferences);
    onUser(data.user);
    return data;
  };
  useEffect(() => {
    let live = true;
    accountRequest(token)
      .then((data) => {
        if (live) {
          setAccount(data);
          applyPreferences(data.preferences);
          onUser(data.user);
          const owner = sessionStorage.getItem('math-auth-view-owner');
          if (owner !== String(user.id)) {
            for (const key of [
              'math-auth-active-view',
              'math-auth-active-course',
              'math-auth-active-chapter',
              'math-auth-page-scroll',
            ])
              sessionStorage.removeItem(key);
            const saved = localStorage.getItem('math-auth-last-view:' + user.id);
            if (data.preferences.startPage === 'last' && saved) {
              try {
                const value = JSON.parse(saved);
                for (const [key, item] of Object.entries(value))
                  if (item) sessionStorage.setItem(key, item);
              } catch {}
            }
            sessionStorage.setItem('math-auth-view-owner', String(user.id));
            window.history.replaceState(
              { mathAuthView: sessionStorage.getItem('math-auth-active-view') || 'home' },
              '',
              window.location.href,
            );
          }
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const media = matchMedia('(prefers-color-scheme:dark)'),
      change = () => applyPreferences(activePreferences);
    media.addEventListener('change', change);
    return () => {
      live = false;
      media.removeEventListener('change', change);
    };
  }, [token]);
  if (!account)
    return (
      <div className="loading-screen">
        <p>{error || '正在加载个人设置…'}</p>
        {error && (
          <>
            <button onClick={() => load().catch((e) => setError(e.message))}>重试</button>
            <button onClick={() => logout('logout', true)}>返回登录</button>
          </>
        )}
      </div>
    );
  return (
    <CourseWorkspace
      key={user.id}
      token={token}
      user={user}
      logout={logout}
      onUser={onUser}
      account={account}
      onAccount={setAccount}
      onReloadAccount={load}
    />
  );
}

function CourseWorkspace({ token, user, logout, onUser, account, onAccount, onReloadAccount }) {
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

function ShelfLibraryModal({
  token,
  courseData,
  onChange,
  onClose,
  onReloadCourses,
  onReadMaterial,
  onConfirmDelete,
  onError,
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const cId = courseData.course.id;
  const upload = async (files) => {
    const data = await uploadFiles(`courses/${cId}/materials`, { token, files });
    onChange((current) =>
      current
        ? { ...current, materials: [...(current.materials || []), ...data.materials] }
        : current,
    );
    await onReloadCourses();
  };
  const previewText = async (material) => {
    try {
      const data = await request(`courses/${cId}/materials/${material.id}`, { token });
      if (data?.material) setPreview(data.material);
    } catch (reason) {
      onError(reason.message);
    }
  };
  const downloadFile = async (material) => {
    try {
      const response = await fetch(`${api}courses/${cId}/materials/${material.id}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法打开原文件');
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      onError(reason.message);
    }
  };
  const saveRename = async (material, originalName) => {
    try {
      const data = await request(`courses/${cId}/materials/${material.id}`, {
        token,
        method: 'PUT',
        body: { originalName },
      });
      onChange((current) =>
        current
          ? {
              ...current,
              materials: current.materials.map((item) =>
                item.id === material.id
                  ? { ...item, original_name: data.material.original_name }
                  : item,
              ),
            }
          : current,
      );
    } catch (reason) {
      onError(reason.message);
    }
  };
  const removeMaterial = (material) => {
    onConfirmDelete({
      eyebrow: '资料管理',
      title: '删除资料？',
      message: `确定删除“${material.original_name}”吗？目录草稿也会清除。`,
      confirmText: '删除资料',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await request(`courses/${cId}/materials/${material.id}`, {
            token,
            method: 'DELETE',
          });
          onChange((current) =>
            current
              ? {
                  ...current,
                  materials: current.materials.filter((item) => item.id !== material.id),
                }
              : current,
          );
          await onReloadCourses();
          if (result.cleanupFailed)
            onError('资料已删除，但原文件清理失败。请检查服务器对 E 盘资料目录的写入权限。');
        } catch (reason) {
          onError(reason.message);
        }
      },
    });
  };
  return (
    <>
      <div className="modal-backdrop library-overlay">
        <PaperDialog busy={uploading} onDismiss={onClose} className="library-dialog">
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
              onClick={onClose}
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
                      await upload(files);
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
                      <button className="library-read" onClick={() => onReadMaterial(material)}>
                        阅读
                      </button>
                      <button onClick={() => previewText(material)}>文字</button>
                      <button onClick={() => downloadFile(material)}>下载</button>
                      <button onClick={() => setRenameTarget(material)}>改名</button>
                      <button className="library-delete" onClick={() => removeMaterial(material)}>
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
      {renameTarget && (
        <RenameMaterialModal
          material={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={saveRename}
        />
      )}
      {preview && (
        <div className="modal-backdrop">
          <PaperDialog
            busy={uploading}
            onDismiss={() => setPreview(null)}
            className="record-modal material-preview"
          >
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
    </>
  );
}

function AssistantLanding(props) {
  return <AssistantDesk {...props} Answer={AssistantAnswer} request={request} />;
}
function OriginalPdfPage({ courseId, materialId, page, onReadOriginal }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setError('');
    setUrl('');
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
  }, [courseId, materialId, page, retry]);
  return (
    <figure className="original-pdf-page">
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
          alt={`原资料第 ${page} 页，保留公式和矩阵排版`}
          onError={() => setError('原页暂时无法显示，请重试或阅读原文。')}
        />
      ) : (
        <p>正在加载原页…</p>
      )}
    </figure>
  );
}

function ChapterMaterialContent({ section, courseId, onReadOriginal }) {
  if (!section.originalRequired) return <ImportedContent content={section.content} />;
  return (
    <div className="original-chapter-content">
      <div className="original-page-notice">
        <span>部分公式或符号未能完整提取，请以原资料为准。</span>
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

function MaterialNoteExcerpt({ token, course, chapter, section, onView }) {
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

function ImportedContent({ content }) {
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

const practiceTypes = ['单选题', '多选题', '判断题', '填空题', '简答题'];

function PracticePanel({ chapter, practices, onGenerate, onStart, onDeletePractice }) {
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

function PracticeAnswering({
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
                <div className="answer-options">
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
                        onClick={() => choose(question, index, option, optionIndex)}
                      >
                        <b>{letter}</b>
                        <span>{String(option).replace(/^[A-Z][、.．:：\s]*/i, '')}</span>
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

const practiceTemplates = [
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

function QuestionSettingsModal({ chapter, onClose, onGenerate }) {
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

function QuestionPreviewModal({ data, onClose, onSaveDraft, onSavePractice, onRegenerateOne }) {
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

function QuestionEditor({
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

function PracticeRemovalModal({ removal, onClose, onConfirm }) {
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

function ChapterDraftPreviewModal({ chapters, onClose, onAdopt }) {
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
              采用目录会替换原有章节，新章节从未完成开始，原章节的完成标记不会继承。请先确认内容。
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

function ChapterSummaryPanel({
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

function ChapterSuggestModal({ onClose, onSuggest }) {
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

function CourseDetail({
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
                                {section.materialName} · {section.corrected ? '已修正' : '原始提取'}
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

function Brand({ compact = false }) {
  return (
    <div className="brand brand-editorial">
      <span className="brand-logo-editorial">{compact ? '数有方' : '数有方·'}</span>
      <span className="brand-badge-editorial">研习空间</span>
    </div>
  );
}

const AdminApp = React.lazy(() => import('./AdminApp.jsx'));
const isAdminPage = /^\/admin(?:\/|$)/.test(window.location.pathname);
createRoot(document.getElementById('root')).render(
  isAdminPage ? (
    <React.Suspense fallback={<AdminStartup />}>
      <AdminApp />
    </React.Suspense>
  ) : (
    <App />
  ),
);
