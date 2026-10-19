import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExtractedText,
  extractQuestionBlocks,
  selectChapterQuestions,
} from './material-text.mjs';

test('资料清理统一换行和空白，同时保留段落及数学文字', () => {
  assert.equal(formatExtractedText(null), '');
  assert.equal(
    formatExtractedText('<p>函数  y = 2x</p><br><div>第二段\u0000</div>'),
    '函数 y = 2x\n\n第二段',
  );
  assert.equal(
    formatExtractedText('  第一行\r\n  第二行  \r\n\r\n\r\n第三行 '),
    '第一行\n第二行\n\n第三行',
  );
});

test('按题号保留独立题块，不将小数识别为新题号', () => {
  const first = '1. 函数计算中使用小数 3.14，' + '请根据条件计算并说明理由。'.repeat(6);
  const second = '2. 第二题要求分析图像，' + '请结合已知信息解答。'.repeat(6);
  const blocks = extractQuestionBlocks(first + '\n' + second);
  assert.deepEqual(
    blocks.map((item) => item.number),
    [1, 2],
  );
  assert.equal(blocks[0].content, first);
  assert.equal(blocks[1].content, second);
  assert.deepEqual(extractQuestionBlocks('1. 太短\n2. 仍然太短'), []);
});

test('章节筛选优先匹配主题并保留来源，最多返回十二题', () => {
  const materials = [
    {
      id: 7,
      original_name: '练习资料.docx',
      extracted_text: Array.from(
        { length: 15 },
        (_, index) => `${index + 1}. 一次函数与函数图像。${'请分析条件并写出求解步骤。'.repeat(6)}`,
      ).join('\n'),
    },
  ];
  const selected = selectChapterQuestions(materials, {
    title: '一次函数',
    description: '函数图像',
  });
  assert.equal(selected.length, 12);
  assert.equal(selected[0].materialId, 7);
  assert.equal(selected[0].materialName, '练习资料.docx');
  assert.equal('score' in selected[0], false);
  assert.deepEqual(selectChapterQuestions(materials, { title: '三角形', description: '' }), []);
  assert.deepEqual(selectChapterQuestions([], { title: '一次函数' }), []);
});
