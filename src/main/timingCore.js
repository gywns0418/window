/**
 * 단계별 소요 시간 기록(순수 로직). 단위 테스트 대상.
 * settings.json 의 debugTiming 이 true 일 때만 timing.log 에 남긴다.
 */
'use strict';

/**
 * @param {() => number} [now]  시간 함수(테스트용 주입)
 */
function createTimer(now) {
  const clock = typeof now === 'function' ? now : Date.now;
  const start = clock();
  let last = start;
  const steps = [];
  return {
    /** 직전 표시 이후 걸린 시간을 name 으로 기록 */
    mark(name) {
      const t = clock();
      steps.push({ name: String(name), ms: t - last });
      last = t;
    },
    total() {
      return clock() - start;
    },
    steps() {
      return steps.slice();
    }
  };
}

/**
 * 로그 한 줄. 예) 2026-10-19T09:00:00.000Z source=shortcut action=launched via=alias uia=worker check=35 spawn=12 verify=420 newCapture=610 total=1080
 * @param {{time:Date, fields:Object<string, string|number|boolean|undefined>, steps:{name:string, ms:number}[], total:number}} entry
 */
function formatTimingLine(entry) {
  const parts = [entry.time.toISOString()];
  Object.keys(entry.fields || {}).forEach((k) => {
    const v = entry.fields[k];
    if (v === undefined || v === null || v === '') return;
    parts.push(k + '=' + String(v).replace(/\s+/g, '_'));
  });
  (entry.steps || []).forEach((s) => parts.push(s.name + '=' + s.ms));
  parts.push('total=' + entry.total);
  return parts.join(' ');
}

module.exports = { createTimer, formatTimingLine };
