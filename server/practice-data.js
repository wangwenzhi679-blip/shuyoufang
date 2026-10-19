import { ensureAttemptRequests } from './attempt-requests.js';

// 显式注入运行依赖，导入模块本身不会启动服务或连接数据库。
export function createPracticeData({ db }) {
  async function ensurePracticeTables() {
    await db.query(`CREATE TABLE IF NOT EXISTS learning_progress (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    course_id BIGINT UNSIGNED NOT NULL,
    chapter_id BIGINT UNSIGNED NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE
  )`);
    await db.query(`CREATE TABLE IF NOT EXISTS chapter_question_drafts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT UNSIGNED NOT NULL,
    chapter_id BIGINT UNSIGNED NOT NULL,
    settings_json JSON NOT NULL,
    questions_json JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_chapter_question_draft (course_id, chapter_id),
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE
  )`);
    await db.query(`CREATE TABLE IF NOT EXISTS chapter_practices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT UNSIGNED NOT NULL,
    chapter_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(120) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,
    INDEX idx_practices_chapter_created (chapter_id, created_at)
  )`);
    await db.query(`CREATE TABLE IF NOT EXISTS practice_questions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    practice_id BIGINT UNSIGNED NOT NULL,
    question_type VARCHAR(20) NOT NULL,
    question_text TEXT NOT NULL,
    options_json JSON NOT NULL,
    answer_text TEXT NOT NULL,
    analysis_text TEXT NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    FOREIGN KEY(practice_id) REFERENCES chapter_practices(id) ON DELETE CASCADE,
    INDEX idx_practice_questions_order (practice_id, sort_order)
  )`);
    await db.query(`CREATE TABLE IF NOT EXISTS practice_attempts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT UNSIGNED NOT NULL,
    practice_id BIGINT UNSIGNED NOT NULL,
    answers_json JSON NOT NULL,
    correct_count INT UNSIGNED NOT NULL,
    total_count INT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(practice_id) REFERENCES chapter_practices(id) ON DELETE CASCADE,
    INDEX idx_practice_attempts_practice_created (practice_id, created_at)
  )`);
    await ensureAttemptRequests(db);
    await db.query(`CREATE TABLE IF NOT EXISTS practice_in_progress (
    user_id BIGINT UNSIGNED NOT NULL,
    course_id BIGINT UNSIGNED NOT NULL,
    practice_id BIGINT UNSIGNED NOT NULL,
    answers_json JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id,practice_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(practice_id) REFERENCES chapter_practices(id) ON DELETE CASCADE
  )`);
    await db.query(`CREATE TABLE IF NOT EXISTS chapter_summaries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT UNSIGNED NOT NULL,
    chapter_id BIGINT UNSIGNED NOT NULL,
    summary_text TEXT NOT NULL,
    knowledge_points_json JSON NOT NULL,
    source_names_json JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_chapter_summary (chapter_id),
    FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES course_chapters(id) ON DELETE CASCADE,
    INDEX idx_chapter_summaries_course (course_id)
  )`);
  }

  async function getCourseChapterSummaries(courseId) {
    const [rows] = await db.execute(
      'SELECT id,chapter_id,summary_text,knowledge_points_json,source_names_json,updated_at FROM chapter_summaries WHERE course_id=?',
      [courseId],
    );
    return rows.map((item) => ({
      id: Number(item.id),
      chapterId: Number(item.chapter_id),
      summary: item.summary_text,
      knowledgePoints:
        typeof item.knowledge_points_json === 'string'
          ? JSON.parse(item.knowledge_points_json)
          : item.knowledge_points_json,
      sources: [
        ...new Set(
          typeof item.source_names_json === 'string'
            ? JSON.parse(item.source_names_json)
            : item.source_names_json,
        ),
      ],
      updatedAt: item.updated_at,
    }));
  }

  async function getCoursePracticeData(courseId) {
    const [practices] = await db.execute(
      'SELECT id,course_id,chapter_id,title,created_at,updated_at FROM chapter_practices WHERE course_id=? ORDER BY created_at DESC,id DESC',
      [courseId],
    );
    const [drafts] = await db.execute(
      'SELECT chapter_id,settings_json,questions_json,updated_at FROM chapter_question_drafts WHERE course_id=?',
      [courseId],
    );
    const [wrongRows] = await db.execute(
      `SELECT w.question_id FROM wrong_questions w JOIN practice_questions q ON q.id=w.question_id JOIN chapter_practices p ON p.id=q.practice_id WHERE p.course_id=?`,
      [courseId],
    );
    const [progressRows] = await db.execute(
      'SELECT practice_id,answers_json,updated_at FROM practice_in_progress WHERE course_id=?',
      [courseId],
    );
    const progressByPractice = new Map(
      progressRows.map((item) => [Number(item.practice_id), item]),
    );
    const wrongQuestionIds = new Set(wrongRows.map((item) => Number(item.question_id)));
    const [attempts] = await db.execute(
      `SELECT a.id,a.practice_id,a.answers_json,a.correct_count,a.total_count,a.created_at,stats.attempt_count
    FROM practice_attempts a
    INNER JOIN (
      SELECT practice_id,MAX(id) AS latest_id,COUNT(*) AS attempt_count
      FROM practice_attempts WHERE course_id=? GROUP BY practice_id
    ) stats ON stats.latest_id=a.id`,
      [courseId],
    );
    const attemptsByPractice = new Map(attempts.map((item) => [Number(item.practice_id), item]));
    const practiceItems = await Promise.all(
      practices.map(async (practice) => {
        const [questions] = await db.execute(
          'SELECT id,question_type,question_text,options_json,answer_text,analysis_text,sort_order FROM practice_questions WHERE practice_id=? ORDER BY sort_order ASC,id ASC',
          [practice.id],
        );
        const latestAttempt = attemptsByPractice.get(Number(practice.id));
        const progress = progressByPractice.get(Number(practice.id));
        return {
          ...practice,
          id: Number(practice.id),
          course_id: Number(practice.course_id),
          chapter_id: Number(practice.chapter_id),
          attempt_count: Number(latestAttempt?.attempt_count || 0),
          latest_attempt: latestAttempt
            ? {
                id: Number(latestAttempt.id),
                answers:
                  typeof latestAttempt.answers_json === 'string'
                    ? JSON.parse(latestAttempt.answers_json)
                    : latestAttempt.answers_json,
                correct_count: Number(latestAttempt.correct_count),
                total_count: Number(latestAttempt.total_count),
                created_at: latestAttempt.created_at,
              }
            : null,
          in_progress: progress
            ? {
                answers:
                  typeof progress.answers_json === 'string'
                    ? JSON.parse(progress.answers_json)
                    : progress.answers_json,
                updated_at: progress.updated_at,
              }
            : null,
          questions: questions.map((question) => ({
            id: Number(question.id),
            type: question.question_type,
            question: question.question_text,
            options:
              typeof question.options_json === 'string'
                ? JSON.parse(question.options_json)
                : question.options_json,
            answer: question.answer_text,
            analysis: question.analysis_text,
            in_wrong_book: wrongQuestionIds.has(Number(question.id)),
          })),
        };
      }),
    );
    return {
      practices: practiceItems,
      questionDrafts: drafts.map((item) => ({
        chapterId: Number(item.chapter_id),
        settings:
          typeof item.settings_json === 'string'
            ? JSON.parse(item.settings_json)
            : item.settings_json,
        questions:
          typeof item.questions_json === 'string'
            ? JSON.parse(item.questions_json)
            : item.questions_json,
        updatedAt: item.updated_at,
      })),
    };
  }
  return { ensurePracticeTables, getCourseChapterSummaries, getCoursePracticeData };
}
