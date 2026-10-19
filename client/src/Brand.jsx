export function Brand({ compact = false }) {
  return (
    <div className="brand brand-editorial">
      <span className="brand-logo-editorial">{compact ? '数有方' : '数有方·'}</span>
      <span className="brand-badge-editorial">研习空间</span>
    </div>
  );
}
