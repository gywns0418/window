/**
 * 캡처 후 일정 시간이 지나면 캡처 도구 창을 닫거나 최소화하는 타이머.
 * - 타이머는 항상 1개만 유지한다(다시 걸면 이전 타이머 취소).
 * - 창 닫기/최소화는 한 번만 시도하고 재시도하지 않는다.
 */
'use strict';

const { setWindowState } = require('./newCapture');

let timer = null;

/** 대기 중인 타이머를 취소한다. @returns {boolean} 취소한 타이머가 있었는지 */
function cancel() {
  if (!timer) return false;
  clearTimeout(timer);
  timer = null;
  return true;
}

function isPending() {
  return !!timer;
}

/**
 * @param {number} delayMs
 * @param {'close'|'minimize'} action
 * @param {(result:{ok:boolean, code:number, detail:string, error?:string|null}) => void} [onDone]
 */
function schedule(delayMs, action, onDone) {
  cancel();
  timer = setTimeout(async () => {
    timer = null;
    const result = await setWindowState(action);
    if (typeof onDone === 'function') onDone(result);
  }, delayMs);
}

module.exports = { schedule, cancel, isPending };
