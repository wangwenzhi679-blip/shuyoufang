import AuthScreen from './AuthScreen.jsx';
import { requestJson as request } from './api-client.mjs';
import { applyPreferences } from './account-state.js';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import { useEffect, useState } from 'react';
import { AccountWorkspace } from './AccountWorkspace.jsx';

export function loadSavedUser() {
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

export function App() {
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
