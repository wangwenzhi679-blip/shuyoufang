import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useEffect, useState } from 'react';
import { formatDateTime } from './date-format.mjs';
const kinds = {
  chapters: '章节目录',
  summary: '章节总结',
  practice: '智能出题',
  notes: '学习笔记',
  plan: '学习计划',
};
const states = {
  running: '生成中',
  saving: '保存中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
  adopted: '已采用',
};
export default function AdminTaskDetail({ item, api, onClose, onChanged }) {
  const [job, setJob] = useState(null),
    [error, setError] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState('');
  useEffect(() => {
    let alive = true,
      timer;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await api(`jobs/${item.source}/${item.id}`, {}, controller.signal);
        if (!alive) return;
        setJob(result.job);
        setError('');
        if (['running', 'saving'].includes(result.job.status)) timer = setTimeout(load, 2000);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [item]);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(`jobs/${item.source}/${item.id}/${action}`, {
        method: 'POST',
        body: { reason },
      });
      onChanged(result.message);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title="任务详情"
      onClose={onClose}
      locked={busy}
      dirty={Boolean(action && reason.trim())}
    >
      <h2>任务详情</h2>
      {job && (
        <>
          <dl className="admin-info">
            {[
              ['任务', `${kinds[job.kind]} · ${job.id}`],
              ['账号', job.account],
              ['课程', job.course_title || '课程已删除'],
              ['状态', states[job.status]],
              ['创建时间', formatDateTime(job.created_at)],
              ['更新时间', job.updated_at ? formatDateTime(job.updated_at) : '未记录'],
              ['进度', job.progress || '未记录'],
              ['说明', job.error_summary || '无'],
              ['重试任务', job.newJobId ? `${job.source}:${job.newJobId}` : '无'],
            ].map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
          {job.diagnostic && (
            <section className="admin-job-diagnostic">
              <h3>排查建议</h3>
              <dl className="admin-info">
                <dt>错误类型</dt>
                <dd>
                  {job.diagnostic.category} · {job.diagnostic.code}
                </dd>
                <dt>参考环节</dt>
                <dd>{job.diagnostic.stage}</dd>
                {job.diagnostic.httpStatus && (
                  <>
                    <dt>响应状态</dt>
                    <dd>HTTP {job.diagnostic.httpStatus}</dd>
                  </>
                )}
              </dl>
              <p>{job.diagnostic.hint}</p>
              <small>依据已有错误记录归类，未知环节显示“未记录”。</small>
            </section>
          )}
          {job.retryReason && job.status === 'failed' && (
            <p className="admin-muted">{job.retryReason}</p>
          )}
          {action ? (
            <form onSubmit={submit}>
              <p className="admin-muted">
                {action === 'cancel'
                  ? '取消正在执行的任务，学习端会同步状态。'
                  : '创建新的生成任务，结果仍由学习者查看和采用。'}
              </p>
              <label>
                处理原因
                <textarea
                  autoFocus
                  required
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <footer>
                <button type="button" disabled={busy} onClick={() => setAction('')}>
                  返回
                </button>
                <button disabled={busy || !reason.trim()} className="admin-primary">
                  {busy ? '处理中…' : '确认'}
                </button>
              </footer>
            </form>
          ) : (
            <footer>
              <AdminDialogClose>关闭</AdminDialogClose>
              {job.canCancel && (
                <button className="admin-danger" onClick={() => setAction('cancel')}>
                  取消任务
                </button>
              )}
              {job.canRetry && (
                <button className="admin-primary" onClick={() => setAction('retry')}>
                  重试
                </button>
              )}
            </footer>
          )}
        </>
      )}
      {!job && !error && <p className="admin-muted">正在读取…</p>}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {!job && error && (
        <footer>
          <AdminDialogClose>关闭</AdminDialogClose>
        </footer>
      )}
    </AdminDialog>
  );
}
