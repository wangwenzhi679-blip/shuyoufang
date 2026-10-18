import React, { useEffect, useRef, useState } from 'react';
import DatePicker from './DatePicker.jsx';
export default function DateRange({ from, to, onChange }) {
  const [open, setOpen] = useState(false),
    root = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const text = from || to ? `${from || '不限'} 至 ${to || '不限'}` : '时间范围';
  return (
    <div className="admin-date-range" ref={root}>
      <button
        type="button"
        aria-label="时间范围"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4m8-4v4" />
        </svg>
        <span>{text}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <section className="admin-range-panel" role="dialog" aria-label="选择时间范围">
          <h3>时间范围</h3>
          <div>
            <label>
              开始日期
              <DatePicker
                label="开始日期"
                value={from}
                onChange={(value) => onChange('from', value)}
              />
            </label>
            <label>
              结束日期
              <DatePicker label="结束日期" value={to} onChange={(value) => onChange('to', value)} />
            </label>
          </div>
          <footer>
            <button
              type="button"
              onClick={() => {
                onChange('from', '');
                onChange('to', '');
              }}
            >
              清除日期
            </button>
            <button type="button" className="admin-primary" onClick={() => setOpen(false)}>
              确定
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
