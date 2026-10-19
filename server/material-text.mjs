// 资料解析后的纯文本清理与章节题目筛选，不负责上传、OCR 或数据库读写。
export function formatExtractedText(value) {
  return String(value || '')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<\/?(div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractQuestionBlocks(text) {
  const source = formatExtractedText(text);
  const starts = [...source.matchAll(/(?:^|\s)(\d{1,3})\.\s+(?=[\u4e00-\u9fa5A-Za-z“"‘'])/g)];
  return starts
    .map((match, index) => {
      const start = match.index + match[0].lastIndexOf(match[1]);
      const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
      return { number: Number(match[1]), content: source.slice(start, end).trim() };
    })
    .filter((item) => item.content.length > 50);
}

export function selectChapterQuestions(materials, chapter) {
  const source = `${chapter.title || ''} ${chapter.description || ''}`.replace(
    /[\s，,。；;：:（）()【】\[\]]/g,
    '',
  );
  const phrases = new Set();
  for (const term of source.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    for (let size = 2; size <= Math.min(6, term.length); size += 1) {
      for (let start = 0; start <= term.length - size; start += 1)
        phrases.add(term.slice(start, start + size));
    }
  }
  return materials
    .flatMap((material) =>
      extractQuestionBlocks(material.extracted_text).map((item) => {
        const score = [...phrases].reduce(
          (total, phrase) =>
            total + (item.content.includes(phrase) ? phrase.length * phrase.length : 0),
          0,
        );
        return {
          materialId: material.id,
          materialName: material.original_name,
          content: item.content,
          score,
        };
      }),
    )
    .filter((item) => item.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ score, ...item }) => item);
}
