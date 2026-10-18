import { requestJson } from './api-client.mjs';
import { textDocument } from '../../shared/note-document.mjs';
export const noteBase = (course, chapter) => `courses/${course}/chapters/${chapter}/note`;
export const draftKey = (user, course, chapter) => `chapter-note:${user}:${course}:${chapter}`;
export function readDraft(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return data ? { ...data, document: data.document || textDocument(data.body || '') } : null;
  } catch {
    return null;
  }
}
export function noteRequest(token, path, { method = 'GET', body } = {}) {
  return requestJson(path, { token, method, body, errorMessage: '操作失败' });
}

const database = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('learning-note-uploads', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function pendingFile(operation, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', operation === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('files');
      const request =
        operation === 'get'
          ? store.getAll()
          : operation === 'put'
            ? store.put(value)
            : store.delete(value);
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
