// Only documented legacy aliases are translated; unfamiliar values remain visible.
export function questionTypeLabel(type) {
  return type === 'choice' ? '单选题' : type;
}

// Unlabelled options use stable letters instead of a Chinese word's first character.
export function optionLetter(option, index) {
  const matched = String(option || '')
    .trim()
    .match(/^([A-Z])[、.．:：\s]/i);
  return matched ? matched[1].toUpperCase() : String.fromCharCode(65 + index);
}

export function answerLetters(answer, options = [], type) {
  const text = String(answer || '').trim();
  if (type !== '判断题') return text.toUpperCase().match(/[A-Z]/g) || [];
  const index = options.findIndex((option) => {
    const value = String(option || '').trim();
    return value === text || value.replace(/^[A-Z][、.．:：\s]\s*/i, '') === text;
  });
  if (index >= 0) return [optionLetter(options[index], index)];
  const key = text.toUpperCase();
  return /^[A-Z]$/.test(key) && options.some((option, index) => optionLetter(option, index) === key)
    ? [key]
    : [];
}

export function selectionLetters(answer, options = [], type) {
  const values = Array.isArray(answer) ? answer : type === '判断题' ? [answer] : [];
  if (type !== '判断题') return values;
  // Keep unrecognised entries so an extra invalid selection cannot become correct.
  return values.map((value) => {
    const letters = answerLetters(value, options, type);
    return letters.length === 1 ? letters[0] : value;
  });
}
