import AdminStartup from './AdminStartup.jsx';
// 保留既有模块及样式的加载顺序，避免拆分业务组件后改变 CSS 层叠结果。
import './AuthScreen.jsx';
import './CourseDialogs.jsx';
import './api-client.mjs';
import './api-base.mjs';
import './PaperDialog.jsx';
import './AssistantReading.jsx';
import './ChapterIllustration.jsx';
import './AccountPanel.jsx';
import './account-state.js';
import './AnnouncementBanner.jsx';
import '../../shared/question-types.mjs';
import './ChapterSourceEditor';
import './date-format.mjs';
import './attempt-request.mjs';
import './LearningOverview';
import './Search';
import './ReviewSchedules';
import './Reading';
import './LearningPlans';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './WrongReview';
import './LearningNotes';
import './NoteJobs';
import './imported-content.mjs';
import './editorial-theme.css';
import './account.css';
import './ink-cover.css';
import './atelier-theme.css';
import './home-refinement.css';
import './CourseShelf.jsx';
import './CourseForm.jsx';
import './AssistantDesk.jsx';
import './AtelierBamboo.jsx';
import './student-dialogs.css';
import './resource-library.css';
import './reading-layout.css';
import './answer-states.css';
import { App } from './StudentApp.jsx';

const AdminApp = React.lazy(() => import('./AdminApp.jsx'));
const isAdminPage = /^\/admin(?:\/|$)/.test(window.location.pathname);
createRoot(document.getElementById('root')).render(
  isAdminPage ? (
    <React.Suspense fallback={<AdminStartup />}>
      <AdminApp />
    </React.Suspense>
  ) : (
    <App />
  ),
);
