import { useEffect, useRef, useState } from 'react';
import { requestJson as request } from './api-client.mjs';
import { uploadFiles } from './student-api.mjs';

export function useMaterialImports(token, onDone) {
  const [jobs, setJobs] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const complete = useRef(onDone);
  complete.current = onDone;
  const observed = useRef(new Set());
  const refresh = async () => {
    const data = await request('material-import-jobs', { token });
    setJobs(data.jobs);
    for (const job of data.jobs)
      if (job.status === 'done' && !observed.current.has(job.id)) {
        await complete.current(job.course_id);
        observed.current.add(job.id);
      }
  };
  useEffect(() => {
    observed.current.clear();
    let alive = true;
    const poll = () => {
      if (alive) refresh().catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);
  const sending = transfers.some((job) => job.status === 'uploading');
  useEffect(() => {
    if (!sending) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sending]);

  const send = async (job) => {
    setTransfers((current) =>
      current.map((item) =>
        item.id === job.id ? { ...item, status: 'uploading', error_text: '' } : item,
      ),
    );
    try {
      await uploadFiles(`courses/${job.course_id}/materials?background=1`, {
        token,
        files: job.files,
        importKey: job.id,
      });
      setTransfers((current) => current.filter((item) => item.id !== job.id));
      await refresh().catch(() => {});
    } catch (reason) {
      setTransfers((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, status: 'failed', error_text: reason.message } : item,
        ),
      );
    }
  };
  return {
    jobs: [...transfers, ...jobs],
    upload(courseId, title, files) {
      const job = {
        id: `upload-${Date.now()}-${Math.random()}`,
        local: true,
        course_id: courseId,
        course_title: title,
        files,
        status: 'uploading',
      };
      setTransfers((current) => [job, ...current]);
      void send(job);
    },
    async act(job, action) {
      if (job.local) {
        if (action === 'retry') return send(job);
        setTransfers((current) => current.filter((item) => item.id !== job.id));
        return;
      }
      await request(`material-import-jobs/${job.id}/${action}`, { token, method: 'POST' });
      await refresh();
    },
  };
}

export function MaterialImportTasks({ jobs, onAction, onOpen, onError }) {
  if (!jobs.length) return null;
  const act = (job, action) => onAction(job, action).catch((error) => onError(error.message));
  return (
    <details className="generation-tray" open>
      <summary>
        资料导入 · {jobs.length}
        <span>可继续浏览其他页面</span>
      </summary>
      {jobs.map((job) => (
        <div key={job.id}>
          <div>
            <strong>{job.course_title}</strong>
            <span role="status">
              {job.status === 'uploading'
                ? '正在上传，可在站内继续浏览；上传完成前请勿刷新'
                : job.status === 'failed'
                  ? job.error_text || '导入失败'
                  : job.progress_text || '等待导入'}
            </span>
          </div>
          {job.status === 'failed' && <button onClick={() => act(job, 'retry')}>重试</button>}
          {job.status === 'done' && (
            <>
              <button onClick={() => onOpen(job.course_id)}>查看课程</button>
              <button aria-label="关闭导入任务" onClick={() => act(job, 'dismiss')}>
                ×
              </button>
            </>
          )}
          {job.local && job.status === 'failed' && (
            <button aria-label="关闭上传任务" onClick={() => act(job, 'dismiss')}>
              ×
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
