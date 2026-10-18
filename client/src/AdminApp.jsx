import AdminStartup from './AdminStartup.jsx';
import AdminUserAction from './AdminUserAction.jsx';
import { API_ROOT } from './api-base.mjs';
import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import AdminContentDetail from './AdminContentDetail.jsx';
import AccountPanel, { AccountEntry, accountRequest } from './AccountPanel.jsx';
import { applyPreferences } from './account-state.js';
import { defaultPreferences } from '../../shared/account-preferences.mjs';
import AdminBackups from './AdminBackups.jsx';
import AdminLimits from './AdminLimits.jsx';
import AdminTaskDetail from './AdminTaskDetail.jsx';
import AdminContentAction from './AdminContentAction.jsx';
import AdminPassword from './AdminPassword.jsx';
import React, { useEffect, useState } from 'react';
import { formatDateTime } from './date-format.mjs';
import './admin.css';
import './admin-extra.css';
import Announcements from './Announcements.jsx';
import DateRange from './DateRange.jsx';
import Services from './Services.jsx';
import './services.css';
import './editorial-theme.css';
import AdminInkLogin from './AdminInkLogin.jsx';
import './atelier-theme.css';
import './admin-refinement.css';
import './admin-detail-polish.css';

const pages = {
  overview: '管理首页',
  users: '用户管理',
  courses: '课程查询',
  materials: '资料查询',
  jobs: 'AI 任务',
  announcements: '公告管理',
  services: '服务状态',
  limits: '运行设置',
  backups: '数据备份',
  logs: '操作日志',
};
const taskNames = {
  chapters: '章节目录',
  summary: '章节总结',
  practice: '智能出题',
  notes: '学习笔记',
  plan: '学习计划',
};
const stateNames = {
  running: '生成中',
  saving: '保存中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
  adopted: '已采用',
};
const actions = {
  backup_delete: '清理备份',
  cover_upload: '上传课程封面',
  cover_template: '恢复排版封面',
  cover_generate: '生成课程封面',
  cover_adopt: '采用课程封面',
  cover_discard: '保留课程封面',
  image_generate: '重新生成配图',
  image_adopt: '采用章节配图',
  image_discard: '保留原配图',
  backup_download: '下载备份',
  backup_create: '创建备份',
  backup_verify: '验证恢复',
  runtime_config: '修改运行设置',
  course_pause: '暂停课程',
  course_restore: '恢复课程',
  material_pause: '暂停资料',
  material_restore: '恢复资料',
  preview_repair: '修复预览',
  password_change: '修改管理员密码',
  task_cancel: '取消任务',
  task_retry: '重试任务',
  service_delete: '删除 API 配置',
  service_config: '更新服务配置',
  service_check: '服务检查',
  login: '管理登录',
  user_login: '学习端登录',
  logout: '退出登录',
  user_disable: '停用用户',
  user_cancel: '注销用户',
  user_restore: '恢复用户',
  user_status: '修改账户状态',
};
Object.assign(actions, {
  announcement_create: '新建公告',
  announcement_edit: '编辑公告',
  announcement_publish: '发布公告',
  announcement_withdraw: '下架公告',
  announcement_delete: '删除公告',
  announcement_restore: '恢复公告',
});
const logResults = {
  success: { label: '成功', tone: 'good' },
  failed: { label: '失败', tone: 'bad' },
  running: { label: '进行中', tone: 'neutral' },
  accepted: { label: '已受理', tone: 'neutral' },
};
const emptyFilters = {
  owner: '',
  q: '',
  status: '',
  kind: '',
  role: '',
  from: '',
  to: '',
  issue: '',
  action: '',
  result: '',
};
const bytes = (value) =>
  Number(value) >= 1048576
    ? `${(Number(value) / 1048576).toFixed(1)} MB`
    : `${(Number(value || 0) / 1024).toFixed(1)} KB`;
const locationState = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    view: Object.hasOwn(pages, params.get('view')) ? params.get('view') : 'overview',
    ...Object.fromEntries(Object.keys(emptyFilters).map((key) => [key, params.get(key) || ''])),
    page: Math.max(1, Number(params.get('page')) || 1),
  };
};

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem('math-admin-token') || '');
  const [user, setUser] = useState(null),
    [checking, setChecking] = useState(Boolean(token));
  const [account, setAccount] = useState('admin'),
    [password, setPassword] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [nav, setNav] = useState(locationState),
    [data, setData] = useState(null),
    [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0),
    [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountData, setAccountData] = useState({
    preferences: { ...defaultPreferences },
    version: 0,
    models: [],
  });
  async function reloadAccount() {
    const result = await accountRequest(token);
    setUser(result.user);
    setAccountData(result);
    applyPreferences(result.preferences);
    return result;
  }
  const onAccountPreferences = (result) => {
    setAccountData((current) => ({ ...current, ...result }));
    applyPreferences(result.preferences);
  };
  const changePassword = () => {
    setAccountDialog(null);
    setModal({ type: 'password' });
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  function clearSession() {
    localStorage.removeItem('math-admin-token');
    setToken('');
    setUser(null);
    setPassword('');
    setData(null);
    setModal(null);
    setAccountDialog(null);
    applyPreferences(defaultPreferences);
  }
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== 'math-admin-token' || event.newValue === token) return;
      setUser(null);
      setData(null);
      setModal(null);
      setAccountDialog(null);
      setPassword('');
      applyPreferences(defaultPreferences);
      setToken(event.newValue || '');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [token]);
  async function api(url, options = {}, signal) {
    const response = await fetch(`${API_ROOT}/admin/${url}`, {
      method: options.method || 'GET',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('服务响应异常，请稍后重试');
    }
    if (!response.ok) {
      if (response.status === 401 && url !== 'login') clearSession();
      throw new Error(result.message || '操作失败');
    }
    return result;
  }
  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    let live = true;
    setChecking(true);
    api('me')
      .then(() => accountRequest(token))
      .then((result) => {
        if (live) {
          setUser(result.user);
          setAccountData(result);
          applyPreferences(result.preferences);
          setError('');
        }
      })
      .catch((e) => {
        if (live) {
          clearSession();
          setError(e.message);
        }
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [token]);
  useEffect(() => {
    const pop = () => {
      setData(null);
      setModal(null);
      setNav(locationState());
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  function navigate(next) {
    const state = { ...nav, ...next },
      params = new URLSearchParams();
    for (const [key, value] of Object.entries(state))
      if (value && !(key === 'page' && value === 1)) params.set(key, String(value));
    window.history.pushState({}, '', `/admin?${params}`);
    setData(null);
    setNav(state);
    setModal(null);
    setError('');
  }
  useEffect(() => {
    if (!user || !token) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError('');
    const params = new URLSearchParams({
      page: String(nav.page),
      ...Object.fromEntries(Object.keys(emptyFilters).map((key) => [key, nav[key]])),
    });
    api(`${nav.view}?${params}`, {}, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user, token, nav, revision]);
  async function login(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api('login', {
        method: 'POST',
        body: { account, password },
      });
      localStorage.setItem('math-admin-token', result.token);
      setToken(result.token);
      setPassword('');
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? '无法连接后端，请确认服务已启动' : e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await api('logout', { method: 'POST' });
    } catch {
    } finally {
      clearSession();
      setBusy(false);
    }
  }
  async function checkStorage() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const storage = await api('storage/check', { method: 'POST' });
      setData((current) => (current ? { ...current, storage } : current));
      setNotice('存储核查已完成');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function detail(item) {
    setBusy(true);
    setError('');
    try {
      const result = await api(`users/${item.id}`);
      setModal({ type: 'detail', user: result.user });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function userRecords(view) {
    navigate({ view, ...emptyFilters, owner: String(modal.user.id), page: 1 });
  }
  function openContent(source, id, returnCourse) {
    setModal({ type: 'contentDetail', source, item: { id }, returnCourse });
  }
  if (checking) return <AdminStartup />;
  if (!user)
    return (
      <AdminInkLogin
        account={account}
        password={password}
        onAccount={setAccount}
        onPassword={setPassword}
        onSubmit={login}
        error={error}
        busy={busy}
      />
    );
  const list = ['users', 'courses', 'materials', 'jobs', 'logs', 'announcements'].includes(
    nav.view,
  );
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          数有方<span className="atelier-brand-sub">研习平台 · 管理中心</span>
        </div>
        <p className="atelier-nav-section">平台工作台</p>
        <nav>
          {Object.entries(pages).map(([key, name], index) => (
            <React.Fragment key={key}>
              {{
                overview: '平台概览',
                users: '内容与用户',
                services: '系统与服务',
              }[key] && (
                <p className="admin-nav-group">
                  {
                    {
                      overview: '平台概览',
                      users: '内容与用户',
                      services: '系统与服务',
                    }[key]
                  }
                </p>
              )}
              <button
                aria-current={nav.view === key ? 'page' : undefined}
                className={nav.view === key ? 'active' : ''}
                onClick={() => navigate({ view: key, ...emptyFilters, page: 1 })}
              >
                <span className="atelier-nav-index">
                  {['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'][index]}
                </span>
                <span>{name}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
        <footer>
          <div className="sidebar-bottom admin-account-entry">
            <AccountEntry
              user={user}
              onProfile={() => setAccountDialog('profile')}
              onSettings={() => setAccountDialog('settings')}
            />
          </div>
          <a href="/">返回学习端</a>
        </footer>
      </aside>
      <main className="admin-main">
        <header className="admin-heading">
          <div>
            <small>数有方 · 平台管理</small>
            <h1>{pages[nav.view]}</h1>
            <p className="admin-page-subtitle">
              {
                {
                  overview: '观全局，知进展，让每一次研习有序发生。',
                  users: '管理账户与使用状态，守护有序的学习空间。',
                  courses: '查阅课程内容与研习状态。',
                  materials: '整理资料记录，关注内容与文件状态。',
                  jobs: '查看生成进展，及时处理异常任务。',
                  announcements: '发布平台消息，让重要信息清晰传达。',
                  services: '连接智能服务，让研习顺畅发生。',
                  limits: '按平台需要，调整运行与使用额度。',
                  backups: '妥善保存数据，为持续研习留一份保障。',
                  logs: '回溯平台操作，让每一次变更有迹可循。',
                }[nav.view]
              }
            </p>
          </div>
          <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            刷新
          </button>
        </header>
        {error && (
          <div className="admin-error" role="alert">
            {error}
            <button onClick={() => setRevision((value) => value + 1)}>重试</button>
          </div>
        )}
        {notice && (
          <p role="status" className="admin-notice">
            {notice}
          </p>
        )}
        {list && nav.owner && (
          <div className="admin-owner-scope">
            <span>账户范围 · {data?.owner_scope?.account || '正在读取…'}</span>
            <button type="button" onClick={() => navigate({ owner: '', page: 1 })}>
              查看全部账户
            </button>
          </div>
        )}
        {list && <Filters key={JSON.stringify(nav)} nav={nav} onChange={navigate} />}
        {loading ? (
          <div className="admin-empty" role="status">
            正在读取数据…
          </div>
        ) : (
          data && (
            <>
              {nav.view === 'overview' && (
                <>
                  <div className="admin-stats">
                    {[
                      ['用户总数', data.counts.users],
                      ['正常账户', data.counts.activeUsers],
                      ['停用账户', data.counts.disabledUsers],
                      ['课程', data.counts.courses],
                      ['章节', data.counts.chapters],
                      ['学习资料', data.counts.materials],
                    ].map(([label, value]) => (
                      <article key={label}>
                        <span>{label}</span>
                        <strong>{Number(value).toLocaleString()}</strong>
                      </article>
                    ))}
                  </div>
                  <div className="admin-overview-grid">
                    <section className="admin-card">
                      <h2>AI 生成任务</h2>
                      {data.jobs.length ? (
                        data.jobs.map((item) => (
                          <p className="admin-metric" key={item.status}>
                            <span>{stateNames[item.status] || item.status}</span>
                            <strong>{item.count}</strong>
                          </p>
                        ))
                      ) : (
                        <p>暂无生成任务</p>
                      )}
                      <button onClick={() => navigate({ view: 'jobs', page: 1 })}>查看任务</button>
                    </section>
                    <section className="admin-card">
                      <h2>资料存储</h2>
                      <p className="admin-metric">
                        <span>原文件</span>
                        <strong>{bytes(data.storage.materialBytes)}</strong>
                      </p>
                      <p className="admin-metric">
                        <span>笔记图片</span>
                        <strong>{bytes(data.storage.imageBytes)}</strong>
                      </p>
                      <p className="admin-metric">
                        <span>缺失文件</span>
                        <strong>{data.storage.missingFiles}</strong>
                      </p>
                      <p className="admin-muted">
                        核查于 {formatDateTime(data.storage.checkedAt)} · 不包含预览缓存。
                      </p>
                      <div className="admin-storage-actions">
                        <button disabled={busy} onClick={checkStorage}>
                          {busy ? '核查中…' : '核查存储'}
                        </button>
                        <button
                          onClick={() =>
                            navigate({
                              view: 'materials',
                              ...emptyFilters,
                              page: 1,
                            })
                          }
                        >
                          查看资料
                        </button>
                      </div>
                    </section>
                  </div>
                  <section className="admin-card admin-recent">
                    <h2>最近失败任务</h2>
                    {data.recentFailures?.length ? (
                      <ul>
                        {data.recentFailures.map((item) => (
                          <li key={`${item.source}:${item.id}`}>
                            <div>
                              <strong>
                                {taskNames[item.kind]} · {item.course_title || '课程已删除'}
                              </strong>
                              <small>
                                {item.account} · {formatDateTime(item.created_at)}
                              </small>
                            </div>
                            <span>{item.error_summary}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="admin-muted">暂无失败任务</p>
                    )}
                    <button
                      onClick={() =>
                        navigate({
                          view: 'jobs',
                          ...emptyFilters,
                          status: 'failed',
                          page: 1,
                        })
                      }
                    >
                      查看失败任务
                    </button>
                    <button
                      style={{ marginLeft: 8 }}
                      onClick={() => navigate({ view: 'services', ...emptyFilters, page: 1 })}
                    >
                      服务状态
                    </button>
                  </section>
                  <p className="admin-muted">更新于 {formatDateTime(data.checkedAt)}</p>
                </>
              )}
              {nav.view === 'backups' && (
                <AdminBackups
                  data={data}
                  api={api}
                  token={token}
                  onSaved={(message) => setNotice(message)}
                />
              )}
              {nav.view === 'limits' && (
                <AdminLimits
                  data={data}
                  api={api}
                  onSaved={(message) => {
                    setNotice(message);
                    setRevision((value) => value + 1);
                  }}
                />
              )}
              {nav.view === 'services' && (
                <Services
                  data={data}
                  api={api}
                  onSaved={(message) => {
                    setNotice(message);
                    setRevision((value) => value + 1);
                  }}
                />
              )}
              {nav.view === 'announcements' && (
                <Announcements
                  data={data}
                  api={api}
                  onSaved={(message) => {
                    setNotice(message);
                    setRevision((value) => value + 1);
                  }}
                />
              )}
              {list && (
                <>
                  {nav.view !== 'announcements' && (
                    <div className="admin-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {{
                              users: [
                                '账号 / 昵称',
                                '角色',
                                '状态',
                                '邮箱验证',
                                '课程 / 资料',
                                '注册时间',
                                '操作',
                              ],
                              courses: [
                                '课程名称',
                                '所属账号',
                                '章节',
                                '资料',
                                '创建时间',
                                '状态',
                                '操作',
                              ],
                              materials: [
                                '文件名称',
                                '课程 / 账号',
                                '大小',
                                '原文件',
                                '文字提取',
                                '预览',
                                '导入时间',
                                '状态',
                                '操作',
                              ],
                              jobs: [
                                '任务编号',
                                '类型',
                                '课程 / 账号',
                                '状态',
                                '创建时间',
                                '说明',
                                '操作',
                              ],
                              logs: ['时间', '操作人', '动作', '目标', '结果', '说明'],
                            }[nav.view].map((name) => (
                              <th key={name}>{name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((item) => (
                            <tr key={item.source ? `${item.source}:${item.id}` : item.id}>
                              {nav.view === 'users' && (
                                <>
                                  <td>
                                    <strong>{item.account}</strong>
                                    <small>{item.nickname}</small>
                                  </td>
                                  <td>{item.role === 'admin' ? '管理员' : '学习用户'}</td>
                                  <td>
                                    <Badge
                                      value={
                                        item.status === 'cancelled'
                                          ? '已注销'
                                          : item.status === 'active'
                                            ? '正常'
                                            : '停用'
                                      }
                                      tone={item.status === 'active' ? 'good' : 'bad'}
                                    />
                                  </td>
                                  <td>{item.email_verified ? '已验证' : '未验证 / 未绑定'}</td>
                                  <td>
                                    {item.course_count} 门
                                    <small>{bytes(item.material_bytes)}</small>
                                  </td>
                                  <td>{formatDateTime(item.created_at)}</td>
                                  <td className="admin-row-actions">
                                    <button disabled={busy} onClick={() => detail(item)}>
                                      详情
                                    </button>
                                    {item.role !== 'admin' && item.status !== 'cancelled' && (
                                      <button
                                        disabled={busy}
                                        className={item.status === 'active' ? 'admin-danger' : ''}
                                        onClick={() => setModal({ type: 'status', user: item })}
                                      >
                                        {item.status === 'active' ? '停用' : '恢复'}
                                      </button>
                                    )}
                                    {item.role === 'student' && item.status !== 'cancelled' && (
                                      <button
                                        className="admin-danger"
                                        disabled={busy}
                                        onClick={() => setModal({ type: 'cancel', user: item })}
                                      >
                                        注销
                                      </button>
                                    )}
                                  </td>
                                </>
                              )}
                              {nav.view === 'courses' && (
                                <>
                                  <td>
                                    <strong>{item.title}</strong>
                                  </td>
                                  <td>{item.account}</td>
                                  <td>{item.chapters}</td>
                                  <td>{item.materials}</td>
                                  <td>{formatDateTime(item.created_at)}</td>
                                  <td>
                                    <Badge
                                      value={item.admin_status === 'paused' ? '暂停' : '正常'}
                                      tone={item.admin_status === 'paused' ? 'bad' : 'good'}
                                    />
                                  </td>
                                  <td className="admin-row-actions">
                                    <button onClick={() => openContent('course', item.id)}>
                                      详情
                                    </button>
                                    <button
                                      onClick={() =>
                                        setModal({
                                          type: 'content',
                                          source: 'course',
                                          item,
                                        })
                                      }
                                    >
                                      {item.admin_status === 'paused' ? '恢复' : '暂停'}
                                    </button>
                                  </td>
                                </>
                              )}
                              {nav.view === 'materials' && (
                                <>
                                  <td>
                                    <strong>{item.original_name}</strong>
                                  </td>
                                  <td>
                                    {item.course_title}
                                    <small>{item.account}</small>
                                  </td>
                                  <td>{bytes(item.size_bytes)}</td>
                                  <td>
                                    <Badge
                                      value={item.original_exists ? '存在' : '缺失'}
                                      tone={item.original_exists ? 'good' : 'bad'}
                                    />
                                  </td>
                                  <td>
                                    {item.text_length > 0
                                      ? `已提取 ${item.text_length} 字`
                                      : '暂无文字'}
                                  </td>
                                  <td>
                                    {
                                      {
                                        ready: '已生成',
                                        missing: '文件缺失',
                                        not_generated: '尚未生成',
                                      }[item.preview_status]
                                    }
                                  </td>
                                  <td>{formatDateTime(item.created_at)}</td>
                                  <td>
                                    <Badge
                                      value={item.admin_status === 'paused' ? '暂停' : '正常'}
                                      tone={item.admin_status === 'paused' ? 'bad' : 'good'}
                                    />
                                  </td>
                                  <td className="admin-row-actions">
                                    <button onClick={() => openContent('material', item.id)}>
                                      详情
                                    </button>
                                    <button
                                      onClick={() =>
                                        setModal({
                                          type: 'content',
                                          source: 'material',
                                          item,
                                        })
                                      }
                                    >
                                      {item.admin_status === 'paused' ? '恢复' : '暂停'}
                                    </button>
                                    {item.original_exists && (
                                      <button
                                        onClick={() =>
                                          setModal({
                                            type: 'content',
                                            source: 'material',
                                            item,
                                            repair: true,
                                          })
                                        }
                                      >
                                        修复预览
                                      </button>
                                    )}
                                  </td>
                                </>
                              )}
                              {nav.view === 'jobs' && (
                                <>
                                  <td>
                                    {item.source}-{item.id}
                                  </td>
                                  <td>{taskNames[item.kind] || item.kind}</td>
                                  <td>
                                    {item.course_title || '课程已删除'}
                                    <small>{item.account}</small>
                                  </td>
                                  <td>
                                    <Badge
                                      value={stateNames[item.status] || item.status}
                                      tone={
                                        item.status === 'failed'
                                          ? 'bad'
                                          : ['done', 'adopted'].includes(item.status)
                                            ? 'good'
                                            : 'neutral'
                                      }
                                    />
                                  </td>
                                  <td>{formatDateTime(item.created_at)}</td>
                                  <td>{item.error_summary || '—'}</td>
                                  <td>
                                    <button onClick={() => setModal({ type: 'task', item })}>
                                      详情
                                    </button>
                                  </td>
                                </>
                              )}
                              {nav.view === 'logs' && (
                                <>
                                  <td>{formatDateTime(item.created_at)}</td>
                                  <td>
                                    {item.actor_account}
                                    <small>
                                      {item.actor_role === 'student' ? '学习用户' : '管理员'}
                                    </small>
                                  </td>
                                  <td>{actions[item.action] || item.action}</td>
                                  <td>{logTarget(item)}</td>
                                  <td>
                                    <Badge
                                      value={
                                        logResults[item.result]?.label || item.result || '未知'
                                      }
                                      tone={logResults[item.result]?.tone || 'neutral'}
                                    />
                                  </td>
                                  <td>{item.detail || '—'}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!data.items.length && <div className="admin-empty">没有符合条件的记录</div>}
                    </div>
                  )}
                  <footer className="admin-pagination">
                    <span>
                      共 {data.total} 条 · 第 {data.page} /{' '}
                      {Math.max(1, Math.ceil(data.total / data.pageSize))} 页
                    </span>
                    <div>
                      <button
                        disabled={nav.page <= 1}
                        onClick={() => navigate({ page: nav.page - 1 })}
                      >
                        上一页
                      </button>
                      <button
                        disabled={nav.page * data.pageSize >= data.total}
                        onClick={() => navigate({ page: nav.page + 1 })}
                      >
                        下一页
                      </button>
                    </div>
                  </footer>
                </>
              )}
            </>
          )
        )}
      </main>
      {modal?.type === 'contentDetail' && (
        <AdminContentDetail
          key={`${modal.source}:${modal.item.id}`}
          source={modal.source}
          id={modal.item.id}
          returnCourse={modal.returnCourse}
          api={api}
          onClose={() => setModal(null)}
          onOpen={openContent}
        />
      )}
      {accountDialog && (
        <AccountPanel
          admin
          kind={accountDialog}
          token={token}
          user={user}
          preferences={accountData.preferences}
          version={accountData.version}
          models={accountData.models}
          onUser={setUser}
          onPreferences={onAccountPreferences}
          onClose={() => setAccountDialog(null)}
          onReload={reloadAccount}
          onPasswordChange={changePassword}
          onLogout={async (mode) => {
            await logout();
            if (mode === 'switch') {
              setAccount('');
              setError('请登录其他管理员账号');
            }
          }}
        />
      )}
      {modal?.type === 'content' && (
        <AdminContentAction
          item={modal.item}
          source={modal.source}
          repair={modal.repair}
          api={api}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setNotice(message);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {modal?.type === 'password' && (
        <AdminPassword
          api={api}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            clearSession();
            setError(message);
          }}
        />
      )}
      {modal?.type === 'task' && (
        <AdminTaskDetail
          item={modal.item}
          api={api}
          onClose={() => setModal(null)}
          onChanged={(message) => {
            setNotice(message);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {['status', 'cancel'].includes(modal?.type) && (
        <AdminUserAction
          key={`${modal.type}:${modal.user.id}`}
          user={modal.user}
          type={modal.type}
          api={api}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setNotice(message);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {modal?.type === 'detail' && (
        <AdminDialog title="账户详情" onClose={() => setModal(null)} locked={busy}>
          <>
            <h2>账户详情</h2>
            <dl className="admin-info">
              {[
                ['账号', modal.user.account],
                ['昵称', modal.user.nickname],
                ['角色', modal.user.role === 'admin' ? '管理员' : '学习用户'],
                [
                  '状态',
                  modal.user.status === 'cancelled'
                    ? '已注销'
                    : modal.user.status === 'active'
                      ? '正常'
                      : '停用',
                ],
                ['最近处理原因', modal.user.status_reason || '无'],
                ['课程', modal.user.course_count],
                ['笔记', modal.user.notes],
                ['练习', modal.user.practices],
                ['资料容量', bytes(modal.user.material_bytes)],
              ].map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <div className="admin-user-shortcuts">
              {[
                ['courses', '查看课程'],
                ['materials', '查看资料'],
                ['jobs', '查看 AI 任务'],
                ['logs', '查看操作日志'],
              ].map(([view, label]) => (
                <button type="button" key={view} onClick={() => userRecords(view)}>
                  {label} →
                </button>
              ))}
            </div>
            <footer>
              <AdminDialogClose>关闭</AdminDialogClose>
            </footer>
          </>
        </AdminDialog>
      )}
    </div>
  );
}

function logTarget(item) {
  if (/^(course|material)_(pause|restore)$/.test(item.action) || item.action === 'preview_repair')
    return (item.action.startsWith('course_') ? '课程' : '资料') + ' · ' + item.target_id;
  if (item.action.startsWith('backup_'))
    return '备份 · ' + String(item.target_id || '').slice(0, 8);
  if (item.action === 'password_change') return item.actor_account;
  if (['task_cancel', 'task_retry'].includes(item.action)) {
    const [source, id] = String(item.target_id || '').split(':');
    return (
      ({ course: '课程生成', note: '笔记生成', plan: '计划生成' }[source] || '生成任务') +
      ' · ' +
      id
    );
  }
  if (['login', 'logout', 'user_login'].includes(item.action))
    return item.actor_account === '未知' ? '登录账户' : item.actor_account;
  if (['service_config', 'service_check', 'service_delete'].includes(item.action))
    return (
      item.target_name ||
      {
        ai: 'AI 服务',
        mail: '邮件服务',
        mail_send: '测试邮件',
        chapter_images: '章节配图服务',
      }[item.target_id] ||
      (item.action === 'service_delete' ? '已删除的 API' : 'API 配置')
    );
  if (item.action.startsWith('user_')) return item.target_name || '账户已删除';
  if (item.action.startsWith('announcement_')) return item.target_name || '公告已删除';
  return item.target_name || '—';
}
function Badge({ value, tone }) {
  return <span className={`admin-badge ${tone}`}>{value}</span>;
}
function Filters({ nav, onChange }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(Object.keys(emptyFilters).map((key) => [key, nav[key]])),
  );
  const change = (key, value) => setValues((state) => ({ ...state, [key]: value }));
  const select = (key, label, options) => (
    <select aria-label={label} value={values[key]} onChange={(e) => change(key, e.target.value)}>
      <option value="">{label}</option>
      {Object.entries(options).map(([value, name]) => (
        <option key={value} value={value}>
          {name}
        </option>
      ))}
    </select>
  );
  return (
    <form
      className="admin-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ ...values, page: 1 });
      }}
    >
      <input
        aria-label="搜索"
        placeholder={
          nav.view === 'users'
            ? '账号或昵称'
            : nav.view === 'logs'
              ? '操作人、目标或说明'
              : nav.view === 'announcements'
                ? '公告标题'
                : '名称或所属账号'
        }
        maxLength={80}
        value={values.q}
        onChange={(e) => change('q', e.target.value)}
      />
      {nav.view === 'users' && (
        <>
          {select('role', '全部角色', { student: '学习用户', admin: '管理员' })}
          {select('status', '全部状态', {
            active: '正常',
            disabled: '停用',
            cancelled: '已注销',
          })}
        </>
      )}
      {nav.view === 'jobs' && (
        <>
          {select('status', '全部状态', stateNames)}
          {select('kind', '全部任务', taskNames)}
        </>
      )}
      {['courses', 'materials'].includes(nav.view) &&
        select('status', '全部状态', { active: '正常', paused: '已暂停' })}
      {nav.view === 'materials' &&
        select('issue', '全部资料', {
          original_missing: '原文件缺失',
          preview_missing: '预览文件缺失',
          empty_text: '暂无文字',
        })}
      {nav.view === 'logs' && (
        <>
          {select('role', '全部角色', { student: '学习用户', admin: '管理员' })}
          {select('action', '全部动作', actions)}
          {select('result', '全部结果', {
            success: '成功',
            failed: '失败',
            running: '进行中',
            accepted: '已受理',
          })}
        </>
      )}
      {nav.view === 'announcements' &&
        select('status', '全部公告', {
          draft: '草稿',
          published: '已发布',
          withdrawn: '已下架',
          deleted: '已删除',
        })}
      {['users', 'courses', 'materials', 'jobs', 'logs'].includes(nav.view) && (
        <DateRange from={values.from} to={values.to} onChange={change} />
      )}
      <div className="admin-filter-actions">
        <button className="admin-primary">查询</button>
        <button
          type="button"
          className="admin-filter-reset"
          onClick={() => onChange({ ...emptyFilters, page: 1 })}
        >
          重置
        </button>
      </div>
    </form>
  );
}
