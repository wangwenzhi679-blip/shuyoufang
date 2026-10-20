export function hashReadingText(text) {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

export function readingBlocks(container) {
  return [
    ...(container?.querySelectorAll(
      '.imported-introduction,.imported-question,.original-pdf-page',
    ) || []),
  ];
}

export function readingAnchor(block) {
  return block.dataset?.readingAnchor || hashReadingText(block.textContent);
}

export function findReadingBlock(blocks, position) {
  if (!position.anchor) return blocks[position.index];
  const exact = blocks.find((block) => readingAnchor(block) === position.anchor);
  if (exact) return exact;
  // 旧版 PDF 位置将加载提示也计入哈希，兼容这些旧记录的原页顺序。
  const indexed = blocks[position.index];
  if (/^[a-f\d]{1,8}$/.test(position.anchor) && indexed?.classList.contains('original-pdf-page'))
    return indexed;
  return null;
}

export function captureReadingPosition(container, page) {
  if (page)
    return {
      page,
      index: 0,
      anchor: 'pdf-page',
      offset: Math.min(
        1,
        Math.max(
          0,
          container.scrollTop /
            Math.max(
              1,
              container.querySelector?.('.document-scaled-page')?.offsetHeight ||
                container.scrollHeight,
            ),
        ),
      ),
    };
  if (container.scrollTop <= 1) return { index: 0, anchor: 'start', offset: 0 };
  const blocks = readingBlocks(container);
  const top = container.getBoundingClientRect().top;
  let index = 0;
  for (let current = 0; current < blocks.length; current++) {
    if (blocks[current].getBoundingClientRect().top <= top + 12) index = current;
    else break;
  }
  const block = blocks[index];
  return {
    index,
    anchor: block ? readingAnchor(block) : '',
    offset: block
      ? Math.min(
          1,
          Math.max(0, (top - block.getBoundingClientRect().top) / Math.max(1, block.offsetHeight)),
        )
      : 0,
  };
}

export function stableReadingPosition(container, position) {
  if (position.page || position.anchor === 'start') return position;
  const block = findReadingBlock(readingBlocks(container), position);
  return block ? { ...position, anchor: readingAnchor(block) } : null;
}

export function applyReadingPosition(container, position) {
  if (position.anchor === 'start') {
    container.scrollTop = 0;
    return true;
  }
  if (position.page) {
    const height =
      position.anchor === 'pdf-page'
        ? container.querySelector?.('.document-scaled-page')?.offsetHeight || container.scrollHeight
        : container.scrollHeight - container.clientHeight;
    container.scrollTop = position.offset * Math.max(1, height);
    return true;
  }
  const block = findReadingBlock(readingBlocks(container), position);
  if (!block) return false;
  container.scrollTop +=
    block.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    position.offset * block.offsetHeight;
  return true;
}
