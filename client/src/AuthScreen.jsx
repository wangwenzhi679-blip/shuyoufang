import React, { useEffect, useState } from 'react';
import './auth-field-hints.css';

const grades = ['初一', '初二', '初三', '高一', '高二', '高三'];
const authMeta = {
  login: { title: '登录学习空间', subtitle: '以理为径，向未知求证。', button: '登录' },
  loginCode: { title: '邮箱登录', subtitle: '', button: '登录' },
  register: {
    title: '创建学习账号',
    subtitle: '注册后需要验证绑定邮箱，才能进入学习空间',
    button: '创建账号并发送验证码',
  },
  verify: { title: '验证邮箱', subtitle: '验证码有效期为 10 分钟', button: '完成验证' },
  forgot: { title: '找回密码', subtitle: '验证码将发送到已验证的绑定邮箱', button: '发送验证码' },
  reset: { title: '重置密码', subtitle: '请输入邮箱验证码并设置新密码', button: '重置密码' },
};

export default function AuthScreen({
  mode,
  pendingEmail,
  setMode,
  message,
  submit,
  requestLoginCode,
}) {
  const fields =
    mode === 'login'
      ? ['account', 'password']
      : mode === 'loginCode'
        ? ['email', 'code']
        : mode === 'register'
          ? ['account', 'email', 'nickname', 'password', 'confirmPassword']
          : mode === 'verify'
            ? ['email', 'code']
            : mode === 'forgot'
              ? ['email']
              : ['email', 'code', 'password', 'confirmPassword'];
  const loginMode = mode === 'login' || mode === 'loginCode';
  return (
    <div className="auth-editorial-wrapper auth-refined auth-inkwash-page">
      <div className="auth-ink-background" aria-hidden="true">
        <img className="ink-rich-mountains" src="/assets/ink/mountain-panorama-v1.png" alt="" />
        <img className="ink-art-bamboo" src="/assets/ink/bamboo-clean-v2.png" alt="" />
        <img className="ink-study-ensemble" src="/assets/ink/studies-wash-v3.png" alt="" />
        <img className="ink-art-cloud" src="/assets/ink/cloud-clean-v2.png" alt="" />
        <img className="ink-art-plum" src="/assets/ink/plum-clean-v2.png" alt="" />
      </div>
      <header className="auth-editorial-nav">
        <div className="auth-cover-brand">
          <strong>数有方</strong>
          <small>研 习 空 间</small>
        </div>
        <span className="auth-nav-caption">让学习有迹可循</span>
      </header>
      <div className="auth-editorial-container">
        <aside className="auth-introduction auth-ink-intro">
          <p className="auth-motto">博观而约取 · 厚积而薄发</p>
          <h1 className="auth-hollow-headline">
            <span className="line-1">
              学而有方<span className="calligraphy-punctuation">，</span>
            </span>
            <span className="line-2">
              思而有得<span className="calligraphy-punctuation">。</span>
            </span>
            <span className="auth-mini-seal" title="数有方">
              数<br />有<br />方
            </span>
          </h1>
        </aside>
        <main className={`auth-form-card auth-${mode} auth-form-ink`}>
          <p className="auth-form-eyebrow">青灯黄卷 · 候君归来</p>
          <h2 className="auth-form-title">{loginMode ? '登录学习空间' : authMeta[mode].title}</h2>
          <p className="auth-form-description">
            {loginMode ? '欢迎回来，继续你的学习。' : authMeta[mode].subtitle}
          </p>
          {loginMode && (
            <div className="editorial-tabs auth-ink-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => setMode('login')}
              >
                密码登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'loginCode'}
                className={mode === 'loginCode' ? 'active' : ''}
                onClick={() => setMode('loginCode')}
              >
                邮箱登录
              </button>
            </div>
          )}
          <AuthForm
            key={mode}
            mode={mode}
            fields={fields}
            initialEmail={mode === 'register' ? '' : pendingEmail}
            button={authMeta[mode].button}
            submit={submit}
            requestLoginCode={mode === 'loginCode' ? requestLoginCode : undefined}
          />
          {message && (
            <p className="auth-status" role="status">
              {message}
            </p>
          )}
          <div className="auth-links">
            {loginMode ? (
              <>
                <button type="button" className="text-button" onClick={() => setMode('register')}>
                  注册账号
                </button>
                <button type="button" className="text-button" onClick={() => setMode('forgot')}>
                  忘记密码
                </button>
              </>
            ) : (
              <button type="button" className="text-button" onClick={() => setMode('login')}>
                返回登录
              </button>
            )}
          </div>
        </main>
      </div>
      <div className="auth-ink-couplet" aria-label="学而不思则罔，思而不学则殆。">
        <span>学而不思则罔，</span>
        <span>思而不学则殆。</span>
      </div>
      <footer className="auth-ink-footer">
        <div className="auth-inscription">
          <span className="inscription-quote">割之弥细，所失弥少。</span>
          <span className="inscription-author">
            —— 刘徽《九章算术注》
            <span className="seal-mini-badge" title="徽印">
              徽
            </span>
          </span>
        </div>
        <div className="auth-almanac-card" aria-label="时节签：寒露 十月宜读书">
          <div className="almanac-content">
            <span className="almanac-term">
              <span>寒</span>
              <span>露</span>
            </span>
            <span className="almanac-sub">
              <span>十月</span>
              <span className="almanac-dot">·</span>
              <span>宜读书</span>
            </span>
          </div>
          <span className="almanac-seal" aria-hidden="true">
            书
          </span>
        </div>
      </footer>
      <div className="auth-paper-signature">
        <span>数有方 · 让学习有迹可循</span>
      </div>
    </div>
  );
}
function AuthForm({ mode, fields, initialEmail, button, submit, requestLoginCode }) {
  const [values, setValues] = useState({ email: initialEmail || '' });
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const labels = {
    account: '登录账号',
    email: '邮箱',
    nickname: '昵称',
    grade: '年级',
    password: '密码',
    confirmPassword: '确认密码',
    code: '验证码',
  };
  const hints = {
    account: '8—16 位字母、数字或下划线。',
    password: '密码长度为 8—16 位，区分大小写。',
    confirmPassword: '再次输入密码，需与上面的密码一致。',
    nickname: '昵称长度为 2—16 个字符。',
    email:
      mode === 'register'
        ? '填写可接收验证码的邮箱，注册后需完成邮箱验证。'
        : mode === 'verify'
          ? '填写本次注册使用的邮箱。'
          : '填写已绑定账号并完成验证的邮箱。',
    code: '填写邮件中的 6 位数字验证码，有效期为 10 分钟。',
  };
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!countdown) return undefined;
    const timer = window.setInterval(
      () => setCountdown((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [countdown]);
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await submit(values);
    } catch (reason) {
      setError(reason.message);
    }
  };
  const sendLoginCode = async () => {
    setError('');
    try {
      if (!values.email) throw new Error('请先填写邮箱');
      await requestLoginCode(values.email);
      setCountdown(60);
    } catch (reason) {
      setError(reason.message);
    }
  };
  const input = (field) => (
    <input
      id={`auth-${field}`}
      aria-describedby={`auth-${field}-hint`}
      required
      value={values[field] || ''}
      type={
        field === 'password' || field === 'confirmPassword'
          ? visiblePasswords[field]
            ? 'text'
            : 'password'
          : field === 'email'
            ? 'email'
            : 'text'
      }
      inputMode={field === 'code' ? 'numeric' : undefined}
      minLength={
        field === 'account' || field === 'password' || field === 'confirmPassword'
          ? 8
          : field === 'nickname'
            ? 2
            : field === 'code'
              ? 6
              : undefined
      }
      maxLength={
        field === 'account' || field === 'password' || field === 'confirmPassword'
          ? 16
          : field === 'nickname'
            ? 16
            : field === 'code'
              ? 6
              : undefined
      }
      pattern={
        field === 'account' ? '[A-Za-z0-9_]{8,16}' : field === 'code' ? '[0-9]{6}' : undefined
      }
      onChange={(event) => update(field, event.target.value)}
    />
  );
  return (
    <form onSubmit={handleSubmit}>
      {fields.map((field) => (
        <label key={field}>
          {labels[field]}
          {field === 'grade' ? (
            <select
              required
              value={values.grade}
              onChange={(event) => update(field, event.target.value)}
            >
              <option value="" disabled />
              {grades.map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
          ) : field === 'code' && requestLoginCode ? (
            <div className="code-input-row">
              {input(field)}
              <button
                type="button"
                className="code-request"
                disabled={countdown > 0}
                onClick={sendLoginCode}
              >
                {countdown ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          ) : field === 'password' || field === 'confirmPassword' ? (
            <div className="auth-password-row">
              {input(field)}
              <button
                type="button"
                className="auth-eye-toggle"
                aria-label={
                  visiblePasswords[field] ? `隐藏${labels[field]}` : `显示${labels[field]}`
                }
                aria-pressed={!!visiblePasswords[field]}
                onClick={() =>
                  setVisiblePasswords((current) => ({ ...current, [field]: !current[field] }))
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {visiblePasswords[field] && <path d="m4 4 16 16" />}
                </svg>
              </button>
            </div>
          ) : (
            input(field)
          )}
          {hints[field] && (
            <small id={`auth-${field}-hint`} className="auth-field-hint">
              {hints[field]}
            </small>
          )}
        </label>
      ))}
      {error && <p className="form-error">{error}</p>}
      <button
        className="editorial-btn-primary"
        style={{ width: '100%', marginTop: '16px' }}
        type="submit"
      >
        <span>{button}</span>
        <span style={{ fontSize: '15px' }}>↗</span>
      </button>
    </form>
  );
}
