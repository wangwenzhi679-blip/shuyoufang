import React from 'react';

export default function ImageDialogHeader({
  title,
  subtitle,
  onBack,
  backLabel = '返回设置',
  disabled = false,
}) {
  return (
    <header className="image-dialog-header">
      <button
        type="button"
        className="image-editor-return"
        aria-label={backLabel}
        title={backLabel}
        disabled={disabled}
        onClick={onBack}
      >
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
          <path
            d="m12 5-5 5 5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>返回</span>
      </button>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </header>
  );
}
