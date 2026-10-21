import { requestJson, requestUpload } from './api-client.mjs';
import { API_ROOT } from './api-base.mjs';

export const api = `${API_ROOT}/`;

export async function uploadFiles(path, { token, files, importKey, onProgress, signal }) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  if (importKey) form.append('importKey', importKey);
  if (onProgress) return requestUpload(path, { token, body: form, onProgress, signal });
  return requestJson(path, { token, method: 'POST', body: form, errorMessage: '资料上传失败' });
}
