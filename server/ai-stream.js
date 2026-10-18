const MAX_ANSWER_LENGTH = 60000;
const responseErrors = {
  401: 'AI 服务鉴权失败',
  429: 'AI 服务请求受限',
};
const fail = (message) => Object.assign(new Error(message), { status: 502 });

async function readJsonAnswer(response, onChunk, signal) {
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw fail('AI 服务未返回有效内容');
  signal?.throwIfAborted();
  await onChunk(content);
  return content;
}

async function readStreamingAnswer(body, onChunk, signal) {
  if (!body) throw fail('AI 服务未返回有效内容');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pendingText = '';
  let answer = '';
  let receivedDone = false;
  let receivedFinishReason = false;

  async function consumeLine(line) {
    if (!line.startsWith('data:')) return;
    const value = line.slice(5).trim();
    if (value === '[DONE]') {
      receivedDone = true;
      return;
    }
    if (!value) return;

    let payload;
    try {
      payload = JSON.parse(value);
    } catch {
      throw fail('AI 返回的数据不完整，请重试');
    }
    if (payload.error) throw fail('AI 服务生成中断，请重试');
    const choice = payload.choices?.[0];
    if (choice?.finish_reason) receivedFinishReason = true;
    const text = choice?.delta?.content;
    if (typeof text !== 'string' || !text) return;

    answer += text;
    if (answer.length > MAX_ANSWER_LENGTH) throw fail('回答过长，请缩小问题范围');
    await onChunk(text);
  }

  try {
    while (!receivedDone) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      pendingText += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      let newline;
      while ((newline = pendingText.indexOf('\n')) >= 0) {
        await consumeLine(pendingText.slice(0, newline).replace(/\r$/, ''));
        pendingText = pendingText.slice(newline + 1);
        if (receivedDone) break;
      }
      if (chunk.done) {
        if (pendingText.trim()) await consumeLine(pendingText.trim());
        break;
      }
    }
    signal?.throwIfAborted();
    if (!receivedDone && !receivedFinishReason) throw fail('AI 回答中断，可保留已收到的内容并重试');
    if (!answer.trim()) throw fail('AI 服务未返回有效内容');
    return answer;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readChatStream(response, onChunk, signal) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw fail(responseErrors[response.status] || 'AI 服务暂时无法回答');
  }
  // Compatible providers may return a JSON answer even when streaming was requested.
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    return readJsonAnswer(response, onChunk, signal);
  }
  return readStreamingAnswer(response.body, onChunk, signal);
}
