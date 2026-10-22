import test from 'node:test';
import assert from 'node:assert/strict';
import { withAdminHelp, isModelIssue } from './error-help.mjs';

test('模型能力和停用错误提示更换设置，重复处理不叠加提示', () => {
  for (const message of [
    '当前设置的 DeepSeek V4 Pro 不支持图片输入',
    '该模型已停用，请重新选择',
    'AI 接口或模型不可用，请检查设置',
    'AI 请求参数不被当前服务接受，请检查模型及配置',
    '请选择设置中可用的 AI 模型',
    'model_not_found',
  ]) {
    assert.equal(isModelIssue(message), true, message);
    const result = withAdminHelp(message);
    assert.match(result, /请打开设置.*更换.*模型/);
    assert.match(result, /联系管理员/);
    assert.equal(withAdminHelp(result), result);
  }
});

test('网络、OCR、存储和额度错误不误导用户更换模型', () => {
  for (const message of [
    'AI 请求超时，请稍后重试',
    'AI 网络连接失败，请检查服务连接后重试',
    '原 PDF 第 17 页 OCR 识别置信度过低',
    '数据库写入失败',
    'AI 服务额度不足，请检查账户额度',
    '模型请求超时，请稍后重试',
  ]) {
    assert.equal(isModelIssue(message), false, message);
    const result = withAdminHelp(message);
    assert.doesNotMatch(result, /请打开设置/);
    assert.equal(withAdminHelp(result), result);
  }
});
