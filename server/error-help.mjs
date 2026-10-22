export function withAdminHelp(message) {
  const text = String(message || '操作未完成，请稍后重试').trim();
  return /联系管理员/.test(text)
    ? text
    : text.replace(/[。.!！?？\s]+$/u, '') + '。如仍有问题，请联系管理员。';
}
