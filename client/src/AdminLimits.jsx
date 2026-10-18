import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useState } from 'react';
export default function AdminLimits({ data, api, onSaved }) {
  const [editing, setEditing] = useState(false),
    [config, setConfig] = useState(null),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (!data) return null;
  const labels = {
    uploadMB: '单个资料大小（MB）',
    uploadCount: '单次资料数量',
    aiConcurrency: 'AI 请求并发数',
  };
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('limits', { method: 'PUT', body: { config, version: data.version, reason } });
      setEditing(false);
      onSaved('运行设置已更新');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-runtime-panel">
      <h2>运行设置</h2>
      <p>限制资料上传和 AI 请求。暂停后不再接受新任务，已经开始的任务继续执行。</p>
      <dl>
        {Object.entries(labels).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{data.config[key]}</dd>
          </div>
        ))}
        <div>
          <dt>AI 问答</dt>
          <dd>{data.config.chatEnabled ? '开启' : '暂停'}</dd>
        </div>
        <div>
          <dt>AI 生成</dt>
          <dd>{data.config.generationEnabled ? '开启' : '暂停'}</dd>
        </div>
      </dl>
      <p>
        并发限制按实际模型请求计算，超出后排队；当前 {data.active} 个请求正在执行，{data.waiting}{' '}
        个正在排队。
      </p>
      <button
        onClick={() => {
          setConfig({ ...data.config });
          setReason('');
          setError('');
          setEditing(true);
        }}
      >
        修改设置
      </button>
      {editing && (
        <AdminDialog
          title="修改运行设置"
          onClose={() => setEditing(false)}
          locked={busy}
          dirty={Boolean(reason.trim() || JSON.stringify(config) !== JSON.stringify(data.config))}
        >
          <form onSubmit={save}>
            <h2>修改运行设置</h2>
            {Object.entries(labels).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="1"
                  max={key === 'uploadMB' ? 500 : key === 'uploadCount' ? 20 : 16}
                  required
                  step="1"
                  value={config[key]}
                  onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            {[
              ['chatEnabled', '允许 AI 问答'],
              ['generationEnabled', '允许 AI 生成'],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            <label>
              修改原因
              <input
                value={reason}
                maxLength="200"
                required
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <footer>
              <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
              <button className="admin-primary" disabled={busy}>
                保存
              </button>
            </footer>
          </form>
        </AdminDialog>
      )}
    </section>
  );
}
