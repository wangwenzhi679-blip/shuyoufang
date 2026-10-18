const zone = 'Asia/Hong_Kong';
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const studyDay = (now = new Date()) => dayFormat.format(now);
const validDay = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const previousDay = (day) =>
  new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

export function summarizeStudyDays(values, today = studyDay()) {
  const days = [...new Set(values.filter((day) => validDay(day) && day <= today))].sort();
  const known = new Set(days),
    studiedToday = known.has(today);
  let currentStreak = 0,
    cursor = studiedToday ? today : previousDay(today),
    longestStreak = 0,
    run = 0,
    previous = null;
  while (known.has(cursor)) {
    currentStreak++;
    cursor = previousDay(cursor);
  }
  for (const day of days) {
    run = previous === previousDay(day) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = day;
  }
  return {
    currentStreak,
    longestStreak,
    totalDays: days.length,
    studiedToday,
    lastStudyDate: days.at(-1) || null,
    today,
  };
}

export async function ensureStudyDays(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS study_days (
  user_id BIGINT UNSIGNED NOT NULL,study_date DATE NOT NULL,
  PRIMARY KEY(user_id,study_date),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
 )`);
}
export async function recordStudyDay(db, userId, now = new Date()) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0)
    throw new Error('学习记录账号无效');
  await db.execute('INSERT IGNORE INTO study_days(user_id,study_date) VALUES(?,?)', [
    userId,
    studyDay(now),
  ]);
}
export async function getStudyActivity(db, userId, now = new Date()) {
  const day = studyDay(now);
  const [rows] = await db.execute(
    "SELECT DATE_FORMAT(study_date,'%Y-%m-%d') day FROM study_days WHERE user_id=? AND study_date<=? ORDER BY study_date",
    [userId, day],
  );
  return summarizeStudyDays(
    rows.map((row) => row.day),
    day,
  );
}

// Import only dates supported by surviving records; earlier visits cannot be reconstructed.
// UNIX_TIMESTAMP reads TIMESTAMP values as instants, independent of the MySQL session zone.
export async function backfillStudyDays(db) {
  const [rows] =
    await db.query(`SELECT user_id,UNIX_TIMESTAMP(updated_at)*1000 activity_ms FROM learning_progress WHERE chapter_id IS NOT NULL
 UNION ALL SELECT user_id,UNIX_TIMESTAMP(updated_at)*1000 FROM reading_positions
 UNION ALL SELECT user_id,UNIX_TIMESTAMP(updated_at)*1000 FROM chapter_notes WHERE CHAR_LENGTH(TRIM(body))>0
 UNION ALL SELECT c.user_id,UNIX_TIMESTAMP(a.created_at)*1000 FROM practice_attempts a JOIN courses c ON c.id=a.course_id WHERE a.total_count>0
 UNION ALL SELECT user_id,TIMESTAMPDIFF(MICROSECOND,'1970-01-01 00:00:00',completed_at)/1000 FROM review_schedules WHERE status='completed' AND completed_at IS NOT NULL
 UNION ALL SELECT c.user_id,TIMESTAMPDIFF(MICROSECOND,'1970-01-01 00:00:00',ch.completed_at)/1000 FROM course_chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.completed_at IS NOT NULL`);
  const [plans] = await db.query('SELECT user_id,tasks_json FROM learning_plans');
  for (const plan of plans) {
    let tasks;
    try {
      tasks = typeof plan.tasks_json === 'string' ? JSON.parse(plan.tasks_json) : plan.tasks_json;
    } catch {
      continue;
    }
    if (Array.isArray(tasks))
      for (const task of tasks)
        if (task.completedAt)
          rows.push({ user_id: plan.user_id, activity_ms: Date.parse(task.completedAt) });
  }
  const pairs = new Map(),
    today = studyDay();
  for (const row of rows) {
    const stamp = Number(row.activity_ms);
    if (!Number.isFinite(stamp) || stamp <= 0) continue;
    const day = studyDay(new Date(stamp));
    if (day > today) continue;
    pairs.set(row.user_id + ':' + day, [row.user_id, day]);
  }
  const values = [...pairs.values()];
  for (let offset = 0; offset < values.length; offset += 500) {
    const batch = values.slice(offset, offset + 500);
    await db.execute(
      'INSERT IGNORE INTO study_days(user_id,study_date) VALUES ' +
        batch.map(() => '(?,?)').join(','),
      batch.flat(),
    );
  }
}
