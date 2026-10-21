import { useEffect, useState } from 'react';
import { requestJson } from './api-client.mjs';
import { formatDateTime } from './date-format.mjs';
import WrongQuestionNote from './WrongQuestionNote.jsx';

export default function WrongReflections({ token, userId, courses, onOpen }) {
  const [course, setCourse] = useState(''),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState({ notes: [], total: 0, pageSize: 20 });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), q: query });
    if (course) params.set('courseId', course);
    setLoading(true);
    setError('');
    requestJson(`wrong-question-notes?${params}`, { token, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, course, page, query, revision]);
  return (
    <section className="wrong-reflections">
      <h2>学习心得</h2>
      <p>把错因与改进方法留作学习记录。这里汇总已保存的批注，已掌握题目的心得也会保留。</p>
      <form
        className="reflection-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(search.trim());
          setRevision((value) => value + 1);
        }}
      >
        <label>
          课程
          <select
            value={course}
            onChange={(event) => {
              setCourse(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部课程</option>
            {courses.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索批注
          <input
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="题目、错因或心得关键词"
          />
        </label>
        <button type="submit">查找</button>
      </form>
      {loading ? (
        <p role="status">正在读取学习记录…</p>
      ) : error ? (
        <p className="form-error" role="alert">
          {error} <button onClick={() => setRevision((value) => value + 1)}>重试</button>
        </p>
      ) : (
        <>
          <p>共 {data.total} 条学习记录</p>
          {!data.notes.length && (
            <p className="reflection-empty">
              {query || course
                ? '没有符合条件的心得，试试其他关键词或课程。'
                : '还没有保存的批注。答错后记录错因和学习心得，就会汇总在这里。'}
            </p>
          )}
          {data.notes.map((note) => (
            <article className="reflection-record" key={note.wrong_question_id}>
              <small>
                {note.course_title} · {note.chapter_title} · {formatDateTime(note.updated_at)}
              </small>
              <h3>{note.question_text}</h3>
              {note.reason && (
                <div>
                  <strong>错因批注</strong>
                  <p>{note.reason}</p>
                </div>
              )}
              {note.takeaway && (
                <div>
                  <strong>学习心得</strong>
                  <p>{note.takeaway}</p>
                </div>
              )}
              <button type="button" onClick={() => onOpen(note.wrong_question_id)}>
                回看原题
              </button>
              <WrongQuestionNote
                key={`${note.question_id}:${note.version}`}
                token={token}
                userId={userId}
                questionId={note.question_id}
                onSaved={() => setRevision((value) => value + 1)}
              />
            </article>
          ))}
          <nav className="reflection-pagination" aria-label="学习心得分页">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              上一页
            </button>
            <span>第 {page} 页</span>
            <button
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
