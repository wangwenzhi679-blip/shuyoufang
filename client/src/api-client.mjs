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
