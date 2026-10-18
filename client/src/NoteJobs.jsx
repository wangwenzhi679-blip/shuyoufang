import React, { useEffect, useState } from 'react';
import { noteRequest } from './note-api';
export function useNoteJobs(token) {
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      noteRequest(token, 'notes/jobs')
        .then((data) => {
          if (live) setJobs(data.jobs);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 4000);
    window.addEventListener('note-jobs-changed', load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('note-jobs-changed', load);
    };
  }, [token]);
  return jobs;
}
export function NoteTaskTray({ token, onOpen, onFix }) {
  const jobs = useNoteJobs(token);
  const [error, setError] = useState('');
  const act = async (job, cancel) => {
    try {
      setError('');
      if (cancel) await noteRequest(token, `notes/jobs/${job.id}/cancel`, { method: 'POST' });
      else {
        const base = `courses/${job.course_id}/chapters/${job.chapter_id}/note`;
        const { note } = await noteRequest(token, base);
        await noteRequest(
          token,
          `${base}/${job.input_json.mode === 'generate' ? 'generate' : 'organize'}`,
          { method: 'POST', body: { ...job.input_json, version: note.version } },
        );
        await noteRequest(token, `notes/jobs/${job.id}/dismiss`, { method: 'POST' });
      }
      window.dispatchEvent(new Event('note-jobs-changed'));
    } catch (e) {
      setError(e.message);
    }
  };
  if (!jobs.length) return null;
  return (
    <details className="note-task-tray">
      <summary>
        笔记任务 · {jobs.length}
        <span role="status">
          {jobs.some((job) => job.status === 'running')
            ? '正在生成'
            : jobs.some((job) => job.status !== 'done')
              ? '需要处理'
              : '已完成'}
        </span>
      </summary>
      {error && <p role="alert">{error}</p>}
      {jobs.map((job) => (
        <div key={job.id}>
          <span>
            {job.chapter_title} ·{' '}
            {job.status === 'running'
              ? job.progress_text || 'AI 正在处理'
              : job.status === 'done'
                ? '笔记结果已完成'
                : job.error_text}
          </span>
          {job.status === 'running' && <button onClick={() => act(job, true)}>取消</button>}
          {['failed', 'cancelled'].includes(job.status) && (
            <button onClick={() => act(job, false)}>重试</button>
          )}
          {job.status === 'failed' && job.error_text?.includes('未识别的公式') && (
            <button onClick={() => onFix(job.course_id, job.chapter_id)}>修正资料</button>
          )}
          {job.status === 'done' && (
            <button onClick={() => onOpen(job.course_id, job.chapter_id)}>查看结果</button>
          )}
          {job.status !== 'running' && (
            <button
              aria-label="关闭笔记任务"
              onClick={async () => {
                await noteRequest(token, `notes/jobs/${job.id}/dismiss`, { method: 'POST' });
                window.dispatchEvent(new Event('note-jobs-changed'));
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
