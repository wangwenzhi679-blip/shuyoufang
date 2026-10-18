import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import React, { useState } from 'react';
import { formatDateTime } from './date-format.mjs';

const draftFields = (value) => ({
  title: value?.title || '',
  body: value?.body || '',
  placement: value?.placement || 'home',
  endsAt: value?.endsAt || '',
});
const states = { draft: '草稿', published: '已发布', withdrawn: '已下架' };
const verbs = { publish: '发布', withdraw: '下架', delete: '删除', restore: '恢复' };
const dateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export default function Announcements({ data, api, onSaved }) {
  const [initialEditor, setInitialEditor] = useState(null),
    [editor, setEditor] = useState(null),
    [action, setAction] = useState(null),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const open = (item) => {
    setError('');
    setPreview(false);
    const next = item
      ? { ...item, endsAt: dateInput(item.ends_at) }
      : { title: '', body: '', placement: 'home', endsAt: '' };
    setInitialEditor(draftFields(next));
    setEditor(next);
  };
  const close = () => {
    if (!busy) {
      setEditor(null);
      setInitialEditor(null);
      setAction(null);
      setError('');
    }
  };
  const dirty = Boolean(
    editor && JSON.stringify(draftFields(editor)) !== JSON.stringify(initialEditor),
  );

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        title: editor.title,
        body: editor.body,
        placement: editor.placement,
        endsAt: editor.endsAt ? new Date(editor.endsAt).toISOString() : null,
        ...(editor.id ? { version: editor.version } : {}),
      };
      await api(editor.id ? `announcements/${editor.id}` : 'announcements', {
        method: editor.id ? 'PATCH' : 'POST',
        body,
      });
      setEditor(null);
      setInitialEditor(null);
      onSaved('公告草稿已保存');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function act() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`announcements/${action.item.id}/action`, {
        method: 'POST',
        body: { version: action.item.version, action: action.type },
      });
      setAction(null);
      onSaved(`公告已${verbs[action.type]}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="admin-announcement-tools">
        <span className="admin-muted">发布后显示在指定页面；删除的公告可以恢复。</span>
        <button className="admin-primary" onClick={() => open(null)}>
          新建公告
        </button>
      </div>
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              {['标题', '展示位置', '状态', '发布时间', '结束时间', '操作'].map((name) => (
                <th key={name}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                </td>
                <td>{item.placement === 'home' ? '学习首页' : '登录页'}</td>
                <td>
                  {item.deleted_at
                    ? '已删除'
                    : item.status === 'published' &&
                        item.ends_at &&
                        new Date(item.ends_at).getTime() <= Date.now()
                      ? '已过期'
                      : states[item.status]}
                </td>
                <td>{item.published_at ? formatDateTime(item.published_at) : '未发布'}</td>
                <td>{item.ends_at ? formatDateTime(item.ends_at) : '长期显示'}</td>
                <td>
                  <div className="admin-inline-actions">
                    {item.deleted_at ? (
                      <button
                        onClick={() => {
                          setError('');
                          setAction({ item, type: 'restore' });
                        }}
                      >
                        恢复
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            open(item);
                            setPreview(true);
                          }}
                        >
                          预览
                        </button>
                        <button onClick={() => open(item)}>编辑</button>
                        <button
                          onClick={() => {
                            setError('');
                            setAction({
                              item,
                              type: item.status === 'published' ? 'withdraw' : 'publish',
                            });
                          }}
                        >
                          {item.status === 'published' ? '下架' : '发布'}
                        </button>
                        <button
                          className="admin-danger"
                          onClick={() => {
                            setError('');
                            setAction({ item, type: 'delete' });
                          }}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length && <p className="admin-empty">没有符合条件的公告</p>}
      </div>
      {editor && (
        <AdminDialog
          className="admin-announcement-dialog"
          title={preview ? '公告预览' : editor.id ? '编辑公告' : '新建公告'}
          locked={busy}
          dirty={dirty}
          onClose={close}
        >
          <h2>{preview ? '公告预览' : editor.id ? '编辑公告' : '新建公告'}</h2>
          {preview ? (
            <>
              <article className="admin-announcement-preview">
                <h3>{editor.title || '未填写标题'}</h3>
                <p>{editor.body || '未填写正文'}</p>
                <small>
                  {editor.placement === 'home' ? '学习首页' : '登录页'}
                  {editor.endsAt ? ` · 至 ${formatDateTime(editor.endsAt)}` : ''}
                </small>
              </article>
              <footer>
                <AdminDialogClose>关闭</AdminDialogClose>
                <button onClick={() => setPreview(false)}>返回编辑</button>
              </footer>
            </>
          ) : (
            <form onSubmit={save}>
              <label>
                标题
                <input
                  disabled={busy}
                  aria-describedby="announcement-title-count"
                  autoFocus
                  required
                  maxLength={100}
                  value={editor.title}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                />
              </label>
              <small id="announcement-title-count" className="admin-form-count">
                {editor.title.length} / 100
              </small>
              <label>
                正文
                <textarea
                  disabled={busy}
                  aria-describedby="announcement-body-count"
                  required
                  maxLength={5000}
                  value={editor.body}
                  onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                />
              </label>
              <small id="announcement-body-count" className="admin-form-count">
                {editor.body.length} / 5000
              </small>
              <div className="admin-form-pair">
                <label>
                  展示位置
                  <select
                    disabled={busy}
                    aria-label="展示位置"
                    value={editor.placement}
                    onChange={(e) => setEditor({ ...editor, placement: e.target.value })}
                  >
                    <option value="home">学习首页</option>
                    <option value="login">登录页</option>
                  </select>
                </label>
                <label>
                  结束时间（可选）
                  <input
                    disabled={busy}
                    type="datetime-local"
                    value={editor.endsAt}
                    onInput={(e) => setEditor({ ...editor, endsAt: e.target.value })}
                    onChange={(e) => setEditor({ ...editor, endsAt: e.target.value })}
                  />
                </label>
              </div>
              <p className="admin-muted">
                保存为草稿，确认预览后再发布。编辑已发布公告会先撤回展示。
              </p>
              {error && (
                <p role="alert" className="admin-error">
                  {error}
                </p>
              )}
              <footer>
                <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
                <button type="button" disabled={busy} onClick={() => setPreview(true)}>
                  预览
                </button>
                <button
                  className="admin-primary"
                  disabled={busy || !editor.title.trim() || !editor.body.trim()}
                >
                  {busy ? '保存中…' : '保存草稿'}
                </button>
              </footer>
            </form>
          )}
        </AdminDialog>
      )}
      {action && (
        <AdminDialog title={`${verbs[action.type]}公告`} locked={busy} onClose={close}>
          <h2>{verbs[action.type]}公告</h2>
          <p>{action.item.title}</p>
          <p className="admin-muted">
            {
              {
                publish: '确认后会在指定页面公开展示正文。',
                withdraw: '下架后学习端不再展示，记录保留。',
                delete: '删除后不再展示，可在“已删除”中恢复。',
                restore: '恢复为草稿，需要重新发布才会展示。',
              }[action.type]
            }
          </p>
          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}
          <footer>
            <AdminDialogClose disabled={busy}>取消</AdminDialogClose>
            <button className="admin-primary" disabled={busy} onClick={act}>
              {busy ? '处理中…' : '确认'}
            </button>
          </footer>
        </AdminDialog>
      )}
    </>
  );
}
