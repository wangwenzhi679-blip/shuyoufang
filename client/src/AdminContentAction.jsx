import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useEffect, useState } from 'react';
export default function AdminContentAction({ item, source, repair, api, onClose, onSaved }) {
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [job, setJob] = useState(null);
  const paused = item.admin_status === 'paused';
  const title = repair ? '修复预览' : paused ? '恢复使用' : '暂停使用';
  useEffect(() => {
    if (!repair) return;
    let alive = true,
      timer;
    async function poll() {
      try {
        const result = await api(`materials/${item.id}/repair`);
        if (!alive) return;
        setJob(result.job);
        if (result.job?.status === 'running') timer = setTimeout(poll, 1500);
      } catch (e) {
        if (alive) setError(e.message);
      }
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [repair, item.id]);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(
        repair ? `materials/${item.id}/repair` : `content/${source}/${item.id}/status`,
        {
          method: 'POST',
          body: repair
            ? { reason }
            : { reason, version: item.admin_version, status: paused ? 'active' : 'paused' },
        },
      );
      onSaved(result.message);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog title={title} onClose={onClose} locked={busy} dirty={Boolean(reason.trim())}>
      <form onSubmit={submit}>
        <h2>{title}</h2>
        <p>{item.title || item.original_name}</p>
        <p className="admin-muted">
          {repair
            ? '后台重建预览，失败时保留旧版本。'
            : paused
              ? '恢复后可继续使用原有资料与学习记录。'
              : '暂停后阻止相关访问与新生成，正在生成的任务会尝试取消。原有数据保留。'}
        </p>
        {item.admin_reason && <p className="admin-muted">上次处理：{item.admin_reason}</p>}
        {repair && job && (
          <p role="status">
            {{ running: '正在修复', done: '上次修复已完成', failed: '上次修复未完成' }[job.status]}
            {job.error_text && '：' + job.error_text}
          </p>
        )}
        <label>
          处理原因
          <textarea
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
          <button
            className="admin-primary"
            disabled={busy || !reason.trim() || (repair && job?.status === 'running')}
          >
            {busy ? '正在提交…' : '确认'}
          </button>
        </footer>
      </form>
    </AdminDialog>
  );
}
