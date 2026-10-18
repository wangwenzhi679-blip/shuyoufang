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
      /版本|冲突|资料已变化/i,
      '版本校验',
      '查看课程与资料是否已更新，再发起新的任务。',
    ],
    [
      'MATERIAL',
      '资料处理',
      /资料|文字|识别|原件|原文件/i,
      '资料准备',
      '查看课程资料详情，检查原件和文字提取状态。',
    ],
    [
      'RESPONSE',
      '返回格式',
      /JSON|解析|格式|schema|unexpected token/i,
      '结果解析',
      '检查服务模型和返回格式，确认资料有效后重试。',
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
    hint,
  };
}
