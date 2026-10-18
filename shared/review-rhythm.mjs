export const REVIEW_RHYTHM_DAYS = Object.freeze([1, 3, 7, 14, 30]);

export const REVIEW_RHYTHM_STAGES = Object.freeze([
  Object.freeze({
    round: 1,
    day: 1,
    label: '第1轮',
    dayLabel: '第1天',
    title: '初次唤醒',
    retentionBefore: 42,
    retentionAfter: 100,
    forgottenRetention: 33,
    decayK: 2.6,
    note: '初次学习后遗忘最快，24 小时内及时回看，可阻止近六成记忆流失。',
  }),
  Object.freeze({
    round: 2,
    day: 3,
    label: '第2轮',
    dayLabel: '第3天',
    title: '短期巩固',
    retentionBefore: 56,
    retentionAfter: 100,
    forgottenRetention: 26,
    decayK: 2.2,
    note: '第 3 天二次强化，修补短期遗忘缺口，解题思路与关键步骤开始稳定。',
  }),
  Object.freeze({
    round: 3,
    day: 7,
    label: '第3轮',
    dayLabel: '第7天',
    title: '周期强化',
    retentionBefore: 68,
    retentionAfter: 100,
    forgottenRetention: 22,
    decayK: 1.85,
    note: '满一周复盘易错卡点，记忆衰减明显放缓，由短期记忆过渡至中期保持。',
  }),
  Object.freeze({
    round: 4,
    day: 14,
    label: '第4轮',
    dayLabel: '第14天',
    title: '深层内化',
    retentionBefore: 78,
    retentionAfter: 100,
    forgottenRetention: 19,
    decayK: 1.55,
    note: '两周节点再次主动提取，同类题型的条件反射与方法迁移逐渐成型。',
  }),
  Object.freeze({
    round: 5,
    day: 30,
    label: '第5轮',
    dayLabel: '第30天',
    title: '长期沉淀',
    retentionBefore: 86,
    retentionAfter: 100,
    forgottenRetention: 16,
    decayK: 1.25,
    note: '满月终轮回看，记忆保持率稳定在 85% 以上，真正内化为长期掌握。',
  }),
]);

export function isReviewDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addReviewDays(day, offset) {
  if (!isReviewDate(day) || !Number.isInteger(offset)) throw new RangeError('复习日期不正确');
  const parsed = new Date(`${day}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

// First review is day 1. Later dates stay anchored to that same starting day.
export function buildReviewDates(firstReview, strategy = 'single') {
  if (!['single', 'spaced'].includes(strategy)) throw new RangeError('复习方式不正确');
  if (!isReviewDate(firstReview)) throw new RangeError('复习日期不正确');
  return strategy === 'spaced'
    ? REVIEW_RHYTHM_DAYS.map((day) => addReviewDays(firstReview, day - 1))
    : [firstReview];
}

function diffReviewDays(startDay, endDay) {
  if (!isReviewDate(startDay) || !isReviewDate(endDay)) return null;
  const startMs = Date.parse(`${startDay}T12:00:00Z`);
  const endMs = Date.parse(`${endDay}T12:00:00Z`);
  return Math.round((endMs - startMs) / 86400000);
}

export function summarizeReviewRhythm(tasks = [], today = '') {
  const safeTasks = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  const groups = new Map();

  for (const task of safeTasks) {
    if (task.status === 'cancelled') continue;
    const key =
      task.wrongQuestionId != null
        ? `q:${task.wrongQuestionId}`
        : `t:${task.courseTitle || ''}:${task.chapterTitle || ''}:${task.title || task.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }

  const taskRoundMap = {};
  const roundBuckets = REVIEW_RHYTHM_STAGES.map((stage) => ({
    ...stage,
    pending: 0,
    due: 0,
    completed: 0,
    correct: 0,
    total: 0,
    taskIds: [],
  }));

  for (const groupTasks of groups.values()) {
    const sorted = [...groupTasks].sort((a, b) => {
      const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
      return dateCmp !== 0 ? dateCmp : (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    const anchorDate = sorted[0]?.date;
    const usedRounds = new Set();

    sorted.forEach((task, index) => {
      const offset = anchorDate ? diffReviewDays(anchorDate, task.date) : null;
      const rhythmDay = offset != null ? offset + 1 : null;
      const matchedIndex = rhythmDay != null ? REVIEW_RHYTHM_DAYS.indexOf(rhythmDay) : -1;

      let roundIndex = -1;
      if (matchedIndex !== -1 && !usedRounds.has(matchedIndex)) {
        roundIndex = matchedIndex;
      } else {
        for (
          let candidate = Math.min(index, REVIEW_RHYTHM_STAGES.length - 1);
          candidate < REVIEW_RHYTHM_STAGES.length;
          candidate++
        ) {
          if (!usedRounds.has(candidate)) {
            roundIndex = candidate;
            break;
          }
        }
        if (roundIndex === -1) roundIndex = REVIEW_RHYTHM_STAGES.length - 1;
      }
      usedRounds.add(roundIndex);

      const bucket = roundBuckets[roundIndex];
      if (task.id != null) {
        taskRoundMap[task.id] = {
          round: bucket.round,
          day: bucket.day,
          label: bucket.label,
          dayLabel: bucket.dayLabel,
          title: bucket.title,
        };
        bucket.taskIds.push(task.id);
      }
      if (task.status === 'completed') {
        bucket.completed += 1;
        if (task.correct) bucket.correct += 1;
      } else if (task.status === 'pending') {
        bucket.pending += 1;
        if (task.available !== false && today && String(task.date) <= String(today)) {
          bucket.due += 1;
        }
      }
      bucket.total = bucket.pending + bucket.completed;
    });
  }

  const totals = roundBuckets.reduce(
    (acc, item) => ({
      questionCount: groups.size,
      pendingCount: acc.pendingCount + item.pending,
      dueCount: acc.dueCount + item.due,
      completedCount: acc.completedCount + item.completed,
      totalCount: acc.totalCount + item.total,
    }),
    { questionCount: groups.size, pendingCount: 0, dueCount: 0, completedCount: 0, totalCount: 0 },
  );

  return { rounds: roundBuckets, taskRoundMap, totals };
}
