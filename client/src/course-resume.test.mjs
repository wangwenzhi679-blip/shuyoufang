import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberCourse, recalledCourse, forgetCourse } from './course-resume.mjs';
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
test('course, chapter, tab, practice and reading position survive navigation', () => {
  const store = storage();
  const target = {
    chapterId: 8,
    tab: 'practice',
    practiceId: 5,
    returnLocation: {
      scroll: { top: 900 },
      reading: { position: { anchor: 'pdf:8:2' }, zoom: 130 },
    },
  };
  rememberCourse(store, 1, 3, target);
  assert.deepEqual(recalledCourse(store, 1), { courseId: 3, navigationTarget: target });
  assert.equal(recalledCourse(store, 2), null);
});
test('return to course list forgets only current account position', () => {
  const store = storage();
  rememberCourse(store, 1, 3, {});
  rememberCourse(store, 2, 4, {});
  forgetCourse(store, 1);
  assert.equal(recalledCourse(store, 1), null);
  assert.equal(recalledCourse(store, 2).courseId, 4);
});
test('corrupt or inaccessible storage does not prevent navigation', () => {
  const broken = {
    getItem: () => '{',
    setItem: () => {
      throw Error();
    },
    removeItem: () => {
      throw Error();
    },
  };
  assert.equal(recalledCourse(broken, 1), null);
  assert.doesNotThrow(() => rememberCourse(broken, 1, 3, {}));
  assert.doesNotThrow(() => forgetCourse(broken, 1));
});
