import { createPracticeData } from './practice-data.js';
import { MaterialImportJobs, registerMaterialImportJobs } from './material-import-jobs.js';
import { UserAiContext } from './user-ai-context.js';
import { createMaterialService } from './material-service.js';
import { createAccountService } from './account-service.js';
import { createCourseData } from './course-data.js';
import { registerReadingAdapters } from './reading-adapters.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerAssistantRoutes } from './assistant-routes.js';
import { registerPracticeRoutes } from './practice-routes.js';
import { registerCourseQueryRoutes } from './course-query-routes.js';
import { registerMaterialReadingRoutes } from './material-reading-routes.js';
import { registerChapterGenerationRoutes } from './chapter-generation-routes.js';
import { registerMaterialRoutes } from './material-routes.js';
import { registerGenerationRunner } from './generation-runner.js';
import { registerCourseRoutes } from './course-routes.js';
import { emailSchema, passwordSchema, questionItemSchema } from './request-schemas.mjs';
import { sliceChapterText } from './chapter-text.mjs';
import { selectChapterQuestions } from './material-text.mjs';
import { AssistantSessions } from './assistant-sessions.js';
import { createAssistantContext } from './assistant-context.js';
import { ensureStudyDays, backfillStudyDays } from './study-activity.js';
import { ChapterImages } from './chapter-images.js';
import { CourseCovers } from './course-covers.js';
import { ensureUserAccount, registerUserAccount, readPreferences } from './user-account.js';
import { AdminBackups } from './admin-backups.js';
import { RuntimeLimits } from './runtime-limits.js';
import { ensureAdmin, sessionAuth, registerAdmin } from './admin.js';
import { createContentControl } from './admin-content.js';
import { ServiceSettings } from './service-settings.js';
import { ensureChapterCorrections, applyChapterCorrections } from './chapter-corrections.js';
import { ensureLongContextCache } from './long-context.js';
import { ensureGenerationJobs } from './generation-jobs.js';
import { renderOfficePdf } from './pdf-browser.js';
import { ensureProgress, registerProgress } from './progress.js';
import { registerSearch } from './search.js';
import { ensureReviewSchedules, registerReviewSchedules } from './review-schedules.js';
import { ensureReading } from './reading.js';
import { ensureLearningPlans, registerLearningPlans } from './learning-plans.js';
import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { OfficeParser } from 'officeparser';
import { ensureWrongReview, registerWrongReview } from './wrong-review.js';
import { ensureLearningNotes } from './learning-notes.js';

const app = express();
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});
const secret = process.env.JWT_SECRET;
const serviceSettings = new ServiceSettings(db, secret);
const userAi = new UserAiContext({
  services: serviceSettings,
  readPreferences: async (userId) => (await readPreferences(db, userId)).preferences,
});
const runtime = new RuntimeLimits(db);
app.locals.runtime = runtime;

// Service settings are loaded before the HTTP listener starts.

app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.post('/api/courses/:courseId/cover/upload', express.json({ limit: '4.2mb' }));
app.use(express.json({ limit: '1mb' }));

const uploadRoot =
  process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'storage', 'course-materials');
const previewRoot =
  process.env.PREVIEW_DIR || path.resolve(process.cwd(), 'storage', 'course-previews');
const visionRoot = path.resolve(process.cwd(), 'storage', 'vision-pages');

fs.mkdirSync(uploadRoot, { recursive: true });
fs.mkdirSync(previewRoot, { recursive: true });
fs.mkdirSync(visionRoot, { recursive: true });

const backups = new AdminBackups(db, {
  root: path.resolve('storage', 'admin-backups'),
  uploadRoot,
  previewRoot,
  imageRoot: path.resolve('storage', 'note-images'),
});
const auth = sessionAuth(db, secret);
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => userAi.run(req.user?.sub, () => fn(req, res, next)))
    .catch(next);
app.get('/api/platform/limits', auth, (req, res) => res.json(runtime.snapshot()));
app.use((req, res, next) => {
  const p = req.path.toLowerCase().replace(/\/+$/, '');
  const kind =
    p === '/api/assistant/ask'
      ? 'chat'
      : req.method === 'POST' &&
          (p === '/api/generation-jobs' ||
            /^\/api\/generation-jobs\/\d+\/retry$/.test(p) ||
            p === '/api/learning-plans/generate' ||
            /^\/api\/courses\/\d+\/.*\/(generate|organize|suggest)$/.test(p))
        ? 'generation'
        : null;
  if (!kind) return next();
  auth(req, res, () => {
    try {
      runtime.assert(kind);
      next();
    } catch (e) {
      next(e);
    }
  });
});
const validationError = (res, parsed) =>
  res.status(400).json({ message: parsed.error.issues[0]?.message || '输入不符合要求' });
const contentControl = createContentControl(db);
app.locals.contentControl = contentControl;
const { ensurePracticeTables, getCourseChapterSummaries, getCoursePracticeData } =
  createPracticeData({ db });
const {
  normalizeUploadedName,
  removeMaterialFiles,
  upload,
  processMaterial,
  buildVisionPages,
  readChapterSummarySource,
  preparePdfOutline,
} = createMaterialService({ previewRoot, uploadRoot, runtime, db, visionRoot });
const { issue, userView, findUserByEmail, sendCode, consumeCode, recordLearningLogin } =
  createAccountService({ secret, db, serviceSettings });
const { parseId, getOwnedCourse, getCourseMaterials, getOwnedMaterial } = createCourseData({
  contentControl,
  db,
});
const chapterImages = new ChapterImages(db, serviceSettings, runtime, {
  assertCourse: (...args) => contentControl.assertCourse(...args),
});
serviceSettings.chapterImages = chapterImages;
const courseCovers = new CourseCovers(db, chapterImages, {
  assertCourse: (...args) => contentControl.assertCourse(...args),
});
app.use((req, res, next) => {
  const requestPath = req.path.toLowerCase().replace(/\/+$/, '');
  if (
    /^\/api\/courses\/\d+/.test(requestPath) ||
    [
      '/api/assistant/ask',
      '/api/generation-jobs',
      '/api/learning-plans/generate',
      '/api/learning-plans/adopt',
      '/api/learning-plans',
    ].includes(requestPath) ||
    /^\/api\/(generation-jobs\/\d+\/retry|notes\/images\/\d+)$/.test(requestPath)
  )
    return auth(req, res, () => contentControl.middleware(req, res, next));
  next();
});
registerAdmin(app, db, auth, asyncRoute, {
  secret,
  backups,
  runtime,
  uploadRoot,
  previewRoot,
  repairPreview: async (original, output, extension) => {
    if (extension === '.pdf') {
      await fs.promises.copyFile(original, output);
      return;
    }
    const ast = await OfficeParser.parseOffice(original, { extractAttachments: true, ocr: false });
    const result = await renderOfficePdf(ast);
    await fs.promises.writeFile(output, Buffer.from(result.value));
  },
  imageRoot: path.resolve(process.cwd(), 'storage', 'note-images'),
  services: serviceSettings,
});
const accountModels = () => {
  const config = serviceSettings.snapshot('ai');
  return [
    { id: 'configured', label: config.name + ' · ' + config.model },
    ...(new URL(config.baseUrl).hostname === 'api.deepseek.com'
      ? [
          { id: 'deepseek-flash', label: 'DeepSeek Flash' },
          { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        ]
      : []),
  ];
};
registerUserAccount(app, db, auth, asyncRoute, {
  userView,
  passwordSchema,
  emailSchema,
  services: serviceSettings,
  models: accountModels,
});
chapterImages.register(app, auth, asyncRoute);
courseCovers.register(app, auth, asyncRoute);
registerProgress(app, db, auth, asyncRoute);
registerLearningPlans(app, db, auth, asyncRoute, (messages, signal, options) =>
  askDeepSeek(
    messages,
    undefined,
    signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    options,
  ),
);
registerWrongReview(app, db, auth, asyncRoute);
registerReviewSchedules(app, db, auth, asyncRoute);
registerSearch(app, db, auth, asyncRoute);
registerReadingAdapters(app, {
  getAiModel: (userId) => userAi.run(userId, () => userAi.fingerprint()),
  getOwnedMaterial,
  previewRoot,
  uploadRoot,
  db,
  auth,
  asyncRoute,
  askDeepSeek,
});

function generationSignal(req, res, { timeoutMs = 180000 } = {}) {
  if (req.generationSignal)
    return AbortSignal.any([req.generationSignal, AbortSignal.timeout(timeoutMs)]);
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once('close', cancel);
  res.once('finish', () => res.removeListener('close', cancel));
  return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
}

async function askDeepSeek(messages, model, signal, options) {
  return userAi.run(options?.userId, () =>
    runtime.run(() => userAi.ask(messages, model, signal, options), signal),
  );
}

registerAuthRoutes(app, {
  asyncRoute,
  validationError,
  serviceSettings,
  db,
  sendCode,
  findUserByEmail,
  consumeCode,
  recordLearningLogin,
  issue,
  userView,
  auth,
});

registerAssistantRoutes(app, {
  auth,
  serviceSettings,
  asyncRoute,
  validationError,
  getOwnedCourse,
  db,
  generationSignal,
  askDeepSeek,
  accountModels,
  contentControl,
});

const assistantSessions = new AssistantSessions(db, {
  context: createAssistantContext({
    db,
    assertCourse: (...args) => contentControl.assertCourse(...args),
    sliceChapterText,
    selectChapterQuestions,
    applyChapterCorrections,
    readPreferences,
  }),
  ask: askDeepSeek,
  stream: (messages, model, signal, onChunk) =>
    runtime.run(() => userAi.askStream(messages, model, signal, onChunk), signal),
  assertCourse: (...args) => contentControl.assertCourse(...args),
  assertModel: (model) => {
    if (!accountModels().some((m) => m.id === model))
      throw Object.assign(new Error('该模型已停用，请重新选择'), { status: 400 });
    if (!serviceSettings.configured('ai'))
      throw Object.assign(new Error('AI 服务尚未配置或已暂停'), { status: 503 });
  },
  runtime,
  questionSchema: questionItemSchema,
});
assistantSessions.register(app, auth, asyncRoute);

const { questionsGenerate, practiceCreate } = registerPracticeRoutes(app, {
  getAiModel: () => userAi.fingerprint(),
  generationSignal,
  parseId,
  validationError,
  getOwnedCourse,
  db,
  askDeepSeek,
  serviceSettings,
  auth,
  asyncRoute,
});

registerCourseQueryRoutes(app, {
  auth,
  asyncRoute,
  db,
  validationError,
  getOwnedCourse,
  parseId,
  getCoursePracticeData,
  getCourseChapterSummaries,
  getCourseMaterials,
});
registerMaterialReadingRoutes(app, {
  auth,
  asyncRoute,
  parseId,
  getOwnedCourse,
  db,
  getOwnedMaterial,
  uploadRoot,
  previewRoot,
});

const { summaryGenerate, chaptersSuggest } = registerChapterGenerationRoutes(app, {
  getAiModel: () => userAi.fingerprint(),
  preparePdfOutline,
  generationSignal,
  parseId,
  getOwnedCourse,
  db,
  askDeepSeek,
  serviceSettings,
  auth,
  asyncRoute,
  buildVisionPages,
  readChapterSummarySource,
  validationError,
});

const importJobs = new MaterialImportJobs({
  db,
  uploadRoot,
  previewRoot,
  processMaterial,
  normalizeUploadedName,
  getOwnedCourse,
});
registerMaterialImportJobs(app, { db, auth, asyncRoute, importJobs });
registerMaterialRoutes(app, {
  importJobs,
  auth,
  asyncRoute,
  parseId,
  getOwnedCourse,
  upload,
  processMaterial,
  normalizeUploadedName,
  db,
  previewRoot,
  getOwnedMaterial,
  validationError,
  removeMaterialFiles,
  uploadRoot,
});

registerCourseRoutes(app, {
  cancelCourseGeneration: (courseId) => app.locals.adminTasks?.course?.abortCourse(courseId),
  importJobs,
  db,
  auth,
  asyncRoute,
  parseId,
  validationError,
  getOwnedCourse,
  courseCovers,
  removeMaterialFiles,
});

registerGenerationRunner(app, {
  runAsAiUser: (userId, action) => userAi.run(userId, action),
  db,
  auth,
  asyncRoute,
  contentControl,
  generationSignal,
  chaptersSuggest,
  summaryGenerate,
  questionsGenerate,
  practiceCreate,
});

app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE')
    return res
      .status(400)
      .json({ message: `单个文件不能超过 ${req.uploadLimits?.uploadMB || 200}MB` });
  if (
    error instanceof multer.MulterError &&
    ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code)
  )
    return res
      .status(400)
      .json({ message: `单次最多上传 ${req.uploadLimits?.uploadCount || 5} 个资料文件` });
  if (req.path.startsWith('/api/admin') && !error.status)
    return res.status(500).json({ message: '管理服务暂不可用，请稍后重试' });
  res.status(error.status || 500).json({ message: error.message || '服务器暂时无法处理请求' });
});
ensurePracticeTables()
  .then(() => ensureAdmin(db))
  .then(() => ensureUserAccount(db))
  .then(() => serviceSettings.init())
  .then(() => runtime.init())
  .then(() => backups.init())
  .then(() => ensureProgress(db))
  .then(() => ensureLearningPlans(db))
  .then(() => ensureLearningNotes(db))
  .then(() => ensureWrongReview(db))
  .then(() => ensureReviewSchedules(db))
  .then(() => ensureReading(db))
  .then(() => ensureChapterCorrections(db))
  .then(() => ensureLongContextCache(db))
  .then(() => ensureGenerationJobs(db))
  .then(() => assistantSessions.init())
  .then(() => ensureStudyDays(db))
  .then(() => backfillStudyDays(db))
  .then(() => chapterImages.init())
  .then(() => courseCovers.init())
  .then(() => importJobs.init())
  .then(() => app.listen(process.env.PORT || 8005, () => console.log('auth api ready')))
  .catch((error) => {
    console.error('无法初始化练习数据表', error);
    process.exit(1);
  });
