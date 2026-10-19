import { useEffect, useState } from 'react';
import './document-zoom.css';

export default function DocumentZoom({ value, onChange }) {
  const [entry, setEntry] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setEntry(String(value));
    setError('');
  }, [value]);
  const apply = () => {
    const number = Number(entry.trim().replace(/[%％]$/, ''));
    if (!Number.isFinite(number) || number < 1 || number > 1000) {
      setError('请输入 1% 至 1000% 的比例，可使用小数');
      return;
    }
    setError('');
    setEntry(String(number));
    onChange(number);
  };
  const change = (next) => {
    setError('');
    setEntry(String(next));
    onChange(next);
  };
  return (
    <div className="document-zoom" role="group" aria-label="课本显示比例">
      <span>课本比例</span>
      <button
        type="button"
        aria-label="缩小课本"
        disabled={value <= 1}
        onClick={() => change(Math.max(1, Math.round((value - 10) * 100) / 100))}
      >
        −
      </button>
      <label className="document-zoom-value">
        <input
          aria-label="课本比例百分比"
          aria-invalid={Boolean(error)}
          type="text"
          inputMode="decimal"
          value={entry}
          title="输入 1 至 1000 之间的比例，按回车应用；100% 为适合宽度"
          onChange={(event) => {
            setEntry(event.target.value);
            setError('');
          }}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
        <span>%</span>
      </label>
      <button
        type="button"
        aria-label="放大课本"
        disabled={value >= 1000}
        onClick={() => change(Math.min(1000, Math.round((value + 10) * 100) / 100))}
      >
        ＋
      </button>
      <button
        type="button"
        className="document-zoom-reset"
        title="恢复适合宽度"
        onClick={() => change(100)}
      >
        重置
      </button>
      {error && (
        <span className="document-zoom-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
