'use strict';

const assert = require('assert');
const { createTimer, formatTimingLine } = require('../src/main/timingCore');

test('timingCore: 단계별 경과 시간', () => {
  const times = [1000, 1035, 1047, 1467, 2080, 2080];
  const timer = createTimer(() => times.shift());
  timer.mark('check');
  timer.mark('spawn');
  timer.mark('verify');
  timer.mark('newCapture');
  assert.deepStrictEqual(timer.steps(), [
    { name: 'check', ms: 35 },
    { name: 'spawn', ms: 12 },
    { name: 'verify', ms: 420 },
    { name: 'newCapture', ms: 613 }
  ]);
  assert.strictEqual(timer.total(), 1080);
});

test('timingCore: 로그 한 줄 형식 (빈 값 제외, 공백 치환)', () => {
  const line = formatTimingLine({
    time: new Date('2026-10-19T00:00:00.000Z'),
    fields: { source: 'shortcut', action: 'launched', via: 'alias', uia: undefined, note: 'a b' },
    steps: [{ name: 'check', ms: 35 }],
    total: 100
  });
  assert.strictEqual(line, '2026-10-19T00:00:00.000Z source=shortcut action=launched via=alias note=a_b check=35 total=100');
});
