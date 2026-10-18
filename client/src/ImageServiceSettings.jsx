import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useEffect, useState } from 'react';
import { formatDateTime } from './date-format.mjs';

function ConnectionResult({ result, version }) {
  if (!result) return <p className="service-muted">尚未检查</p>;
  return (
    <div
      className={`service-result ${result.status === 'done' ? 'good' : result.status === 'running' ? 'neutral' : 'bad'}`}
      role="status"
      aria-live="polite"
    >
      <strong>
        {result.status === 'done'
          ? '检查通过'
          : result.status === 'running'
            ? '检查中'
            : '检查未通过'}
        {result.config_version !== version ? ' · 旧配置结果' : ''}
      </strong>
      <p>{result.summary}</p>
      <small>
        {formatDateTime(result.checkedAt)} · 耗时 {(result.elapsed_ms / 1000).toFixed(1)} 秒
      </small>
    </div>
  );
}

export default function ImageServiceSettings({ api, onSaved, initialConfig }) {
  const [config, setConfig] = useState(null),
    [form, setForm] = useState(null),
    [mode, setMode] = useState(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [result, setResult] = useState(null);
  const locked = busy || checking;
  const load = () =>
    api('chapter-images/config')
      .then((c) => {
        setConfig(c);
        setResult(c.latestCheck || null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
      setResult(initialConfig.latestCheck || null);
      return;
    }
    let live = true;
    api('chapter-images/config')
      .then((c) => {
        if (live) {
          setConfig(c);
          setResult(c.latestCheck || null);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [initialConfig]);
  const change = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  };
  const open = (nextMode) => {
    setError('');
    setMode(nextMode);
    setForm({ ...config, apiKey: '' });
  };
  const close = () => {
    if (locked) return;
    setForm(null);
    setMode(null);
    setError('');
  };
  const payload = () => ({
    enabled: form.enabled,
    model: form.model.trim(),
    dailyLimit: Number(form.dailyLimit),
    apiKey: form.apiKey.trim(),
    version: form.version,
  });
  async function save(e) {
    e.preventDefault();
    if (locked) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api('chapter-images/config', { method: 'PUT', body: payload() });
      setConfig(saved);
      setForm(null);
      setMode(null);
      setResult(null);
      onSaved('章节配图配置已保存');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function check(e) {
    e.preventDefault();
    if (locked) return;
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const checked = await api('chapter-images/check', {
        method: 'POST',
        body: { ...payload(), acknowledgeCost: true },
      });
      setResult({ ...checked, config_version: form.version });
    } catch (e) {
      setError(e.message);
    } finally {
      try {
        const fresh = await api('chapter-images/config');
        setConfig(fresh);
      } catch {}
      setChecking(false);
    }
  }
  return (
    <>
      <section className="service-card service-profiles">
        <header>
          <div>
            <h2>章节自动配图</h2>
            <p>Seedream 5.0 Flash · 按章节主题生成淡彩水墨插画</p>
          </div>
          <span className={`admin-badge ${config?.configured ? 'good' : 'neutral'}`}>
            {!config
              ? '加载中'
              : !config.enabled
                ? '已暂停'
                : config.configured
                  ? '已启用'
                  : '待配置'}
          </span>
        </header>
        {config ? (
          <>
            <dl>
              <dt>生图模型</dt>
              <dd>{config.model}</dd>
              <dt>每日请求上限</dt>
              <dd>{config.dailyLimit} 次</dd>
              <dt>今日已用</dt>
              <dd>
                {Number.isFinite(config.todayRequests)
                  ? `${config.todayRequests} 次 · 剩余 ${config.remainingRequests} 次`
                  : '—'}
                <small className="image-usage-date">{config.usageDate || ''} · 每日零点重置</small>
              </dd>
              <dt>API 密钥</dt>
              <dd>{config.secretConfigured ? '已设置' : '未设置'}</dd>
            </dl>
            <p className="service-muted">
              首次打开章节时后台生成，完成后保存复用。仅发送课程名、章节名，不发送资料正文。失败最多自动尝试三次。
            </p>
            <div className="service-section-title">最近连接检查</div>
            {checking ? (
              <p className="service-muted" role="status">
                正在检查…
              </p>
            ) : (
              <ConnectionResult result={result} version={config.version} />
            )}
            <footer>
              <button disabled={locked} onClick={() => open('edit')}>
                修改配置
              </button>
              <button
                className="admin-primary"
                disabled={locked || !config.secretConfigured}
                onClick={() => open('check')}
              >
                检查连接
              </button>
            </footer>
          </>
        ) : (
          <button onClick={load}>重新加载配置</button>
        )}
        {error && !form && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
      </section>
      {form && (
        <AdminDialog
          title={mode === 'edit' ? '章节配图配置' : '检查章节配图连接'}
          className="service-dialog"
          onClose={close}
          locked={locked}
          dirty={
            mode === 'edit' &&
            Boolean(
              form.apiKey ||
                form.enabled !== config.enabled ||
                form.model !== config.model ||
                Number(form.dailyLimit) !== config.dailyLimit,
            )
          }
        >
          <form onSubmit={mode === 'edit' ? save : check}>
            <h2>{mode === 'edit' ? '章节配图配置' : '检查章节配图连接'}</h2>
            {mode === 'edit' ? (
              <>
                <label className="service-switch">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={form.enabled}
                    onChange={(e) => change('enabled', e.target.checked)}
                  />
                  启用自动配图
                </label>
                <label>
                  生图模型
                  <input
                    disabled={locked}
                    required
                    value={form.model}
                    onChange={(e) => change('model', e.target.value)}
                  />
                </label>
                <label>
                  火山引擎 API Key
                  <input
                    disabled={locked}
                    type="password"
                    autoComplete="new-password"
                    value={form.apiKey}
                    onChange={(e) => change('apiKey', e.target.value)}
                    placeholder={form.secretConfigured ? '留空保留现有密钥' : '请输入生图 API 密钥'}
                  />
                </label>
                <label>
                  每日请求上限
                  <input
                    disabled={locked}
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={form.dailyLimit}
                    onChange={(e) => change('dailyLimit', e.target.value)}
                  />
                </label>
                <p className="service-muted">
                  密钥加密保存在后端。保存后可点击“检查连接”验证实际生图响应。图片按实际生成计费，达到每日上限后等待次日。
                </p>
              </>
            ) : (
              <>
                <p className="service-muted">使用已保存的模型：{form.model}</p>
                <p className="service-muted">
                  生成一张固定主题测试图，成功生成约 0.12
                  元，以服务商实际计费为准。计入每日上限，不保存测试图片，最多等待 120 秒。
                </p>
                {checking ? (
                  <p className="service-muted" role="status">
                    正在等待模型生成测试图片，请勿重复点击。
                  </p>
                ) : (
                  result && <ConnectionResult result={result} version={form.version} />
                )}
              </>
            )}
            {error && (
              <p role="alert" className="admin-error">
                {error}
              </p>
            )}
            <footer>
              <AdminDialogClose disabled={locked}>取消</AdminDialogClose>
              <button className="admin-primary" disabled={locked}>
                {busy ? '保存中…' : checking ? '正在检查…' : mode === 'edit' ? '保存' : '开始检查'}
              </button>
            </footer>
          </form>
        </AdminDialog>
      )}
    </>
  );
}
