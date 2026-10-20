import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLearningReturn, restoreLearningViewport } from './learning-return.mjs';

test('问助手前保存原页锚点、页内比例、缩放及页面和目录位置', () => {
  const block = {
    dataset: { readingAnchor: 'pdf:153:9' },
    offsetHeight: 2000,
    getBoundingClientRect: () => ({ top: -580 }),
  };
  const reader = {
    scrollTop: 600,
    getBoundingClientRect: () => ({ top: 20 }),
    querySelectorAll: () => [block],
    closest: () => ({}),
  };
  const outline = { scrollLeft: 240, scrollTop: 80 };
  const root = { querySelector: (selector) => (selector === '.outline-list' ? outline : reader) };
  const location = captureLearningReturn(root, {
    scrollX: 0,
    scrollY: 420,
    getComputedStyle: () => ({ getPropertyValue: () => '75%' }),
  });
  assert.deepEqual(location, {
    scroll: { left: 0, top: 420 },
    outline: { left: 240, top: 80 },
    reading: { position: { index: 0, anchor: 'pdf:153:9', offset: 0.3 }, zoom: 75 },
  });
  reader.scrollTop = 1000;
  assert.equal(location.reading.position.offset, 0.3, '保存的是独立快照，而非可变阅读状态');
});

test('从笔记或练习问助手时，没有正文也能保存页面位置', () => {
  const location = captureLearningReturn(
    { querySelector: () => null },
    { scrollX: 0, scrollY: 700 },
  );
  assert.equal(location.reading, null);
  assert.equal(location.scroll.top, 700);
});

test('返回后恢复页面和目录，并将焦点放回问助手按钮而不二次滚动', () => {
  const calls = [];
  const root = {
    querySelector: (selector) =>
      selector === '.outline-list'
        ? { scrollTo: (options) => calls.push(['outline', options]) }
        : { focus: (options) => calls.push(['focus', options]) },
  };
  restoreLearningViewport(
    root,
    {
      scroll: { left: 0, top: 420 },
      outline: { left: 240, top: 80 },
    },
    { scrollTo: (options) => calls.push(['page', options]) },
  );
  assert.deepEqual(calls, [
    ['outline', { left: 240, top: 80 }],
    ['page', { left: 0, top: 420, behavior: 'instant' }],
    ['focus', { preventScroll: true }],
  ]);
});
