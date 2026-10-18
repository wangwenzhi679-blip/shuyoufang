import React, { useEffect, useRef, useState } from 'react';

const localToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export default function DatePicker({ label, value, onChange }) {
  const [open, setOpen] = useState(false),
    [month, setMonth] = useState(() => (value || localToday()).slice(0, 7));
  const root = useRef(null),
    trigger = useRef(null);
  const [year, m] = month.split('-').map(Number),
    first = new Date(year, m - 1, 1).getDay(),
    days = new Date(year, m, 0).getDate();
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function choose(day) {
    onChange(day);
    close();
  }
  function move(delta) {
    const date = new Date(year, m - 1 + delta, 1);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return (
    <div className="admin-date-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setMonth((value || localToday()).slice(0, 7));
          setOpen(!open);
        }}
      >
        {value || '请选择日期'}
        <span aria-hidden="true">▦</span>
      </button>
      {open && (
        <section role="dialog" aria-label={`${label}日历`} className="admin-calendar">
          <header>
            <button type="button" aria-label="上个月" onClick={() => move(-1)}>
              ‹
            </button>
            <select
              aria-label="年份"
              value={year}
              onChange={(e) => setMonth(`${e.target.value}-${String(m).padStart(2, '0')}`)}
            >
              {Array.from(
                { length: Math.max(year + 5, Number(localToday().slice(0, 4)) + 5) - 1970 + 1 },
                (_, i) => 1970 + i,
              ).map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
            <select
              aria-label="月份"
              value={m}
              onChange={(e) => setMonth(`${year}-${String(e.target.value).padStart(2, '0')}`)}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}月
                </option>
              ))}
            </select>
            <button type="button" aria-label="下个月" onClick={() => move(1)}>
              ›
            </button>
          </header>
          <div className="admin-calendar-grid">
            {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
              <small key={d}>{d}</small>
            ))}
            {Array.from({ length: first }, (_, i) => (
              <span key={`blank${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button
                  type="button"
                  key={date}
                  aria-label={date}
                  aria-pressed={date === value}
                  className={date === value ? 'selected' : ''}
                  onClick={() => choose(date)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <footer>
            <button type="button" onClick={() => choose('')}>
              清除
            </button>
            <button type="button" onClick={() => choose(localToday())}>
              今天
            </button>
            <button type="button" onClick={close}>
              关闭
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
