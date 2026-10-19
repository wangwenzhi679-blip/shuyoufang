import { accountRequest } from './AccountPanel.jsx';
import { applyPreferences, activePreferences } from './account-state.js';
import { useEffect, useState } from 'react';
import { CourseWorkspace } from './CourseWorkspace.jsx';

export function AccountWorkspace({ token, user, logout, onUser }) {
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
