import { API_ROOT } from './api-base.mjs';

const responseError = (message, status) => Object.assign(new Error(message), { status });

async function sendRequest(path, options) {
  const {
    token,
    body,
    method = 'GET',
    headers: extraHeaders,
    errorMessage,
    ...fetchOptions
  } = options;
  const headers = new Headers(extraHeaders);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!isForm && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let payload;
  if (body != null) payload = isForm ? body : JSON.stringify(body);
  const response = await fetch(`${API_ROOT}/${path.replace(/^\/+/, '')}`, {
    ...fetchOptions,
    method,
    headers,
    body: payload,
  });
  if (!response.ok) await readJson(response, errorMessage || '请求失败');
  return response;
}

async function readJson(response, errorMessage) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const message = response.ok ? '服务器返回的数据无法读取，请稍后重试' : errorMessage;
      throw responseError(message, response.status);
    }
  }
  if (!response.ok) throw responseError(data?.message || errorMessage, response.status);
  return data;
}

export async function requestJson(path, options = {}) {
  const response = await sendRequest(path, options);
  return readJson(response, options.errorMessage || '请求失败');
}

export async function requestBlob(path, options = {}) {
  const response = await sendRequest(path, options);
  return response.blob();
}

// 上传需要浏览器提供的字节进度；普通 JSON 请求继续使用 fetch。
export function requestUpload(path, { token, body, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(data);
    };
    const abort = () => xhr.abort();
    if (signal?.aborted) {
      finish(new DOMException('上传已取消', 'AbortError'));
      return;
    }
    xhr.open('POST', `${API_ROOT}/${path.replace(/^\/+/, '')}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // 不设置 Content-Type，让浏览器生成 multipart 边界。
    xhr.upload.onprogress = (event) => {
      if (!settled)
        onProgress?.(
          event.lengthComputable && event.total > 0
            ? Math.min(99, Math.floor((event.loaded / event.total) * 100))
            : null,
        );
    };
    xhr.onload = async () => {
      try {
        if (!xhr.status) throw new Error('网络连接中断，资料上传失败，请重试');
        const data = await readJson(
          new Response(xhr.responseText || null, { status: xhr.status }),
          '资料上传失败，请检查文件大小或稍后重试',
        );
        onProgress?.(100);
        finish(null, data);
      } catch (error) {
        finish(error);
      }
    };
    xhr.onerror = () => finish(new Error('网络连接中断，资料上传失败，请重试'));
    xhr.ontimeout = () => finish(new Error('资料上传超时，请重试'));
    xhr.onabort = () => finish(new DOMException('上传已取消', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}
