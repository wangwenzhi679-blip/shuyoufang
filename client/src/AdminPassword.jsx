import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useState } from 'react';
export default function AdminPassword({ api, onClose, onSaved }) {
  const [values, setValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (values.newPassword !== values.confirmPassword) {
      setError('两次新密码不一致');
      return;
    }
    setBusy(true);
    try {
      const result = await api('password', { method: 'POST', body: values });
      onSaved(result.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title="修改密码"
      onClose={onClose}
      locked={busy}
      dirty={Object.values(values).some(Boolean)}
    >
      <form onSubmit={submit}>
        <h2>修改密码</h2>
        <p className="admin-muted">修改后需要重新登录。</p>
        {[
          ['currentPassword', '当前密码'],
          ['newPassword', '新密码'],
          ['confirmPassword', '确认新密码'],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="password"
              autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'}
              required
              minLength={key === 'currentPassword' ? 1 : 8}
              maxLength={key === 'currentPassword' ? 128 : 64}
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
          <button className="admin-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存'}
          </button>
        </footer>
      </form>
    </AdminDialog>
  );
}
