import { requestJson } from './api-client.mjs';
import { API_ROOT } from './api-base.mjs';
import CourseCoverManager from './CourseCoverManager.jsx';
import './settings-paper.css';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Settings,
  UserRound,
  LogOut,
  ArrowRightLeft,
  X,
  Sun,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import { applyPreferences, saveBeforeAccountChange } from './account-state.js';

export function accountRequest(token, path = '', method = 'GET', body) {
  return requestJson(path || 'account', { token, method, body, errorMessage: '操作失败' });
}
export function AccountEntry({ user, onProfile, onSettings }) {
  return (
    <div className="account-entry">
      <button className="account-identity" onClick={onProfile} aria-label="打开个人资料">
        <span className="account-avatar">
          {user.avatar ? <img src={user.avatar} alt="" /> : user.nickname?.slice(0, 1)}
        </span>
        <strong>{user.nickname}</strong>
      </button>
      <button className="account-gear" onClick={onSettings} title="设置" aria-label="打开设置">
        <Settings size={18} />
      </button>
    </div>
  );
}

export default function AccountPanel({
  kind,
  token,
  user,
  preferences,
  version,
  models,
  onUser,
  onPreferences,
  onClose,
  onLogout,
  onReload,
  admin = false,
  onPasswordChange,
}) {
  const [section, setSection] = useState('appearance'),
    [draft, setDraft] = useState({ ...preferences }),
    [name, setName] = useState(user.nickname),
    [avatar, setAvatar] = useState(user.avatar || null),
    [dialog, setDialog] = useState(null),
    [fields, setFields] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [sentEmail, setSentEmail] = useState('');
  const [imageLibrary, setImageLibrary] = useState(false);
  const [imageModel, setImageModel] = useState(null),
    [imageModels, setImageModels] = useState([]),
    [imageModelStatus, setImageModelStatus] = useState('loading'),
    [imageModelReload, setImageModelReload] = useState(0);
  useEffect(() => {
    if (admin || kind !== 'settings') return;
    let live = true;
    setImageModelStatus('loading');
    accountRequest(token)
      .then((data) => {
        if (live) {
          setImageModel(data.imageModel);
          setImageModels(data.imageModels || []);
          setImageModelStatus('ready');
        }
      })
      .catch(() => {
        if (live) setImageModelStatus('error');
      });
    return () => {
      live = false;
    };
  }, [token, kind, admin, imageModelReload]);
  const panel = useRef(null),
    returnFocus = useRef(document.activeElement),
    preview = useRef(preferences);
  useEffect(() => {
    if (!imageLibrary) panel.current?.focus();
  }, [imageLibrary, dialog]);
  const dirty =
    kind === 'settings'
      ? JSON.stringify(draft) !== JSON.stringify(preferences)
      : name !== user.nickname || avatar !== (user.avatar || null);
  useEffect(() => {
    panel.current?.focus();
    return () => {
      applyPreferences(preview.current);
      returnFocus.current?.focus?.();
    };
  }, []);
  const close = () => {
    if (busy) return;
    if (dialog) {
      setDialog(null);
      setFields({});
      setError('');
      return;
    }
    if (dirty) {
      setDialog('discard');
      return;
    }
    onClose();
  };
  useEffect(() => {
    const handler = (event) => {
      if (imageLibrary) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Tab') {
        const elements = [
          ...panel.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });
  const run = async (fn) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    applyPreferences(next);
  };
  const save = () =>
    run(async () => {
      if (kind === 'profile') {
        const result = await accountRequest(token, 'account/profile', 'PATCH', {
          nickname: name,
          avatar,
        });
        onUser(result.user);
      } else {
        const result = await accountRequest(token, 'account/preferences', 'PUT', {
          preferences: draft,
          version,
        });
        preview.current = result.preferences;
        onPreferences(result);
      }
      onClose();
    });
  const leave = async (mode) => {
    if (dirty) {
      const result = await accountRequest(token, 'account/preferences', 'PUT', {
        preferences: draft,
        version,
      });
      preview.current = result.preferences;
      onPreferences(result);
    }
    await saveBeforeAccountChange();
    await onLogout(mode);
  };
  const upload = async (file) => {
    if (!file) return;
    await run(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('请选择 PNG、JPG 或 WebP 图片');
      if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');
        const size = Math.min(bitmap.width, bitmap.height);
        ctx.drawImage(
          bitmap,
          (bitmap.width - size) / 2,
          (bitmap.height - size) / 2,
          size,
          size,
          0,
          0,
          320,
          320,
        );
        setAvatar(canvas.toDataURL('image/png'));
      } finally {
        bitmap.close();
      }
    });
  };
  const field = (key, label, type = 'password') => (
    <label>
      {label}
      <input
        required
        type={type}
        value={fields[key] || ''}
        autoComplete={
          key === 'currentPassword'
            ? 'current-password'
            : type === 'password'
              ? 'new-password'
              : type === 'email'
                ? 'email'
                : 'one-time-code'
        }
        maxLength={key === 'email' ? 254 : key === 'code' ? 6 : 100}
        onChange={(e) => {
          setFields({ ...fields, [key]: e.target.value });
          if (key === 'email') setSentEmail('');
        }}
      />
    </label>
  );
  const select = (key, label, options, caption, disabled = false) => (
    <label className="account-setting-row" data-setting={key}>
      <span>
        <strong>{label}</strong>
        {caption && <small>{caption}</small>}
      </span>
      <select
        disabled={disabled}
        value={
          key === 'imageModel' && (!draft[key] || draft[key] === 'configured')
            ? imageModel?.id || imageModels[0]?.id || ''
            : (draft[key] ?? '')
        }
        onChange={(e) =>
          update(key, key === 'readingSize' ? Number(e.target.value) : e.target.value)
        }
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const title =
    dialog === 'password'
      ? '修改密码'
      : dialog === 'email'
        ? '更换邮箱'
        : dialog === 'discard'
          ? '放弃修改？'
          : dialog === 'switch'
            ? '切换账号'
            : dialog === 'logout'
              ? '退出账号'
              : kind === 'profile'
                ? '个人资料'
                : '设置';
  if (imageLibrary)
    return (
      <CourseCoverManager
        token={token}
        onClose={() => {
          setImageLibrary(false);
        }}
      />
    );
  return createPortal(
    <div
      className="modal-backdrop account-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        data-account-role={admin ? 'admin' : 'student'}
        className={`record-modal account-panel ${dialog ? 'account-action-dialog ' + (['discard', 'switch', 'logout'].includes(dialog) ? 'account-confirm-dialog' : 'account-security-dialog') : kind === 'settings' ? 'settings-paper-dialog' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="account-header">
          <div>
            <h2>{title}</h2>
            {!dialog && (
              <p>
                {kind === 'profile'
                  ? '管理你的账号信息'
                  : admin
                    ? '外观与管理员账号'
                    : '外观、学习与账号'}
              </p>
            )}
          </div>
          <button className="account-close" aria-label="关闭" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        {dialog ? (
          <div className="account-body">
            {dialog === 'discard' ? (
              <p>本次修改尚未保存，确定放弃吗？</p>
            ) : ['switch', 'logout'].includes(dialog) ? (
              <>
                <p>
                  {admin
                    ? dialog === 'switch'
                      ? '进入管理登录页，使用其他管理员账号登录。'
                      : '退出当前管理账号，设置和管理记录会保留。'
                    : dialog === 'switch'
                      ? '保存当前学习内容后，进入登录页切换账号。'
                      : '保存当前学习内容后退出，学习记录会保留。'}
                </p>
                <small>
                  {admin ? '退出后将返回管理登录页。' : '退出会结束该账号当前的登录会话。'}
                </small>
              </>
            ) : dialog === 'password' ? (
              <form
                id="account-security"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await saveBeforeAccountChange();
                    const result = await accountRequest(token, 'account/password', 'POST', fields);
                    await onLogout('password', true, result.message);
                  });
                }}
              >
                {field('currentPassword', '原密码')}
                {field('password', '新密码')}
                {field('confirmPassword', '确认新密码')}
                <small>新密码为 8—16 位。</small>
              </form>
            ) : (
              <form
                id="account-security"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const result = await accountRequest(token, 'account/email', 'PUT', fields);
                    onUser(result.user);
                    setDialog(null);
                    setFields({});
                    setNotice('邮箱已更新');
                  });
                }}
              >
                {field('currentPassword', '当前密码')}
                {field('email', '新邮箱', 'email')}
                <div className="account-code-row">
                  {field('code', '验证码', 'text')}
                  <button
                    type="button"
                    disabled={busy || !fields.email || !fields.currentPassword}
                    onClick={() =>
                      run(async () => {
                        const result = await accountRequest(token, 'account/email-code', 'POST', {
                          email: fields.email,
                          currentPassword: fields.currentPassword,
                        });
                        setSentEmail(fields.email);
                        setNotice(result.message);
                      })
                    }
                  >
                    发送验证码
                  </button>
                </div>
                <small>验证新邮箱成功后替换原邮箱。</small>
              </form>
            )}
          </div>
        ) : kind === 'profile' ? (
          <div className="account-body">
            <div className="account-avatar-edit">
              <span className="account-avatar">
                {avatar ? <img src={avatar} alt="头像预览" /> : name?.slice(0, 1)}
              </span>
              <div>
                <label className="account-upload">
                  更换头像
                  <input
                    hidden
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      upload(e.target.files[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {avatar && (
                  <button disabled={busy} onClick={() => setAvatar(null)}>
                    移除
                  </button>
                )}
                <small>图片自动裁剪为方形</small>
              </div>
            </div>
            <label>
              昵称
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              登录账号
              <input value={user.account} readOnly />
            </label>
            <div className="account-detail-row">
              <div>
                <strong>邮箱</strong>
                <p>
                  {user.email || '尚未绑定'}
                  {user.email && <small>{user.emailVerified ? '已验证' : '未验证'}</small>}
                </p>
              </div>
              <button
                onClick={() => {
                  setDialog('email');
                  setFields({});
                  setError('');
                  setNotice('');
                }}
              >
                更换邮箱
              </button>
            </div>
            <div className="account-detail-row">
              <div>
                <strong>密码</strong>
                <p>定期更新账号密码</p>
              </div>
              <button
                disabled={admin && dirty}
                onClick={() => {
                  if (admin) {
                    onPasswordChange();
                    return;
                  }
                  setDialog('password');
                  setFields({});
                  setError('');
                  setNotice('');
                }}
              >
                修改密码
              </button>
            </div>
          </div>
        ) : (
          <div className="account-settings-layout">
            <nav aria-label="设置分类">
              {(admin
                ? [
                    ['appearance', '外观', Sun],
                    ['account', '账号', UserRound],
                  ]
                : [
                    ['appearance', '外观', Sun],
                    ['learning', '学习', BookOpen],
                    ['ai', '助手设置', Sparkles],
                  ]
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={section === key ? 'selected' : ''}
                  onClick={() => setSection(key)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="account-body">
              {section === 'appearance' ? (
                <>
                  {select('theme', '主题', [
                    ['light', '浅色'],
                    ['dark', '深色'],
                    ['system', '跟随系统'],
                  ])}
                  {select(
                    'interfaceSize',
                    '界面字号',
                    [
                      ['small', '小'],
                      ['standard', '标准'],
                      ['large', '大'],
                    ],
                    '菜单、按钮和提示文字',
                  )}
                  {!admin &&
                    select(
                      'readingSize',
                      '阅读字号',
                      [
                        [14, '14'],
                        [16, '16'],
                        [18, '18'],
                        [20, '20'],
                        [22, '22'],
                      ],
                      '课程正文、AI 回答和笔记默认字号',
                    )}
                  <div className="account-font-preview">
                    <small>{admin ? '界面效果预览' : '阅读效果预览'}</small>
                    <p
                      style={{
                        fontSize: admin
                          ? { small: 13, standard: 14, large: 16 }[draft.interfaceSize]
                          : draft.readingSize,
                      }}
                    >
                      {admin ? '管理有序，研学有方。' : '把知识读懂，把理解留下。'}
                    </p>
                  </div>
                </>
              ) : admin ? (
                <>
                  <label>
                    登录账号
                    <input value={user.account} readOnly />
                  </label>
                  <div className="account-detail-row">
                    <div>
                      <strong>角色</strong>
                      <p>管理员</p>
                    </div>
                  </div>
                  <div className="account-detail-row">
                    <div>
                      <strong>密码</strong>
                      <p>{dirty ? '请先保存外观设置' : '修改后需要重新登录'}</p>
                    </div>
                    <button disabled={dirty} onClick={onPasswordChange}>
                      修改密码
                    </button>
                  </div>
                </>
              ) : section === 'learning' ? (
                <>
                  <h3 className="settings-section-title">学习偏好</h3>
                  {select(
                    'startPage',
                    '进入应用时',
                    [
                      ['home', '学习首页'],
                      ['last', '上次页面'],
                    ],
                    '刷新仍保留当前页面',
                  )}
                  <label className="account-setting-row">
                    <span>
                      <strong>恢复阅读位置</strong>
                      <small>继续上次阅读的地方</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.restoreReading}
                      onChange={(e) => update('restoreReading', e.target.checked)}
                    />
                  </label>
                  <section className="settings-image-section">
                    <h3 className="settings-section-title">配图管理</h3>
                    <p>课程封面与章节配图。</p>
                    <div className="settings-image-card">
                      <img src="/assets/ink/landscape-clean-v2.png" alt="" />
                      <button type="button" onClick={() => setImageLibrary(true)}>
                        管理配图 →
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <>
                  {select(
                    'defaultModel',
                    '默认模型',
                    models.map((m) => [m.id, m.label]),
                    '新对话使用此模型',
                  )}
                  {select(
                    'imageModel',
                    '生图模型',
                    imageModelStatus === 'ready'
                      ? imageModels.map((m) => [m.id, m.label])
                      : [
                          [
                            draft.imageModel || 'configured',
                            imageModelStatus === 'loading' ? '读取中…' : '读取失败',
                          ],
                        ],
                    imageModelStatus === 'ready' && imageModel?.status !== 'enabled'
                      ? imageModel?.status === 'paused'
                        ? '服务已暂停'
                        : '服务尚未启用'
                      : '课程封面与章节配图',
                    imageModelStatus !== 'ready',
                  )}
                  {imageModelStatus === 'error' && (
                    <button
                      type="button"
                      className="account-model-retry"
                      onClick={() => setImageModelReload((n) => n + 1)}
                    >
                      重新读取模型
                    </button>
                  )}
                  {select('answerStyle', '回答长度', [
                    ['concise', '简洁'],
                    ['moderate', '适中'],
                    ['detailed', '详细'],
                  ])}
                </>
              )}
            </div>
          </div>
        )}
        {kind === 'settings' && !dialog && (
          <div className="account-session-actions">
            <button
              onClick={() => {
                setDialog('switch');
                setError('');
              }}
            >
              <ArrowRightLeft size={16} />
              切换账号
            </button>
            <button
              onClick={() => {
                setDialog('logout');
                setError('');
              }}
            >
              <LogOut size={16} />
              退出账号
            </button>
          </div>
        )}
        {notice && (
          <p className="account-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <div className="account-error" role="alert">
            {error}
            {error.includes('其他页面更新') && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await onReload();
                    onClose();
                  })
                }
              >
                重新加载
              </button>
            )}
          </div>
        )}
        <footer className="account-footer">
          <button disabled={busy} onClick={close}>
            {dialog === 'discard' ? '继续编辑' : '取消'}
          </button>
          {dialog === 'discard' ? (
            <button
              className="primary"
              onClick={() => {
                applyPreferences(preferences);
                onClose();
              }}
            >
              放弃修改
            </button>
          ) : ['switch', 'logout'].includes(dialog) ? (
            <button className="primary" disabled={busy} onClick={() => run(() => leave(dialog))}>
              {busy ? '正在保存…' : dialog === 'switch' ? '确认切换' : '确认退出'}
            </button>
          ) : dialog ? (
            <button
              form="account-security"
              type="submit"
              className="primary"
              disabled={busy || (dialog === 'email' && sentEmail !== fields.email)}
            >
              {busy ? '处理中…' : '确认修改'}
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || !dirty || (kind === 'profile' && name.trim().length < 2)}
              onClick={save}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
