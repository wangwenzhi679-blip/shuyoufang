const adminHelp = '如仍有问题，请联系管理员。';
const modelHelp = '请打开设置，更换可用的模型后重试';

// Only explicit model/capability/configuration failures should suggest changing models.
export function isModelIssue(message) {
  const text = String(message || '');
  return /模型[^。\n]{0,70}(?:不支持|不可用|不存在|未开通|未启用|停用|暂停|配置|无效)|(?:不支持|停用|暂停)[^。\n]{0,30}模型|(?:请选择|更换|选择)[^。\n]{0,30}模型|model[_\s-]?(?:not[_\s-]?found|unavailable|unsupported)|不支持图片输入|不支持图片识别|AI 请求参数不被当前服务接受/i.test(
    text,
  );
}

export function withAdminHelp(message) {
  const text = String(message || '操作未完成，请稍后重试').trim();
  if (isModelIssue(text)) {
    if (/请打开设置.*更换.*模型/.test(text))
      return /联系管理员/.test(text)
        ? text
        : `${text.replace(/[。.!！?？\s]+$/u, '')}。${adminHelp}`;
    const base = text
      .replace(/(?:。\s*)?如仍有问题，请联系管理员[。\s]*$/u, '')
      .replace(/[。.!！?？\s]+$/u, '');
    return `${base}。${modelHelp}；${adminHelp}`;
  }
  return /联系管理员/.test(text) ? text : `${text.replace(/[。.!！?？\s]+$/u, '')}。${adminHelp}`;
}
