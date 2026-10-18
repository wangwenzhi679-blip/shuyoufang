import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import ImageServiceSettings from './ImageServiceSettings.jsx';
import React, { useEffect, useState } from 'react';
import { formatDateTime } from './date-format.mjs';
const names = { ai: 'AI 服务', mail: '邮件服务', mail_send: '测试邮件' };
function CheckResult({ check, version }) {
  if (!check) return <p className="service-muted">尚未检查</p>;
  return (
    <div
      className={`service-result ${check.status === 'done' ? 'good' : check.status === 'running' ? 'neutral' : 'bad'}`}
    >
      <strong>
        {check.status === 'done'
          ? '检查通过'
          : check.status === 'running'
            ? '检查中'
            : '检查未通过'}
        {check.config_version !== version ? ' · 旧配置结果' : ''}
      </strong>
      <p>{check.summary || (check.status === 'running' ? '正在连接服务…' : '')}</p>
      <small>
        {formatDateTime(check.finished_at || check.created_at)}
        {check.elapsed_ms != null ? ` · ${check.elapsed_ms} ms` : ''}
      </small>
    </div>
  );
}
export default function Services({ data: initialData, api, onSaved }) {
  const [data, setData] = useState(initialData),
    [pollError, setPollError] = useState('');
  useEffect(() => {
    setData(initialData);
    setPollError('');
    if (!initialData.checking.length) return;
    let alive = true,
      timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await api('services', {}, controller.signal);
        if (!alive) return;
        setData(next);
        setPollError('');
        if (next.checking.length) timer = setTimeout(poll, 2000);
      } catch (error) {
        if (alive) {
          setPollError('暂时无法更新检查结果，请刷新查看');
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [initialData]);
  const [modal, setModal] = useState(null),
    [form, setForm] = useState({}),
    [initialForm, setInitialForm] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const change = (key, value) => setForm((state) => ({ ...state, [key]: value }));
  const clearModal = () => {
    setModal(null);
    setForm({});
    setInitialForm({});
  };
  const close = () => {
    if (!busy) {
      clearModal();
      setError('');
    }
  };
  const modalTitle = !modal
    ? ''
    : modal.type === 'delete'
      ? '删除 API'
      : modal.type === 'create'
        ? '添加 API'
        : modal.type === 'activate'
          ? '切换 AI 服务'
          : modal.type === 'edit'
            ? `修改${names[modal.kind] || 'AI 服务'}配置`
            : modal.kind === 'mail_send'
              ? '发送测试邮件'
              : `检查${names[modal.kind] || 'AI 服务'}`;
  const dirty = Boolean(modal && JSON.stringify(form) !== JSON.stringify(initialForm));
  function open(type, kind) {
    setError('');
    setNotice('');
    const profile = data.profiles?.find((p) => p.id === kind);
    const next =
      type === 'edit'
        ? { ...(profile || data[kind]), apiKey: '', password: '' }
        : type === 'create'
          ? { enabled: true, name: '', baseUrl: '', model: '', timeoutMs: 60000, apiKey: '' }
          : { to: '' };
    setForm(next);
    setInitialForm(next);
    setModal({ type, kind });
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (modal.type === 'delete') {
        const profile = data.profiles.find((p) => p.id === modal.kind);
        await api(`services/profiles/${profile.id}`, {
          method: 'DELETE',
          body: { version: profile.version },
        });
        clearModal();
        onSaved('API 配置已删除');
      } else if (modal.type === 'activate') {
        const profile = data.profiles.find((p) => p.id === modal.kind);
        await api(`services/profiles/${profile.id}/activate`, {
          method: 'POST',
          body: { version: data.ai.version, profileVersion: profile.version },
        });
        clearModal();
        onSaved('已切换 AI 服务');
      } else if (modal.type === 'edit' || modal.type === 'create') {
        const kind = modal.kind;
        const body =
          kind !== 'mail'
            ? {
                enabled: form.enabled,
                name: form.name,
                baseUrl: form.baseUrl,
                model: form.model,
                timeoutMs: Number(form.timeoutMs),
                apiKey: form.apiKey,
                version: form.version,
              }
            : {
                enabled: form.enabled,
                host: form.host,
                port: Number(form.port),
                secure: form.secure,
                user: form.user,
                from: form.from,
                password: form.password,
                version: form.version,
              };
        await api(modal.type === 'create' ? 'services/profiles' : `services/${kind}`, {
          method: modal.type === 'create' ? 'POST' : 'PUT',
          body,
        });
        clearModal();
        onSaved('服务配置已保存');
      } else {
        const base = modal.kind === 'mail_send' ? 'mail' : modal.kind;
        const result = await api(`services/${modal.kind}/check`, {
          method: 'POST',
          body: {
            version: (data[base] || data.profiles.find((p) => p.id === base)).version,
            ...(modal.kind === 'mail_send' ? { to: form.to } : {}),
          },
        });
        setNotice(result.summary);
        clearModal();
        onSaved(result.summary);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="service-page-intro">
        <p>管理连接配置，检查实际响应。</p>
        <span>后端在线 · 数据库已连接</span>
      </div>
      <div className="service-grid">
        {['ai', 'mail'].map((kind) => {
          const config = data[kind];
          return (
            <section className="service-card" key={kind}>
              <header>
                <div className={`service-icon ${kind}`}>{kind === 'ai' ? 'AI' : '@'}</div>
                <div>
                  <h2>{names[kind]}</h2>
                  <p>{kind === 'ai' ? config.name || 'AI 接口' : 'SMTP 邮件发送'}</p>
                </div>
                <span className={`admin-badge ${config.configured ? 'good' : 'neutral'}`}>
                  {!config.enabled ? '已暂停' : config.configured ? '已配置' : '未配置'}
                </span>
              </header>
              <dl>
                <dt>{kind === 'ai' ? '接口' : '服务器'}</dt>
                <dd>{kind === 'ai' ? config.baseUrl : config.host || '未填写'}</dd>
                <dt>{kind === 'ai' ? '默认模型' : '发件邮箱'}</dt>
                <dd>{kind === 'ai' ? config.model : config.from || '未填写'}</dd>
                <dt>{kind === 'ai' ? '请求超时' : '端口 / 加密'}</dt>
                <dd>
                  {kind === 'ai'
                    ? `${config.timeoutMs / 1000} 秒`
                    : `${config.port} / ${config.secure ? 'SSL/TLS' : 'STARTTLS'}`}
                </dd>
                <dt>{kind === 'ai' ? 'API 密钥' : '授权码'}</dt>
                <dd>{config.secretConfigured ? '已设置' : '未设置'}</dd>
              </dl>
              <div className="service-section-title">最近连接检查</div>
              <CheckResult check={data.latest[kind]} version={config.version} />
              {kind === 'mail' && (
                <>
                  <div className="service-section-title">最近测试发送</div>
                  <CheckResult check={data.latest.mail_send} version={config.version} />
                </>
              )}
              <footer>
                <button onClick={() => open('edit', kind)}>修改配置</button>
                <button
                  className="admin-primary"
                  disabled={busy || !config.configured || data.checking.includes(kind)}
                  onClick={() => open('check', kind)}
                >
                  检查连接
                </button>
                {kind === 'mail' && (
                  <button
                    disabled={
                      busy ||
                      !config.configured ||
                      data.checking.includes(kind) ||
                      data.checking.includes('mail_send')
                    }
                    onClick={() => open('check', 'mail_send')}
                  >
                    发送测试
                  </button>
                )}
              </footer>
            </section>
          );
        })}
      </div>
      <ImageServiceSettings initialConfig={data.chapterImages} api={api} onSaved={onSaved} />
      <section className="service-card service-profiles">
        <header>
          <div>
            <h2>已保存的 API</h2>
            <p>兼容 Chat Completions 格式</p>
          </div>
          <button onClick={() => open('create', 'ai')}>添加 API</button>
        </header>
        {!data.profiles?.length && <p className="service-muted">添加其他服务后，可随时切换。</p>}
        {data.profiles?.map((p) => (
          <div className="service-profile" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              {p.current && <span className="admin-badge good service-current">正在使用</span>}
              {!p.enabled && <span className="admin-badge neutral service-current">已暂停</span>}
              <p>
                {p.model} · {p.baseUrl}
              </p>
              <CheckResult check={data.latest[p.id]} version={p.version} />
            </div>
            <div>
              <button onClick={() => open('edit', p.id)}>修改</button>
              <button
                disabled={!p.configured || busy || data.checking.includes(p.id)}
                onClick={() => open('check', p.id)}
              >
                检查
              </button>
              <button
                disabled={!p.configured || busy || p.current}
                onClick={() => open('activate', p.id)}
              >
                {p.current ? '已使用' : '使用'}
              </button>
              <button
                disabled={busy || p.current || data.checking.includes(p.id)}
                onClick={() => open('delete', p.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </section>
      {pollError && (
        <p className="service-muted" role="status">
          {pollError}
        </p>
      )}
      {notice && (
        <p className="service-muted" role="status">
          {notice}
        </p>
      )}
      {modal && (
        <AdminDialog
          title={modalTitle}
          className="service-dialog"
          locked={busy}
          dirty={dirty}
          onClose={close}
        >
          <form onSubmit={submit}>
            <h2>{modalTitle}</h2>
            {modal.type === 'edit' || modal.type === 'create' ? (
              <>
                <label className="service-switch">
                  <input
                    disabled={busy}
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => change('enabled', e.target.checked)}
                  />
                  启用服务
                </label>
                {modal.kind !== 'mail' && modal.kind !== 'mail_send' ? (
                  <>
                    <label>
                      服务名称
                      <input
                        disabled={busy}
                        required
                        maxLength={60}
                        value={form.name || ''}
                        onChange={(e) => change('name', e.target.value)}
                      />
                    </label>
                    <label>
                      API 地址
                      <input
                        disabled={busy}
                        required
                        type="url"
                        placeholder="https://服务域名/v1"
                        value={form.baseUrl || ''}
                        onChange={(e) => change('baseUrl', e.target.value)}
                      />
                    </label>
                    <label>
                      默认模型
                      <input
                        disabled={busy}
                        required
                        maxLength={80}
                        value={form.model}
                        onChange={(e) => change('model', e.target.value)}
                      />
                    </label>
                    <label>
                      超时时间（秒）
                      <input
                        disabled={busy}
                        type="number"
                        required
                        min={5}
                        max={180}
                        value={form.timeoutMs / 1000}
                        onChange={(e) => change('timeoutMs', Number(e.target.value) * 1000)}
                      />
                    </label>
                    <label>
                      API 密钥
                      <input
                        disabled={busy}
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          form.secretConfigured ? '已设置，留空保持原值' : '填写 API 密钥'
                        }
                        value={form.apiKey}
                        onChange={(e) => change('apiKey', e.target.value)}
                      />
                    </label>
                    <p className="service-muted">
                      填写服务商提供的 HTTPS 地址与模型名称。更换地址时需重新填写密钥。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="service-form-pair">
                      <label>
                        SMTP 服务器
                        <input
                          disabled={busy}
                          required
                          value={form.host}
                          onChange={(e) => change('host', e.target.value)}
                        />
                      </label>
                      <label>
                        端口
                        <select
                          disabled={busy}
                          value={form.port}
                          onChange={(e) => {
                            change('port', Number(e.target.value));
                            change('secure', Number(e.target.value) === 465);
                          }}
                        >
                          {[465, 587, 25, 2525].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="service-switch">
                      <input
                        disabled={busy}
                        type="checkbox"
                        checked={form.secure}
                        onChange={(e) => change('secure', e.target.checked)}
                      />
                      SSL/TLS（关闭时使用 STARTTLS）
                    </label>
                    <label>
                      SMTP 账号
                      <input
                        disabled={busy}
                        required
                        value={form.user}
                        onChange={(e) => change('user', e.target.value)}
                      />
                    </label>
                    <label>
                      发件邮箱
                      <input
                        disabled={busy}
                        required
                        type="email"
                        value={form.from}
                        onChange={(e) => change('from', e.target.value)}
                      />
                    </label>
                    <label>
                      密码 / 授权码
                      <input
                        disabled={busy}
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          form.secretConfigured ? '已设置，留空保持原值' : '填写邮件授权码'
                        }
                        value={form.password}
                        onChange={(e) => change('password', e.target.value)}
                      />
                    </label>
                    <p className="service-muted">配置保存后用于验证码和测试邮件发送。</p>
                  </>
                )}
              </>
            ) : modal.type === 'delete' ? (
              <p className="service-muted">
                删除“{data.profiles.find((p) => p.id === modal.kind)?.name}
                ”的配置与密钥，无法撤销。已有课程和聊天记录会保留。
              </p>
            ) : modal.type === 'activate' ? (
              <p className="service-muted">
                原配置会保留在 API 列表。切换后，新发起的问答和生成请求将使用此
                API。课程资料可能发送至该服务，请确认服务来源。
              </p>
            ) : (
              <>
                {modal.kind !== 'mail' && modal.kind !== 'mail_send' ? (
                  <p className="service-muted">
                    向当前模型发送一次简短请求，可能产生少量调用费用，最多等待 30 秒。
                  </p>
                ) : modal.kind === 'mail' ? (
                  <p className="service-muted">检查服务器连接及身份验证。此次检查不发送邮件。</p>
                ) : (
                  <>
                    <p className="service-muted">
                      发送一封测试邮件到指定邮箱。服务器接受发送后，仍需在收件箱确认送达。
                    </p>
                    <label>
                      测试收件邮箱
                      <input
                        disabled={busy}
                        autoFocus
                        required
                        type="email"
                        value={form.to}
                        onChange={(e) => change('to', e.target.value)}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="admin-error">
                {error}
              </p>
            )}
            <footer>
              <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
              <button className="admin-primary" disabled={busy}>
                {busy
                  ? '处理中…'
                  : modal.type === 'edit' || modal.type === 'create'
                    ? '保存'
                    : modal.type === 'delete'
                      ? '确认删除'
                      : modal.type === 'activate'
                        ? '确认使用'
                        : modal.kind === 'mail_send'
                          ? '发送'
                          : '开始检查'}
              </button>
            </footer>
          </form>
        </AdminDialog>
      )}
    </>
  );
}
