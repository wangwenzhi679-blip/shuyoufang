import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureReadingPosition,
  applyReadingPosition,
  hashReadingText,
  stableReadingPosition,
} from './reading-position.mjs';

function reader(definitions, viewport = 400) {
  let top = 0;
  const container = {
    clientHeight: viewport,
    get scrollTop() {
      return top;
    },
    set scrollTop(value) {
      top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    },
    get scrollHeight() {
      return Math.max(viewport, ...blocks.map((block) => block.top + block.offsetHeight + 100));
    },
    getBoundingClientRect: () => ({ top: 20 }),
    querySelectorAll: () => blocks,
    querySelector: () => null,
  };
  const blocks = definitions.map((definition) => ({
    textContent: '',
    dataset: {},
    ...definition,
    classList: { contains: (name) => name === 'original-pdf-page' && Boolean(definition.pdf) },
    getBoundingClientRect() {
      return { top: 20 + this.top - container.scrollTop };
    },
  }));
  return { container, blocks };
}

test('PDF 原页的定位不受加载提示与错误文字变化影响', () => {
  const { container, blocks } = reader([
    {
      top: 0,
      offsetHeight: 1600,
      pdf: true,
      dataset: { readingAnchor: 'pdf:12:8' },
      textContent: '原资料 · 第 8 页正在加载原页…',
    },
  ]);
  container.scrollTop = 400;
  const position = captureReadingPosition(container);
  blocks[0].textContent = '原资料 · 第 8 页';
  assert.equal(position.anchor, 'pdf:12:8');
  assert.equal(applyReadingPosition(container, position), true);
  assert.equal(container.scrollTop, 400);
});

test('图片加载及全屏改变布局后，恢复同一原页的页内比例', () => {
  const { container, blocks } = reader([
    { top: 0, offsetHeight: 1000, pdf: true, dataset: { readingAnchor: 'pdf:12:1' } },
    { top: 1000, offsetHeight: 1600, pdf: true, dataset: { readingAnchor: 'pdf:12:2' } },
  ]);
  container.scrollTop = 1400;
  const position = captureReadingPosition(container);
  assert.equal(position.offset, 0.25);
  blocks[0].offsetHeight = 2000;
  blocks[1].top = 2000;
  blocks[1].offsetHeight = 3200;
  container.clientHeight = 800;
  applyReadingPosition(container, position);
  assert.equal(container.scrollTop, 2800);
  assert.equal(captureReadingPosition(container).anchor, 'pdf:12:2');
  assert.equal(captureReadingPosition(container).offset, 0.25);
});

test('兼容旧 PDF 哈希记录，目标暂未加载时也不会被升级成前一页', () => {
  const { container, blocks } = reader(
    [
      { top: 0, offsetHeight: 2000, pdf: true, dataset: { readingAnchor: 'pdf:12:1' } },
      { top: 2000, offsetHeight: 300, pdf: true, dataset: { readingAnchor: 'pdf:12:2' } },
    ],
    800,
  );
  const position = stableReadingPosition(container, { index: 1, anchor: 'abc123', offset: 0.5 });
  assert.equal(position.anchor, 'pdf:12:2');
  applyReadingPosition(container, position);
  assert.equal(container.scrollTop, 1600);
  blocks[1].offsetHeight = 1600;
  applyReadingPosition(container, position);
  assert.equal(container.scrollTop, 2800);
});

test('资料或页码确实改变时，不使用相同序号冒充原页', () => {
  const { container } = reader([
    { top: 0, offsetHeight: 1000, pdf: true, dataset: { readingAnchor: 'pdf:99:3' } },
  ]);
  const position = { index: 0, anchor: 'pdf:12:3', offset: 0.4 };
  assert.equal(stableReadingPosition(container, position), null);
  assert.equal(applyReadingPosition(container, position), false);
});

test('文字资料仍校验正文内容，正文修改后不按旧序号错误恢复', () => {
  const { container } = reader([{ top: 0, offsetHeight: 1000, textContent: '修改后的正文' }]);
  const position = { index: 0, anchor: hashReadingText('原正文'), offset: 0.4 };
  assert.equal(stableReadingPosition(container, position), null);
});

test('阅读开头在缩放或全屏后保持开头，不跳过资料说明', () => {
  const { container } = reader([
    { top: 240, offsetHeight: 1600, pdf: true, dataset: { readingAnchor: 'pdf:12:1' } },
  ]);
  const position = captureReadingPosition(container);
  assert.equal(position.anchor, 'start');
  container.scrollTop = 200;
  assert.equal(applyReadingPosition(container, position), true);
  assert.equal(container.scrollTop, 0);
});

test('分页阅读按图片高度保存页内位置，全屏改变视口高度时不偏移', () => {
  const { container } = reader([{ top: 0, offsetHeight: 2000 }]);
  const image = { offsetHeight: 2000 };
  container.querySelector = () => image;
  container.scrollTop = 600;
  const position = captureReadingPosition(container, 7);
  container.clientHeight = 800;
  applyReadingPosition(container, position);
  assert.equal(position.page, 7);
  assert.equal(container.scrollTop, 600);
  image.offsetHeight = 4000;
  applyReadingPosition(container, position);
  assert.equal(container.scrollTop, 1200);
});

test('旧版分页阅读的滚动比例仍可恢复', () => {
  const { container } = reader([{ top: 0, offsetHeight: 1900 }]);
  applyReadingPosition(container, { page: 3, index: 0, anchor: '', offset: 0.5 });
  assert.equal(container.scrollTop, 800);
});
