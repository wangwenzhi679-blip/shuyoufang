export function splitImportedContent(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const candidates = [
    ...text.matchAll(
      /(?<!\d)(?:第\s*\d{1,5}\s*题[.、．：:]?|\d{1,5}[.、．：:](?!\d)|[（(]\d{1,5}[）)])[ \t]*(?=\S)/g,
    ),
  ];
  // 有正式题号时，（1）（2）属于题内小问，不另拆成题目。
  const hasMainNumbers = candidates.some((match) => !/^[（(]/.test(match[0]));
  const mainCandidates = hasMainNumbers
    ? candidates.filter((match) => !/^[（(]/.test(match[0]))
    : candidates;
  const starts = mainCandidates.filter((match, index) => {
    if (hasMainNumbers && /^[（(]/.test(match[0])) return false;
    const previousLine = text.slice(text.lastIndexOf('\n', match.index - 1) + 1, match.index);
    if (!previousLine.trim()) return true;
    const block = text.slice(match.index, mainCandidates[index + 1]?.index ?? text.length);
    return /A[.、．：:]/.test(block) && /B[.、．：:]/.test(block);
  });
  if (!starts.length) return { introduction: '', blocks: [text] };
  return {
    introduction: text.slice(0, starts[0].index).trim(),
    blocks: starts.map((match, index) => {
      let block = text.slice(match.index, starts[index + 1]?.index ?? text.length).trim();
      if (/A[.、．：:]/.test(block) && /B[.、．：:]/.test(block)) {
        block = block
          .replace(/[ \t]*([A-H])[.、．：:][ \t]*/g, '\n$1. ')
          .replace(/[ \t]*(正确答案|参考答案|答案|解析)[：:]/g, '\n$1：');
      }
      return block;
    }),
  };
}
