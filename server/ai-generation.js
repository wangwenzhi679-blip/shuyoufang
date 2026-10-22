import { withAdminHelp } from './error-help.mjs';
// Only malformed/truncated output is retryable; auth, quota, network and cancellation are not.
export async function generateValidated({
  ask,
  messages,
  signal,
  validate,
  label = '生成结果',
  maxOutputTokens = 4096,
  options = {},
  jsonObject = true,
}) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    let raw;
    try {
      raw = await ask(
        attempt
          ? [
              ...messages,
              {
                role: 'user',
                content: `上次${label}不符合要求：${failure?.message || '输出为空或被截断'}。请重新输出完整结果，严格遵守原格式、范围和数量要求，精简说明，不输出分析过程。`,
              },
            ]
          : messages,
        signal,
        {
          ...options,
          thinking: false,
          ...(jsonObject ? { jsonObject: true } : {}),
          maxOutputTokens: Math.min(32768, maxOutputTokens * (attempt ? 2 : 1)),
        },
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (!['AI_OUTPUT_LIMIT', 'AI_EMPTY_RESPONSE'].includes(error.code)) throw error;
      failure = error;
      continue;
    }
    signal?.throwIfAborted();
    try {
      if (typeof raw !== 'string' || !raw.trim()) throw new Error('输出为空');
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      return validate(jsonObject ? JSON.parse(cleaned) : raw);
    } catch (error) {
      failure = error;
    }
  }
  throw Object.assign(
    new Error(
      `${label}校验失败：${failure?.message || '输出不完整'}。请调整要求或检查模型设置后重试`,
    ),
    { status: 502, code: 'AI_INVALID_RESULT' },
  );
}

export function generationError(error, fallback) {
  return withAdminHelp(
    ([400, 401, 402, 403, 404, 409, 422, 429, 502, 503].includes(error.status)
      ? error.message
      : fallback
    ).slice(0, 460),
  );
}
