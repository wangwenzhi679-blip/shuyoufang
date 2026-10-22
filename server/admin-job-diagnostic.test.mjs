import test from 'node:test';
import assert from 'node:assert/strict';
import { jobDiagnostic, jobErrorSummary } from './admin-job-diagnostic.mjs';

test('OCR明确标记原页，AI校验与资料冲突不会再误报原文件损坏', () => {
  for (const [text, code] of [
    ['OCR 识别置信度过低或文字无效，请检查原页清晰度', 'OCR'],
    ['原 PDF 第 17 页 OCR 识别置信度过低', 'OCR'],
    ['资料或章节已变化，请学习者重新生成', 'CONFLICT'],
    ['练习题目校验失败：JSON文字格式不正确', 'RESPONSE'],
    ['当前设置的模型不支持图片输入，请选择图片模型', 'VISION_UNSUPPORTED'],
    ['当前模型不可用，请检查设置', 'MODEL_UNAVAILABLE'],
    ['HTTP 401 资料 PRIVATE sk-SECRET', 'AUTH'],
  ]) {
    assert.equal(jobDiagnostic({ status: 'failed', error_text: text }).code, code);
    const summary = jobErrorSummary('failed', text);
    assert.match(summary, /如仍有问题，请联系管理员/);
    assert.doesNotMatch(summary, /PRIVATE|SECRET|原文件损坏/);
  }
  assert.match(jobErrorSummary('failed', '原 PDF 第 17 页 OCR 识别置信度过低'), /第 17 页/);
  assert.equal(jobErrorSummary('done', 'OCR识别失败'), '');
  assert.match(jobErrorSummary('failed', '当前模型不支持图片输入'), /请打开设置.*更换.*模型/);
  assert.match(jobErrorSummary('failed', '当前模型不可用'), /请打开设置.*更换.*模型/);
});
