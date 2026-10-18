const prompts = [
  '宜温故知新',
  '宜循序渐进',
  '宜学以致用',
  '宜专心研读',
  '宜勤思善问',
  '宜知行相济',
  '宜积少成多',
  '宜静心求知',
];
export function dailyWelcome(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  const day = `${p.year}-${p.month}-${p.day}`,
    index = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short',
  }).format(now);
  return {
    day,
    label: `${Number(p.month)}月${Number(p.day)}日 ${weekday}`,
    prompt: prompts[index % prompts.length],
    greeting: Number(p.hour) < 12 ? '上午好' : Number(p.hour) < 18 ? '下午好' : '晚上好',
  };
}
