import { API_ROOT } from './api-base.mjs';
import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { formatDateTime } from './date-format.mjs';

const names = {
  running: '进行中',
  done: '已完成',
  failed: '未成功',
  pending: '未验证',
  deleting: '清理中',
  deleted: '已清理',
};
const bytes = (value) =>
  Number(value) >= 1048576
    ? `${(Number(value) / 1048576).toFixed(1)} MB`
    : `${(Number(value) / 1024).toFixed(1)} KB`;

export default function AdminBackups({ data, api, onSaved, token }) {
  const [current, setCurrent] = useState(data),
    [filter, setFilter] = useState(data?.status || '');
  const [modal, setModal] = useState(null),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const live = useRef(true),
    request = useRef(null),
    query = useRef({ page: data?.page || 1, status: data?.status || '' }),
    sequence = useRef(0),
    loadRef = useRef(null);

  useEffect(() => {
    setCurrent(data);
    setFilter(data?.status || '');
    query.current = { page: data?.page || 1, status: data?.status || '' };
  }, [data]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      request.current?.abort();
    };
  }, []);

  async function load(
    page = query.current.page,
    status = query.current.status,
    { quiet = false, failureMessage = '列表更新失败，请重试。' } = {},
  ) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++sequence.current;
    query.current = { page, status };
    if (!quiet) setLoading(true);
    try {
      const result = await api(
        'backups?' + new URLSearchParams({ page: String(page), status }),
        {},
        controller.signal,
      );
      if (!live.current || version !== sequence.current) return false;
      setCurrent(result);
      setError('');
      query.current = { page: result.page || 1, status: result.status || '' };
      return true;
    } catch (e) {
      if (live.current && version === sequence.current && !controller.signal.aborted)
        setError(failureMessage);
      return false;
    } finally {
      if (live.current && version === sequence.current) setLoading(false);
    }
  }
  loadRef.current = load;
  useEffect(() => {
    if (!current?.busy || busy || loading) return;
    let active = true,
      timer;
    const poll = async () => {
      const success = await loadRef.current(query.current.page, query.current.status, {
        quiet: true,
      });
      if (active) timer = setTimeout(poll, success ? 2000 : 4000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [current?.busy, busy, loading, current?.page, filter]);

  function open(mode, item) {
    setModal({ mode, item });
    setReason('');
    setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !reason.trim()) return;
    const operation = modal;
    setBusy(true);
    setError('');
    try {
      await api(
        operation.mode === 'delete'
          ? `backups/${operation.item.id}`
          : operation.mode === 'verify'
            ? `backups/${operation.item.id}/verify`
            : 'backups',
        {
          method: operation.mode === 'delete' ? 'DELETE' : 'POST',
          body: { reason: reason.trim() },
        },
      );
      if (!live.current) return;
      setModal(null);
      setReason('');
      setCurrent((previous) =>
        operation.mode === 'delete'
          ? {
              ...previous,
              items: previous.items.filter((item) => item.id !== operation.item.id),
              total: Math.max(0, (previous.total || 0) - 1),
            }
          : { ...previous, busy: true },
      );
      onSaved(operation.mode === 'delete' ? '历史备份已清理' : '任务已开始，可以继续使用其他页面');
      await load(query.current.page, query.current.status, {
        failureMessage: '操作已完成，列表暂未更新，请刷新列表。',
      });
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function measure(item) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(`backups/${item.id}/size`, { method: 'POST' });
      if (live.current)
        setCurrent((previous) => ({
          ...previous,
          items: previous.items.map((row) =>
            row.id === item.id ? { ...row, size_bytes: result.sizeBytes } : row,
          ),
        }));
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function download(item) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_ROOT}/admin/backups/${item.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('备份下载失败，请刷新状态后重试。');
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = `backup-${item.id}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  if (!current) return null;
  const pages = Math.max(
      1,
      Math.ceil((current.total ?? current.items.length) / (current.pageSize || 20)),
    ),
    locked = busy || loading,
    matching = (current.status || '') === filter;
  const modalTitle =
    modal?.mode === 'delete' ? '清理历史备份' : modal?.mode === 'verify' ? '验证恢复' : '创建备份';
  return (
    <section className="admin-runtime-panel admin-backups-panel">
      <div className="admin-backup-heading">
        <div>
          <h2>数据备份</h2>
          <p>保存课程资料与学习记录，在独立环境中验证恢复。</p>
        </div>
        <button
          className="admin-primary"
          disabled={current.busy || locked}
          onClick={() => open('create')}
        >
          创建备份
        </button>
      </div>
      <div className="admin-backup-toolbar">
        <span>
          {matching
            ? `共 ${current.total ?? current.items.length} 份记录`
            : loading
              ? '正在筛选…'
              : '筛选尚未完成'}
        </span>
        <div>
          <select
            aria-label="备份状态"
            value={filter}
            disabled={locked}
            onChange={(event) => {
              setFilter(event.target.value);
              load(1, event.target.value);
            }}
          >
            <option value="">全部记录</option>
            <option value="done">备份完成</option>
            <option value="failed">有异常</option>
            <option value="running">进行中</option>
          </select>
          <button type="button" disabled={locked} onClick={() => load()}>
            {loading ? '读取中…' : '刷新列表'}
          </button>
        </div>
      </div>
      {current.busy && (
        <p className="admin-backup-progress" role="status">
          后台任务正在处理，状态会自动更新。
        </p>
      )}
      {error && !modal && (
        <div role="alert" className="admin-error">
          {error}
          <button type="button" disabled={locked} onClick={() => load()}>
            重新读取
          </button>
        </div>
      )}
      <div aria-busy={loading}>
        {!matching && (
          <p className="admin-empty" role="status">
            {loading ? '正在读取备份…' : '未能读取当前条件下的记录，请重新读取。'}
          </p>
        )}
        {matching && !current.items.length && (
          <p className="admin-empty">
            {loading
              ? '正在读取备份…'
              : filter
                ? '该条件下暂无备份记录。'
                : '还没有备份，可以从这里保存第一份。'}
          </p>
        )}
        {matching &&
          current.items.map((item) => (
            <article key={item.id} className="admin-backup-row">
              <strong>{formatDateTime(item.created_at)}</strong>
              <small className="admin-backup-id">编号 {item.id.slice(0, 8)}</small>
              <p className="admin-muted">
                备份体积：{item.size_bytes == null ? '尚未统计' : bytes(item.size_bytes)}
                {item.size_bytes == null && (
                  <button
                    type="button"
                    disabled={current.busy || locked}
                    onClick={() => measure(item)}
                  >
                    统计体积
                  </button>
                )}
              </p>
              <p>
                备份：{names[item.status] || item.status} · 恢复验证：
                {names[item.verify_status] || item.verify_status}
                {item.verified_at && ` · ${formatDateTime(item.verified_at)}`}
              </p>
              {item.error_text && (
                <p role="alert" className="admin-backup-row-error">
                  {item.error_text}
                </p>
              )}
              <div className="admin-backup-actions">
                <button disabled={item.status !== 'done' || locked} onClick={() => download(item)}>
                  下载备份
                </button>
                <button
                  disabled={item.status !== 'done' || current.busy || locked}
                  onClick={() => open('verify', item)}
                >
                  验证恢复
                </button>
                <button
                  className="admin-danger"
                  disabled={current.busy || locked}
                  onClick={() => open('delete', item)}
                >
                  清理备份
                </button>
              </div>
            </article>
          ))}
      </div>
      <div className="admin-backup-pagination">
        <span>{matching ? `第 ${current.page || 1} / ${pages} 页` : '—'}</span>
        <div>
          <button
            disabled={!matching || locked || (current.page || 1) <= 1}
            onClick={() => load((current.page || 1) - 1)}
          >
            上一页
          </button>
          <button
            disabled={!matching || locked || (current.page || 1) >= pages}
            onClick={() => load((current.page || 1) + 1)}
          >
            下一页
          </button>
        </div>
      </div>
      {modal && (
        <AdminDialog
          title={modalTitle}
          onClose={() => setModal(null)}
          locked={busy}
          dirty={Boolean(reason.trim())}
        >
          <form onSubmit={submit}>
            <h2>{modalTitle}</h2>
            {modal.item && (
              <p className="admin-backup-target">
                {formatDateTime(modal.item.created_at)} · 编号 {modal.item.id.slice(0, 8)}
              </p>
            )}
            <p>
              {modal.mode === 'delete'
                ? '将永久删除这份备份及其文件，无法撤销。网站当前课程、资料和学习记录保留。'
                : modal.mode === 'verify'
                  ? '将在独立临时数据库检查数据数量、内容和关联完整性。'
                  : '备份期间可继续浏览；若原资料发生变化，备份会失败，请重新执行。'}
            </p>
            <label>
              操作原因
              <input
                required
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="admin-error">
                {error}
              </p>
            )}
            <footer>
              <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
              <button className="admin-primary" disabled={busy || !reason.trim()}>
                {busy ? '处理中…' : modal.mode === 'delete' ? '确认删除' : '确认'}
              </button>
            </footer>
          </form>
        </AdminDialog>
      )}
    </section>
  );
}
