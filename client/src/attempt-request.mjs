// A failed request keeps its identifier across refresh; a confirmed submission starts a new round.
export function pendingAttempt(storage, key, answers, uuid) {
  const fingerprint = JSON.stringify(
    answers
      .map((a) => ({
        questionIndex: a.questionIndex,
        answer: Array.isArray(a.answer) ? [...a.answer].sort() : a.answer,
      }))
      .sort((a, b) => a.questionIndex - b.questionIndex),
  );
  let previous;
  try {
    previous = JSON.parse(storage.getItem(key));
  } catch {}
  if (previous?.fingerprint === fingerprint && typeof previous.id === 'string') return previous.id;
  const id = uuid();
  storage.setItem(key, JSON.stringify({ id, fingerprint }));
  return id;
}
