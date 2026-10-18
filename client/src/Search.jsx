import { API_ROOT } from './api-base.mjs';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './search.css';
const names = { course: '课程', chapter: '章节', material: '资料', note: '笔记', wrong: '错题' };
export default function Search({ token, userId, courses, onOpen, onBack }) {
  const key = `math-search:${userId}`;
  const saved = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  };
  const initial = useRef(saved()).current;
  const [q, setQ] = useState(initial.q || ''),
    [type, setType] = useState(initial.type || 'all'),
    [courseId, setCourseId] = useState(initial.courseId || ''),
    [page, setPage] = useState(initial.page || 1),
    [data, setData] = useState({ results: [], total: 0 }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const area = useRef(null),
    restore = useRef(initial.scroll || 0);
  useEffect(() => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ q, type, courseId, page, scroll: restore.current }),
    );
  }, [q, type, courseId, page]);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setError('');
    setLoading(Boolean(q.trim()));
    setData({ results: [], total: 0 });
    const timer = setTimeout(async () => {
      if (!q.trim()) {
        setLoading(false);
        return;
      }
      try {
        const r = await fetch(
          `${API_ROOT}/search?${new URLSearchParams({ q, type, courseId, page })}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
        );
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || '搜索失败');
        if (live) setData(d);
      } catch (e) {
        if (live && e.name !== 'AbortError') setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, type, courseId, page, token]);
  useLayoutEffect(() => {
    if (!loading && data.results.length && area.current) {
      area.current.scrollTop = restore.current;
    }
  }, [loading, data]);
  const reset = () => {
    setPage(1);
    restore.current = 0;
  };
  const open = async (item) => {
    setError('');
    try {
      await onOpen(item);
    } catch (e) {
      setError(e.message || '内容已不可用，请重新搜索');
    }
  };
  return (
    <section className="global-search">
      <header>
        <button type="button" className="search-back" onClick={onBack}>
          ← 返回
        </button>
        <p>学习空间</p>
        <h1>搜索学习内容</h1>
      </header>
      <div className="search-controls">
        <input
          aria-label="搜索关键词"
          value={q}
          maxLength={100}
          placeholder="搜索课程、资料、笔记或错题"
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
        />
        <select
          aria-label="限定课程"
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            reset();
          }}
        >
          <option value="">全部课程</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
      <div className="search-types">
        {['all', ...Object.keys(names)].map((t) => (
          <button
            key={t}
            className={t === type ? 'active' : ''}
            onClick={() => {
              setType(t);
              reset();
            }}
          >
            {names[t] || '全部'}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div
        className="search-results"
        ref={area}
        onScroll={(e) => {
          restore.current = e.currentTarget.scrollTop;
          sessionStorage.setItem(
            key,
            JSON.stringify({ q, type, courseId, page, scroll: restore.current }),
          );
        }}
      >
        {loading ? (
          <p className="search-empty">正在搜索…</p>
        ) : !q.trim() ? (
          <p className="search-empty">输入关键词，找到已有学习内容。</p>
        ) : !data.results.length ? (
          <p className="search-empty">没有找到匹配内容，试试其他关键词。</p>
        ) : (
          <>
            <p className="search-count">找到 {data.total} 条结果</p>
            {data.results.map((item) => (
              <button
                className="search-result"
                key={`${item.type}:${item.id}`}
                onClick={() => open(item)}
              >
                <span className="search-kind">{names[item.type]}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.courseTitle}
                    {item.chapterTitle && item.type !== 'chapter' ? ` · ${item.chapterTitle}` : ''}
                  </small>
                  {item.snippet && <p>{item.snippet}</p>}
                </div>
                <span className="search-arrow">→</span>
              </button>
            ))}
          </>
        )}
      </div>
      {data.total > 20 && (
        <footer>
          <button
            disabled={page === 1 || loading}
            onClick={() => {
              setPage(page - 1);
              restore.current = 0;
            }}
          >
            上一页
          </button>
          <span>
            {page} / {Math.ceil(data.total / 20)}
          </span>
          <button
            disabled={page >= Math.ceil(data.total / 20) || loading}
            onClick={() => {
              setPage(page + 1);
              restore.current = 0;
            }}
          >
            下一页
          </button>
        </footer>
      )}
    </section>
  );
}
