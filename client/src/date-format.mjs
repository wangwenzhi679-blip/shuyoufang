const timeZone = 'Asia/Hong_Kong';
export function parseDisplayDate(value) {
  if (value === null || value === undefined || value === '') return null;
  let input = value;
  if (typeof input === 'string') {
    input = input.trim();
    if (!input) return null;
    if (/^\d{10}$/.test(input)) input = Number(input) * 1000;
    else if (/^\d{13}$/.test(input)) input = Number(input);
    else if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.test(input))
      input = input.replace(' ', 'T') + (input.length === 10 ? 'T00:00:00' : '') + '+08:00';
  } else if (typeof input === 'number' && Math.abs(input) < 1e11) input *= 1000;
  if (!(input instanceof Date) && typeof input !== 'string' && typeof input !== 'number')
    return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
export function formatDateTime(value, options = {}) {
  const parsed = parseDisplayDate(value);
  return parsed ? parsed.toLocaleString('zh-CN', { timeZone, ...options }) : '时间未知';
}
export function formatDate(value) {
  const parsed = parseDisplayDate(value);
  return parsed ? parsed.toLocaleDateString('zh-CN', { timeZone }) : '日期未知';
}
