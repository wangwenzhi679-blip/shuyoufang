import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplayDate, formatDate, formatDateTime } from './date-format.mjs';
test('空值和不合法时间不会显示 Invalid Date 或 1970 年', () => {
  for (const v of [null, undefined, '', '  ', 'bad-date', {}, NaN]) {
    assert.equal(parseDisplayDate(v), null);
    assert.equal(formatDate(v), '日期未知');
    assert.equal(formatDateTime(v), '时间未知');
  }
});
test('兼容数据库日期、ISO 时间和秒毫秒时间戳', () => {
  assert.equal(parseDisplayDate('2026-10-08 14:30:00').toISOString(), '2026-10-08T06:30:00.000Z');
  assert.equal(parseDisplayDate('2026-10-08').toISOString(), '2026-10-07T16:00:00.000Z');
  assert.equal(parseDisplayDate('2026-10-08T06:30:00Z').toISOString(), '2026-10-08T06:30:00.000Z');
  assert.equal(parseDisplayDate('1791441000').getTime(), 1791441000000);
  assert.equal(parseDisplayDate(1791441000000).getTime(), 1791441000000);
});
test('统一香港时区避免日期跨日偏移', () => {
  assert.equal(formatDate('2026-10-07T18:00:00Z'), '2026/10/8');
});
