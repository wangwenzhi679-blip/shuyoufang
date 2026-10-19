// 仅按完整标题行定位章节，避免将目录、正文提及或下一章误作当前章内容。
export function normalizeChapterTitle(value = '') {
  return String(value)
    .replace(/^\s*(第[一二三四五六七八九十百\d]+[章节]|\d+[.、．])\s*/, '')
    .replace(/[：:，,。；;（）()【】\[\]\s]/g, '')
    .trim();
}

export function chapterHeadingNumber(value) {
  const match = String(value)
    .trim()
    .match(/^第([零〇一二三四五六七八九十百两\d]+)章/);
  if (!match) return null;
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  const digits = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  let total = 0,
    digit = 0;
  for (const char of match[1]) {
    if (char === '十' || char === '百') {
      total += (digit || 1) * (char === '十' ? 10 : 100);
      digit = 0;
    } else digit = digits[char];
  }
  return total + digit;
}

export function findChapterPosition(text, title, after = 0) {
  const cleanTitle = normalizeChapterTitle(title);
  if (!cleanTitle) return -1;
  const expectedNumber = chapterHeadingNumber(title);
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    if (match.index < after) continue;
    const line = match[0].trim();
    // 只匹配完整标题行，正文中的提及、点线目录和带页码目录都不作为起点。
    if (normalizeChapterTitle(line) !== cleanTitle) continue;
    const actualNumber = chapterHeadingNumber(line);
    if (expectedNumber !== null && actualNumber !== null && expectedNumber !== actualNumber)
      continue;
    return match.index + match[0].indexOf(line);
  }
  return -1;
}

export function sliceChapterText(text, currentChapter, laterChapters) {
  const start = findChapterPosition(text, currentChapter.title);
  if (start < 0) return null;
  const lineEnd = text.indexOf('\n', start);
  const after = lineEnd < 0 ? text.length : lineEnd + 1;
  const laterStarts = laterChapters
    .map((chapter) => findChapterPosition(text, chapter.title, after))
    .filter((position) => position > start);
  // 即使用户尚未建立下一章，也不把原资料中的下一章正文拼进当前章。
  const currentNumber = chapterHeadingNumber(
    text.slice(start, lineEnd < 0 ? text.length : lineEnd),
  );
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    if (match.index < after) continue;
    const line = match[0].trim();
    if (line.length > 120 || /(?:[.．·…]{2,}|\s\d+)\s*$/.test(line)) continue;
    const nextNumber = chapterHeadingNumber(line);
    if (nextNumber !== null && (currentNumber === null || nextNumber !== currentNumber)) {
      laterStarts.push(match.index);
      break;
    }
  }
  const end = laterStarts.length ? Math.min(...laterStarts) : text.length;
  const content = text.slice(start, end).trim();
  return content.length > 80 ? content : null;
}
