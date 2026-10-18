import { API_ROOT } from './api-base.mjs';
import React, { useEffect, useState } from 'react';
import './announcements.css';

export default function AnnouncementBanner({ placement }) {
  const [items, setItems] = useState([]),
    [dismissed, setDismissed] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const load = () =>
      fetch(`${API_ROOT}/announcements?placement=${placement}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('公告暂不可用');
          return response.json();
        })
        .then((data) => {
          if (live) setItems(data.items);
        })
        .catch(() => {
          if (live) setItems([]);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [placement]);
  const visible = items.filter((item) => !dismissed.includes(`${item.id}:${item.version}`));
  if (!visible.length) return null;
  return (
    <section className={`platform-announcements ${placement}`} aria-label="平台公告">
      {visible.map((item) => (
        <article key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </div>
          <button
            type="button"
            aria-label={`关闭公告：${item.title}`}
            onClick={() => setDismissed((value) => [...value, `${item.id}:${item.version}`])}
          >
            ×
          </button>
        </article>
      ))}
    </section>
  );
}
