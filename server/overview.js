import { getStudyActivity } from './study-activity.js';
import { today } from './learning-plans.js';
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
export function summarizeAttempts(rows) {
  let correct = 0,
    total = 0,
    excluded = 0;
  const objective = new Set(['单选题', '多选题', '判断题', '填空题']);
  const types = new Set([...objective, '简答题']);
  for (const row of rows) {
    let records;
    try {
      records = parse(row.answers_json);
    } catch {
      excluded++;
      continue;
    }
    if (
      !Array.isArray(records) ||
      records.length !== Number(row.total_count) ||
      records.some((x) => !x || !types.has(x.questionType) || typeof x.correct !== 'boolean')
    ) {
      excluded++;
      continue;
    }
    for (const item of records)
      if (objective.has(item.questionType)) {
        total++;
        if (item.correct) correct++;
      }
  }
  return {
    attemptCount: rows.length,
    objectiveCorrect: correct,
    objectiveTotal: total,
    accuracy: total ? Math.round((correct / total) * 100) : null,
    excludedAttempts: excluded,
  };
}
export async function getOverview(db, userId) {
  const [courses] = await db.execute(
    `SELECT c.id,c.title,COUNT(ch.id) chapter_count,SUM(ch.completed_at IS NOT NULL) completed_count,
 (SELECT MAX(r.updated_at) FROM (SELECT user_id,course_id,updated_at FROM reading_positions UNION ALL SELECT user_id,course_id,updated_at FROM learning_progress) r WHERE r.course_id=c.id AND r.user_id=?) last_read
 FROM courses c LEFT JOIN course_chapters ch ON ch.course_id=c.id WHERE c.user_id=? GROUP BY c.id ORDER BY last_read DESC,c.id DESC`,
    [userId, userId],
  );
  const [attempts] = await db.execute(
    'SELECT a.course_id,a.answers_json,a.total_count FROM practice_attempts a JOIN courses c ON c.id=a.course_id WHERE c.user_id=?',
    [userId],
  );
  const attemptsByCourse = new Map();
  for (const attempt of attempts) {
    const key = Number(attempt.course_id);
    if (!attemptsByCourse.has(key)) attemptsByCourse.set(key, []);
    attemptsByCourse.get(key).push(attempt);
  }
  for (const course of courses)
    course.practiceStats = summarizeAttempts(attemptsByCourse.get(Number(course.id)) || []);
  const [due] = await db.execute(
    `SELECT COUNT(*) total FROM review_schedules s JOIN wrong_questions w ON w.id=s.wrong_question_id JOIN practice_questions q ON q.id=w.question_id JOIN chapter_practices p ON p.id=q.practice_id JOIN courses c ON c.id=p.course_id WHERE s.user_id=? AND c.user_id=? AND s.status='pending' AND s.review_date<=?`,
    [userId, userId, today()],
  );
  const [activity] = await db.execute(
    `SELECT * FROM (
 SELECT 'read' kind,ch.id id,c.id courseId,ch.id chapterId,c.title courseTitle,ch.title title,MAX(r.updated_at) activityAt,NULL practiceId FROM (SELECT user_id,course_id,chapter_id,updated_at FROM reading_positions UNION ALL SELECT user_id,course_id,chapter_id,updated_at FROM learning_progress WHERE chapter_id IS NOT NULL) r JOIN courses c ON c.id=r.course_id JOIN course_chapters ch ON ch.id=r.chapter_id AND ch.course_id=c.id WHERE r.user_id=? AND c.user_id=? GROUP BY ch.id,c.id
 UNION ALL SELECT 'note',n.chapter_id,c.id,ch.id,c.title,ch.title,n.updated_at,NULL FROM chapter_notes n JOIN courses c ON c.id=n.course_id JOIN course_chapters ch ON ch.id=n.chapter_id AND ch.course_id=c.id WHERE n.user_id=? AND c.user_id=? AND CHAR_LENGTH(TRIM(n.body))>0
 UNION ALL SELECT 'attempt',a.id,c.id,ch.id,c.title,p.title,a.created_at,p.id FROM practice_attempts a JOIN courses c ON c.id=a.course_id JOIN chapter_practices p ON p.id=a.practice_id JOIN course_chapters ch ON ch.id=p.chapter_id WHERE c.user_id=?
 ) activities ORDER BY activityAt DESC,kind,id DESC LIMIT 10`,
    [userId, userId, userId, userId, userId],
  );
  const studyActivity = await getStudyActivity(db, userId);
  return {
    studyActivity,
    ...summarizeAttempts(attempts),
    completedChapters: courses.reduce((n, c) => n + Number(c.completed_count), 0),
    totalChapters: courses.reduce((n, c) => n + Number(c.chapter_count), 0),
    dueCount: Number(due[0].total),
    courseProgress: courses.slice(0, 5),
    courseCounts: courses,
    activity,
    today: today(),
  };
}
