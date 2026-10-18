import test from 'node:test';
import assert from 'node:assert/strict';
import { studyDay, summarizeStudyDays, getStudyActivity } from './study-activity.js';
import { dailyWelcome } from '../client/src/daily-welcome.mjs';

test('日期和问候按北京时间跨日、跨时段切换', () => {
  assert.equal(studyDay(new Date('2026-10-15T15:59:59Z')), '2026-10-15');
  assert.equal(studyDay(new Date('2026-10-15T16:00:00Z')), '2026-10-16');
  assert.equal(dailyWelcome(new Date('2026-10-15T03:59:59Z')).greeting, '上午好');
  assert.equal(dailyWelcome(new Date('2026-10-15T04:00:00Z')).greeting, '下午好');
  assert.equal(dailyWelcome(new Date('2026-10-15T10:00:00Z')).greeting, '晚上好');
  const before = dailyWelcome(new Date('2026-10-15T15:59:59Z')),
    after = dailyWelcome(new Date('2026-10-15T16:00:00Z'));
  assert.match(before.label, /10月15日/);
  assert.match(after.label, /10月16日/);
  assert.notEqual(before.prompt, after.prompt);
  assert.equal(before.prompt, dailyWelcome(new Date('2026-10-15T00:01:00Z')).prompt);
});
test('同日去重，今天有学习时连续天数包含今天', () => {
  assert.deepEqual(
    summarizeStudyDays(['2026-10-13', '2026-10-14', '2026-10-14', '2026-10-15'], '2026-10-15'),
    {
      currentStreak: 3,
      longestStreak: 3,
      totalDays: 3,
      studiedToday: true,
      lastStudyDate: '2026-10-15',
      today: '2026-10-15',
    },
  );
});
test('今天未学习保留昨天连续记录，缺一天后归零', () => {
  const days = ['2026-10-12', '2026-10-13', '2026-10-14'];
  assert.equal(summarizeStudyDays(days, '2026-10-15').currentStreak, 3);
  assert.equal(summarizeStudyDays(days, '2026-10-15').studiedToday, false);
  const broken = summarizeStudyDays(days, '2026-10-16');
  assert.equal(broken.currentStreak, 0);
  assert.equal(broken.longestStreak, 3);
  assert.equal(summarizeStudyDays([...days, '2026-10-16'], '2026-10-16').currentStreak, 1);
});
test('跨月、跨年和闰年连续统计正确，过滤未来和非法日期', () => {
  assert.equal(
    summarizeStudyDays(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01').currentStreak,
    3,
  );
  const stats = summarizeStudyDays(
    ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-02-30', null, 'bad'],
    '2026-01-01',
  );
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.totalDays, 3);
  assert.equal(summarizeStudyDays([], '2026-10-15').currentStreak, 0);
});
test('读取统计只查询当前账号与不晚于今天的日期', async () => {
  const result = await getStudyActivity(
    {
      execute: async (sql, args) => {
        assert.match(sql, /user_id=\?/);
        assert.deepEqual(args, [12, '2026-10-15']);
        return [[{ day: '2026-10-15' }]];
      },
    },
    12,
    new Date('2026-10-15T01:00:00Z'),
  );
  assert.equal(result.currentStreak, 1);
  assert.equal(result.studiedToday, true);
});
