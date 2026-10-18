import React, { useState } from 'react';
import './admin-ink-login.css';

export default function AdminInkLogin({
  account,
  password,
  onAccount,
  onPassword,
  onSubmit,
  error,
  busy,
}) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <main className="admin-login admin-ink-login">
      <div className="admin-ink-art" aria-hidden="true">
        <img className="admin-art-mountains" src="/assets/ink/mountain-panorama-v1.png" alt="" />
        <img className="admin-art-studies" src="/assets/ink/studies-wash-v3.png" alt="" />
        <img className="admin-art-bamboo" src="/assets/ink/bamboo-clean-v2.png" alt="" />
        <img className="admin-art-cloud" src="/assets/ink/cloud-clean-v2.png" alt="" />
        <img className="admin-art-plum" src="/assets/ink/plum-clean-v2.png" alt="" />
      </div>
      <header className="admin-ink-header">
        <div className="admin-ink-brand">
          <strong>数有方</strong>
          <span>管理中心</span>
        </div>
        <span className="admin-ink-label">平台管理</span>
      </header>
      <div className="admin-ink-content">
        <aside className="admin-ink-intro">
          <h1>
            <span>有序管理，</span>
            <span>安心研学。</span>
          </h1>
          <p>课程、账号与服务，统一管理。</p>
        </aside>
        <section className="admin-ink-form" aria-labelledby="admin-login-title">
          <p className="admin-ink-eyebrow">管理入口</p>
          <h2 id="admin-login-title">登录管理中心</h2>
          <p className="admin-ink-description">使用管理员账号登录</p>
          <form onSubmit={onSubmit}>
            <label htmlFor="admin-login-account">
              管理员账号
              <input
                id="admin-login-account"
                required
                autoComplete="username"
                maxLength={64}
                disabled={busy}
                value={account}
                onChange={(e) => onAccount(e.target.value)}
              />
            </label>
            <label htmlFor="admin-login-password">
              密码
              <div className="admin-ink-password">
                <input
                  id="admin-login-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={busy}
                  value={password}
                  onChange={(e) => onPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="admin-ink-eye"
                  disabled={busy}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {showPassword && <path d="m4 4 16 16" />}
                  </svg>
                </button>
              </div>
            </label>
            {error && (
              <p className="admin-ink-error" role="alert">
                {error}
              </p>
            )}
            <button className="admin-ink-submit" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? (
                '正在登录…'
              ) : (
                <>
                  登录管理端 <span aria-hidden="true">↗</span>
                </>
              )}
            </button>
            <a className="admin-ink-back" href="/">
              返回学习端
            </a>
          </form>
        </section>
      </div>
      <footer className="admin-ink-footer">
        <span>数有方 · 平台管理</span>
        <i aria-hidden="true">数</i>
      </footer>
    </main>
  );
}
