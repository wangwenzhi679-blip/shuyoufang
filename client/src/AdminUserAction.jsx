import React, { useRef, useState } from 'react';
import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';

const actions = {
  cancel: {
    title: '注销账号',
    description: '注销后不可恢复，所有登录立即失效，邮箱解绑。账号名称与学习记录保留供管理核查。',
    confirmLabel: '永久注销账号',
    successMessage: '账号已注销，登录权限已撤销',
  },
  disable: {
    title: '停用账户',
    description: '停用后将无法登录或继续操作，原有学习数据保留。',
    confirmLabel: '确认',
    successMessage: '账户状态已更新',
  },
  restore: {
    title: '恢复账户',
    description: '恢复后用户需要重新登录，原有学习数据保留。',
    confirmLabel: '确认',
    successMessage: '账户状态已更新',
  },
};

export default function AdminUserAction({ user, type, api, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [confirmedAccount, setConfirmedAccount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const isCancellation = type === 'cancel';
  const actionName = isCancellation ? 'cancel' : user.status === 'active' ? 'disable' : 'restore';
  const action = actions[actionName];
  const canSubmit =
    Boolean(reason.trim()) && (!isCancellation || confirmedAccount === user.account);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !canSubmit) return;

    submitting.current = true;
    setSaving(true);
    setError('');
    const body = { version: user.status_version, reason: reason.trim() };
    if (isCancellation) body.account = confirmedAccount;
    else body.status = actionName === 'disable' ? 'disabled' : 'active';

    try {
      const endpoint = isCancellation ? 'cancel' : 'status';
      await api(`users/${user.id}/${endpoint}`, {
        method: isCancellation ? 'POST' : 'PATCH',
        body,
      });
    } catch (error) {
      setError(error.message);
      return;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
    onSaved(action.successMessage);
    onClose();
  }

  return (
    <AdminDialog
      title={action.title}
      onClose={onClose}
      locked={saving}
      dirty={Boolean(reason.trim() || confirmedAccount)}
    >
      <form onSubmit={submit}>
        <h2>{action.title}</h2>
        <p>{user.account}</p>
        <p className="admin-muted">{action.description}</p>
        {isCancellation && (
          <label className="admin-cancel-confirm">
            输入账号以确认
            <input
              required
              autoComplete="off"
              value={confirmedAccount}
              onChange={(event) => setConfirmedAccount(event.target.value)}
            />
          </label>
        )}
        <label>
          处理原因
          <textarea
            autoFocus
            required
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <AdminDialogClose disabled={saving}>取消</AdminDialogClose>
          <button className="admin-primary" disabled={saving || !canSubmit}>
            {saving ? '正在保存…' : action.confirmLabel}
          </button>
        </footer>
      </form>
    </AdminDialog>
  );
}
