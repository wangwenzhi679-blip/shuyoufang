import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {
  ensureStudyDays,
  recordStudyDay,
  getStudyActivity,
  backfillStudyDays,
} from './study-activity.js';

test(
  '学习天数持久化：并发去重、跨日连续、账号隔离、历史回填和删课保留',
  { timeout: 20000 },
  async () => {
    const db = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 5,
    });
    let userId, courseId;
    try {
      await ensureStudyDays(db);
      const [user] = await db.execute(
        "INSERT INTO users(account,nickname,grade,password_hash) VALUES(?,'学习记录测试','test','disabled-test-login')",
        ['study_' + Date.now()],
      );
      userId = user.insertId;
      const clock = new Date('2026-10-15T05:00:00Z');
      await Promise.all(Array.from({ length: 8 }, () => recordStudyDay(db, userId, clock)));
      let stats = await getStudyActivity(db, userId, clock);
      assert.equal(stats.totalDays, 1);
      assert.equal(stats.currentStreak, 1);
      await recordStudyDay(db, userId, new Date('2026-10-14T05:00:00Z'));
      stats = await getStudyActivity(db, userId, clock);
      assert.equal(stats.totalDays, 2);
      assert.equal(stats.currentStreak, 2);
      assert.equal((await getStudyActivity(db, userId + 1000000, clock)).totalDays, 0);
      const [course] = await db.execute("INSERT INTO courses(user_id,title) VALUES(?,'回填课程')", [
        userId,
      ]);
      courseId = course.insertId;
      const [chapter] = await db.execute(
        "INSERT INTO course_chapters(course_id,title) VALUES(?,'第一章')",
        [courseId],
      );
      await db.execute(
        'INSERT INTO learning_progress(user_id,course_id,chapter_id,updated_at) VALUES(?,?,?,FROM_UNIXTIME(?))',
        [userId, courseId, chapter.insertId, Date.parse('2026-10-13T05:00:00Z') / 1000],
      );
      await backfillStudyDays(db);
      stats = await getStudyActivity(db, userId, clock);
      assert.equal(stats.currentStreak, 3);
      await backfillStudyDays(db);
      assert.equal((await getStudyActivity(db, userId, clock)).totalDays, 3);
      await db.execute('DELETE FROM courses WHERE id=?', [courseId]);
      courseId = null;
      assert.equal((await getStudyActivity(db, userId, clock)).totalDays, 3);
    } finally {
      if (courseId) await db.execute('DELETE FROM courses WHERE id=?', [courseId]);
      if (userId) await db.execute('DELETE FROM users WHERE id=?', [userId]);
      await db.end();
    }
  },
);
