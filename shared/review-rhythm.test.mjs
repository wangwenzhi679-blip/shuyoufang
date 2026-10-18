import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REVIEW_RHYTHM_STAGES,
  addReviewDays,
  buildReviewDates,
  isReviewDate,
  summarizeReviewRhythm,
} from './review-rhythm.mjs';

test('five rounds use day 1, 3, 7, 14, 30, with one shared first-day anchor', () => {
  assert.deepEqual(buildReviewDates('2026-10-18', 'spaced'), [
    '2026-10-18',
    '2026-10-20',
    '2026-10-24',
    '2026-10-31',
    '2026-11-16',
  ]);
  assert.deepEqual(buildReviewDates('2026-10-18'), ['2026-10-18']);
});
test('calendar arithmetic handles leap day, year rollover and UTC date boundaries', () => {
  assert.deepEqual(buildReviewDates('2028-02-28', 'spaced'), [
    '2028-02-28',
    '2028-03-01',
    '2028-03-05',
    '2028-03-12',
    '2028-03-28',
  ]);
  assert.equal(addReviewDays('2026-12-31', 2), '2027-01-02');
  assert.equal(addReviewDays('2028-03-01', -1), '2028-02-29');
});
test('invalid calendar values and unknown strategies fail before creation', () => {
  for (const day of ['2026-02-29', '2026-02-30', '2026-13-01', '', 'not-a-day', '2026-1-1']) {
    assert.equal(isReviewDate(day), false);
    assert.throws(() => buildReviewDates(day, 'spaced'), RangeError);
  }
  assert.throws(() => buildReviewDates('2026-10-17', 'other'), RangeError);
  assert.throws(() => addReviewDays('2026-10-17', 1.5), RangeError);
});
test('stage retention valleys rise monotonically across the five Ebbinghaus rounds', () => {
  assert.equal(REVIEW_RHYTHM_STAGES.length, 5);
  for (let i = 1; i < REVIEW_RHYTHM_STAGES.length; i++) {
    assert.ok(
      REVIEW_RHYTHM_STAGES[i].retentionBefore > REVIEW_RHYTHM_STAGES[i - 1].retentionBefore,
    );
    assert.ok(
      REVIEW_RHYTHM_STAGES[i].forgottenRetention < REVIEW_RHYTHM_STAGES[i - 1].forgottenRetention,
    );
  }
});
test('summarizeReviewRhythm maps spaced and partial schedules to rounds and counts due/pending/completed', () => {
  const dates = buildReviewDates('2026-10-17', 'spaced');
  const tasks = [
    {
      id: 101,
      wrongQuestionId: 1,
      date: dates[0],
      status: 'completed',
      correct: true,
      available: true,
    },
    { id: 102, wrongQuestionId: 1, date: dates[1], status: 'pending', available: true },
    { id: 103, wrongQuestionId: 1, date: dates[2], status: 'pending', available: true },
    { id: 104, wrongQuestionId: 1, date: dates[3], status: 'pending', available: true },
    { id: 105, wrongQuestionId: 1, date: dates[4], status: 'pending', available: true },
    // Question 2 had round 2 cancelled, leaving day 1, 7, 14, 30
    { id: 201, wrongQuestionId: 2, date: '2026-10-17', status: 'pending', available: true },
    { id: 202, wrongQuestionId: 2, date: '2026-10-23', status: 'pending', available: true },
  ];
  const result = summarizeReviewRhythm(tasks, '2026-10-19');
  assert.equal(result.totals.questionCount, 2);
  assert.equal(result.totals.completedCount, 1);
  assert.equal(result.totals.pendingCount, 6);
  assert.equal(result.totals.dueCount, 2); // id 102 (10-19) and id 201 (10-17)
  assert.equal(result.taskRoundMap[101].round, 1);
  assert.equal(result.taskRoundMap[102].round, 2);
  assert.equal(result.taskRoundMap[201].round, 1);
  assert.equal(result.taskRoundMap[202].round, 3); // matched day 7 offset (+6 days)
});
