import React, { useEffect, useState } from 'react';
import AdminDialog, { AdminDialogClose } from './AdminDialog.jsx';
import { formatDateTime } from './date-format.mjs';

const bytes = (value) =>
  Number(value) >= 1048576
    ? `${(Number(value) / 1048576).toFixed(1)} MB`
    : `${(Number(value || 0) / 1024).toFixed(1)} KB`;
const status = (value) => (value === 'paused' ? '已暂停' : '正常');
const preview = (value) =>
  ({ ready: '预览文件存在', missing: '预览文件缺失', not_generated: '尚未生成预览' })[value] ||
  '未记录';
function Fields({ items }) {
  return (
    <dl className="admin-info">
      {items.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
function Pagination({ data, onChange, label }) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="admin-detail-pagination" aria-label={`${label}分页`}>
      <small>
        共 {data.total} 项 · 第 {data.page} / {totalPages} 页
      </small>
      <div>
        <button
          type="button"
          disabled={data.page <= 1}
          aria-label={`上一页${label}`}
          onClick={() => onChange(data.page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          disabled={data.page >= totalPages}
          aria-label={`下一页${label}`}
          onClick={() => onChange(data.page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
export default function AdminContentDetail({ source, id, api, onClose, onOpen, returnCourse }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [chapterPage, setChapterPage] = useState(1),
    [materialPage, setMaterialPage] = useState(1),
    [revision, setRevision] = useState(0);
  const title = source === 'course' ? '课程详情' : '资料详情';
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError('');
    const query = new URLSearchParams({
      chapterPage: String(chapterPage),
      materialPage: String(materialPage),
    });
    api(`content/${source}/${id}?${query}`, {}, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, id, chapterPage, materialPage, revision]);
  return (
    <AdminDialog title={title} onClose={onClose} className="admin-content-detail">
      <header className="admin-detail-heading">
        <div>
          <small>平台管理 · 只读查阅</small>
          <h2>{title}</h2>
        </div>
        <AdminDialogClose aria-label={`关闭${title}`}>关闭</AdminDialogClose>
      </header>
      {loading && (
        <p role="status" className="admin-muted">
          正在读取…
        </p>
      )}
      {error && (
        <div role="alert" className="admin-error">
          {error}
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            重新读取
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="admin-detail-name">
            {source === 'course' ? data.course.title : data.material.original_name}
          </p>
          <Fields
            items={[
              ['所属账户', `${data.owner.account} · ${data.owner.nickname}`],
              ['账户状态', data.owner.status === 'active' ? '正常' : '已停用'],
              [
                '管理状态',
                status(source === 'course' ? data.course.admin_status : data.material.admin_status),
              ],
              [
                '创建时间',
                formatDateTime(
                  source === 'course' ? data.course.created_at : data.material.created_at,
                ),
              ],
              [
                '最近处理原因',
                (source === 'course' ? data.course : data.material).admin_reason || '无',
              ],
              [
                '最近处理时间',
                (source === 'course' ? data.course : data.material).admin_changed_at
                  ? formatDateTime(
                      (source === 'course' ? data.course : data.material).admin_changed_at,
                    )
                  : '未记录',
              ],
            ]}
          />
          {source === 'course' ? (
            <>
              {data.course.description && (
                <p className="admin-detail-description">{data.course.description}</p>
              )}
              <section className="admin-detail-section">
                <h3>
                  章节目录 <small>{data.chapters.total} 章</small>
                </h3>
                {data.chapters.items.length ? (
                  <ol
                    className="admin-chapter-directory"
                    start={(data.chapters.page - 1) * data.chapters.pageSize + 1}
                  >
                    {data.chapters.items.map((chapter) => (
                      <li key={chapter.id}>
                        <strong>{chapter.title}</strong>
                        <span>{chapter.completed_at ? '已完成阅读' : '尚未完成阅读'}</span>
                        {chapter.description && (
                          <details>
                            <summary>章节说明</summary>
                            <p>{chapter.description}</p>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="admin-muted">暂无章节记录</p>
                )}
                <Pagination data={data.chapters} onChange={setChapterPage} label="章节" />
              </section>
              <section className="admin-detail-section">
                <h3>
                  课程资料 <small>{data.materials.total} 份</small>
                </h3>
                {data.materials.items.length ? (
                  <ul className="admin-material-directory">
                    {data.materials.items.map((material) => (
                      <li key={material.id}>
                        <div>
                          <strong>{material.original_name}</strong>
                          <small>
                            {bytes(material.size_bytes)} · {status(material.admin_status)} ·{' '}
                            {material.original_exists ? '原文件存在' : '原文件缺失'} ·{' '}
                            {preview(material.preview_status)}
                          </small>
                        </div>
                        <button type="button" onClick={() => onOpen('material', material.id, id)}>
                          查看资料
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-muted">暂无资料记录</p>
                )}
                <Pagination data={data.materials} onChange={setMaterialPage} label="资料" />
              </section>
            </>
          ) : (
            <>
              <Fields
                items={[
                  ['所属课程', data.course.title],
                  ['课程状态', status(data.course.admin_status)],
                  ['文件类型', data.material.mime_type || '未记录'],
                  ['文件大小', bytes(data.material.size_bytes)],
                  ['原文件', data.material.original_exists ? '存在' : '缺失'],
                  ['预览状态', preview(data.material.preview_status)],
                  ['提取字数', `${data.material.text_length} 字`],
                ]}
              />
              {data.repair && (
                <section className="admin-detail-section">
                  <h3>最近预览修复</h3>
                  <p>
                    {{ running: '正在修复', done: '已完成', failed: '未完成' }[
                      data.repair.status
                    ] || data.repair.status}{' '}
                    · {formatDateTime(data.repair.updated_at || data.repair.created_at)}
                  </p>
                  {data.repair.error_text && (
                    <p className="admin-muted">{data.repair.error_text}</p>
                  )}
                </section>
              )}
              <section className="admin-detail-section">
                <h3>提取文字摘要{data.material.text_length > 2000 && <small>前 2000 字</small>}</h3>
                {data.material.text_excerpt ? (
                  <pre className="admin-text-excerpt">{data.material.text_excerpt}</pre>
                ) : (
                  <p className="admin-muted">尚未提取到文字，可检查原文件及转换状态。</p>
                )}
              </section>
            </>
          )}
        </>
      )}
      <footer>
        {returnCourse && (
          <button type="button" onClick={() => onOpen('course', returnCourse)}>
            ← 返回课程详情
          </button>
        )}
        <AdminDialogClose>关闭</AdminDialogClose>
      </footer>
    </AdminDialog>
  );
}
