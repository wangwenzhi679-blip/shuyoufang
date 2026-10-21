import { RenameMaterialModal } from './CourseDialogs.jsx';
import { requestJson as request } from './api-client.mjs';
import PaperDialog from './PaperDialog.jsx';
import { formatDateTime } from './date-format.mjs';
import { useState } from 'react';
import { api } from './student-api.mjs';
import { MaterialImportTasks } from './MaterialImportTasks.jsx';

export function ShelfLibraryModal({
  materialImports,
  token,
  courseData,
  onChange,
  onClose,
  onReloadCourses,
  onReadMaterial,
  onConfirmDelete,
  onError,
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const cId = courseData.course.id;
  const upload = async (files) => {
    materialImports.upload(cId, courseData.course.title, files);
  };
  const previewText = async (material) => {
    try {
      const data = await request(`courses/${cId}/materials/${material.id}`, { token });
      if (data?.material) setPreview(data.material);
    } catch (reason) {
      onError(reason.message);
    }
  };
  const downloadFile = async (material) => {
    try {
      const response = await fetch(`${api}courses/${cId}/materials/${material.id}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '无法打开原文件');
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      onError(reason.message);
    }
  };
  const saveRename = async (material, originalName) => {
    try {
      const data = await request(`courses/${cId}/materials/${material.id}`, {
        token,
        method: 'PUT',
        body: { originalName },
      });
      onChange((current) =>
        current
          ? {
              ...current,
              materials: current.materials.map((item) =>
                item.id === material.id
                  ? { ...item, original_name: data.material.original_name }
                  : item,
              ),
            }
          : current,
      );
    } catch (reason) {
      onError(reason.message);
    }
  };
  const removeMaterial = (material) => {
    onConfirmDelete({
      eyebrow: '资料管理',
      title: '删除资料？',
      message: `确定删除“${material.original_name}”吗？目录草稿也会清除。`,
      confirmText: '删除资料',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await request(`courses/${cId}/materials/${material.id}`, {
            token,
            method: 'DELETE',
          });
          onChange((current) =>
            current
              ? {
                  ...current,
                  materials: current.materials.filter((item) => item.id !== material.id),
                }
              : current,
          );
          await onReloadCourses();
          if (result.cleanupFailed)
            onError('资料已删除，但原文件清理失败。请检查服务器对 E 盘资料目录的写入权限。');
        } catch (reason) {
          onError(reason.message);
        }
      },
    });
  };
  return (
    <>
      <div className="modal-backdrop library-overlay">
        <PaperDialog busy={uploading} onDismiss={onClose} className="library-dialog">
          <header className="library-dialog-header">
            <div className="library-title-row">
              <span className="library-symbol">▤</span>
              <div>
                <p>课程资料</p>
                <h2>资料库</h2>
                <small>{courseData.course.title}</small>
              </div>
            </div>
            <button
              className="library-close"
              type="button"
              onClick={onClose}
              aria-label="关闭资料库"
            >
              ×
            </button>
          </header>
          <div className="library-dialog-body">
            <div className="library-summary">
              <div>
                <strong>{courseData.materials?.length || 0}</strong>
                <span>份学习资料</span>
              </div>
              <label className="library-import">
                <input
                  type="file"
                  accept=".pdf,.docx,.pptx"
                  multiple
                  disabled={uploading}
                  aria-label="导入课程资料"
                  onChange={async (event) => {
                    const files = event.target.files;
                    if (!files?.length) return;
                    setUploadError('');
                    setUploading(true);
                    try {
                      await upload(files);
                      event.target.value = '';
                    } catch (reason) {
                      setUploadError(reason.message);
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
                {uploading ? '正在提交…' : '导入资料'}
              </label>
            </div>
            {uploadError && <p className="form-error">{uploadError}</p>}
            <MaterialImportTasks
              jobs={
                materialImports?.jobs.filter((job) => Number(job.course_id) === Number(cId)) || []
              }
              onAction={materialImports?.act}
              onOpen={onClose}
              onError={setUploadError}
            />
            {courseData.materials?.length ? (
              <div className="library-files">
                {courseData.materials.map((material) => (
                  <article className="library-file-card" key={material.id}>
                    <div className="library-file-info">
                      <span>文档</span>
                      <div>
                        <strong title={material.original_name}>{material.original_name}</strong>
                        <small>已提取 {material.text_length} 字</small>
                        {material.admin_status === 'paused' && (
                          <small className="content-paused-note">
                            已暂停 · {material.admin_reason} ·{' '}
                            {formatDateTime(material.admin_changed_at)}
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="library-file-actions">
                      <button className="library-read" onClick={() => onReadMaterial(material)}>
                        阅读
                      </button>
                      <button onClick={() => previewText(material)}>文字</button>
                      <button onClick={() => downloadFile(material)}>下载</button>
                      <button onClick={() => setRenameTarget(material)}>改名</button>
                      <button className="library-delete" onClick={() => removeMaterial(material)}>
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="library-empty-state">
                <span>▤</span>
                <strong>还没有学习资料</strong>
                <p>导入 PDF、Word 或 PPT 后，在这里统一阅读和管理。</p>
              </div>
            )}
          </div>
        </PaperDialog>
      </div>
      {renameTarget && (
        <RenameMaterialModal
          material={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={saveRename}
        />
      )}
      {preview && (
        <div className="modal-backdrop">
          <PaperDialog
            busy={uploading}
            onDismiss={() => setPreview(null)}
            className="record-modal material-preview"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">资料文字预览</p>
                <h2>{preview.original_name}</h2>
              </div>
              <button className="icon-close" onClick={() => setPreview(null)}>
                ×
              </button>
            </div>
            <pre>{preview.extracted_text}</pre>
          </PaperDialog>
        </div>
      )}
    </>
  );
}
