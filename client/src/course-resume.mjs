const key = (userId) => `course-resume:${userId}`;

export function rememberCourse(storage, userId, courseId, navigationTarget) {
  try {
    storage.setItem(key(userId), JSON.stringify({ courseId, navigationTarget }));
  } catch {
    /* 存储不可用时仍允许正常切换功能。 */
  }
}

export function recalledCourse(storage, userId) {
  try {
    const value = JSON.parse(storage.getItem(key(userId)));
    return Number.isSafeInteger(Number(value?.courseId)) && Number(value.courseId) > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

export function forgetCourse(storage, userId) {
  try {
    storage.removeItem(key(userId));
  } catch {
    /* 不阻止返回列表。 */
  }
}
