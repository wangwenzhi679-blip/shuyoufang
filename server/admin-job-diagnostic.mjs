// Return only recognised diagnostic facts. Provider errors can contain prompts or secrets.
export function jobDiagnostic(job) {
  if (job.status !== 'failed') return null;
  const error = String(job.error_text || '').slice(0, 16384);
  const rules = [
    ['RESTART', '服务重启', /重启|service restarted/i, '后台执行', '确认服务已稳定，再重试任务。'],
    [
      'AUTH',
      '服务鉴权',
      /\b401\b|鉴权|api.?key|authentication/i,
      '模型请求',
      '检查服务配置中的密钥，并执行连接检查。',
    ],
    [
      'ACCESS',
      '服务权限',
      /\b403\b|permission denied|access denied/i,
      '模型请求',
      '检查模型是否开通及服务账号权限。',
    ],
    [
      'RATE_LIMIT',
      '请求受限',
      /\b429\b|限流|rate.?limit/i,
      '模型请求',
      '检查服务额度，降低并发或稍后重试。',
    ],
    [
      'TIMEOUT',
      '响应超时',
      /timeout|timed out|超时/i,
      '模型请求',
      '检查网络与服务状态，必要时调整请求超时。',
    ],
    [
      'CONNECTION',
      '连接异常',
      /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|网络/i,
      '模型请求',
      '检查服务地址、网络和连接检查结果。',
    ],
    [
      'STORAGE',
      '数据保存',
      /ENOSPC|ER_|database|数据库|写入失败|保存失败/i,
      '结果保存',
      '检查数据库连接、磁盘空间和当前内容版本。',
    ],
    [
      'CONFLICT',
      '内容冲突',
      /版本|冲突|资料(?:或章节)?已变化|原 PDF 已变化/i,
      '版本校验',
      '查看课程与资料是否已更新，再发起新的任务。',
    ],
    [
      'VISION_UNSUPPORTED',
      '模型不支持图片',
      /不支持图片输入|不支持图片识别/i,
      '图片识读',
      '在设置中选择支持图片输入的模型，再重新生成；不会自动切换模型。',
    ],
    [
      'OCR',
      '原页识读',
      /OCR|图片仍无法辨认|原页图片没有可用正文|原页没有可用文字/i,
      '资料准备',
      '查看任务提示的原页。可使用支持图片输入的模型读取本章原图，或补充本章修正文字后重新出题。',
    ],
    [
      'RESPONSE',
      '返回格式',
      /JSON|解析|格式|schema|unexpected token|校验失败|输出为空|输出不完整/i,
      '结果解析',
      '检查服务模型和返回格式，确认资料有效后重试。',
    ],
    [
      'MATERIAL',
      '资料处理',
      /未识别的公式|资料|文字提取|原件|原文件|原 PDF/i,
      '资料准备',
      '查看本章页码范围、原件与提取状态；必要时补充本章修正文字。',
    ],
  ];
  const found = rules.find(([, , pattern]) => pattern.test(error));
  const [, category, , stage, hint] = found || [
    'UNKNOWN',
    '未分类',
    null,
    '未记录',
    '结合任务编号、服务状态与课程资料检查；信息不足时查看服务器日志。',
  ];
  const status = error.match(/\b(400|401|402|403|404|408|413|422|429|500|502|503|504)\b/);
  return {
    code: found?.[0] || 'UNKNOWN',
    category,
    stage,
    httpStatus: status ? Number(status[1]) : null,
    hint: hint + ' 如仍有问题，请联系管理员。',
    sourcePage: Number(error.match(/第\s*(\d+)\s*页/)?.[1]) || null,
  };
}

export function jobErrorSummary(status, error = '') {
  if (status === 'cancelled') return '任务已取消';
  if (status !== 'failed') return '';
  const diagnostic = jobDiagnostic({ status, error_text: error });
  const summaries = {
    RESTART: '服务重启，生成中断',
    AUTH: 'AI 服务鉴权失败',
    ACCESS: 'AI 服务权限不足',
    RATE_LIMIT: 'AI 服务请求受限',
    TIMEOUT: 'AI 服务响应超时',
    CONNECTION: 'AI 服务连接异常',
    STORAGE: '生成结果保存失败',
    CONFLICT: '资料或章节已变化，请重新生成',
    VISION_UNSUPPORTED: '当前模型不支持图片，请选择支持图片输入的模型',
    OCR: '本章原页识读未通过，可改用图片识读或补充正文',
    RESPONSE: 'AI 返回内容未通过校验，请调整要求或模型后重试',
    MATERIAL: '本章资料无法使用，请检查页码范围与提取状态',
    UNKNOWN: '生成未完成，请查看任务详情后重新生成',
  };
  return (
    (summaries[diagnostic.code] || summaries.UNKNOWN) +
    (diagnostic.sourcePage ? `（原 PDF 第 ${diagnostic.sourcePage} 页）` : '') +
    '。如仍有问题，请联系管理员。'
  );
}
