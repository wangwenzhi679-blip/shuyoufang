import React from 'react';
import './admin-startup.css';

export default function AdminStartup() {
  return (
    <div className="admin-startup" role="status" aria-label="正在加载管理端" aria-busy="true">
      <span className="admin-startup__line" aria-hidden="true" />
    </div>
  );
}
