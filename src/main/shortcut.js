/**
 * 전역 단축키 관리(globalShortcut).
 * - 항상 1개만 등록한다(새 키 등록 전 기존 키 해제 → 중복 등록 방지).
 * - 새 키 등록에 실패하면 기존 키를 복구한다.
 * - 설정 화면에서 키를 입력받는 동안은 잠시 해제(suspend)해 현재 키도 녹화할 수 있게 한다.
 */
'use strict';

const { globalShortcut } = require('electron');
const Accelerator = require('../shared/accelerator');

let current = null; // 등록하려는(또는 등록된) accelerator
let active = false; // 실제 OS 에 등록되어 있는지
let suspended = false;
let handler = () => {};

function setHandler(fn) {
  handler = typeof fn === 'function' ? fn : () => {};
}

function tryRegister(accelerator) {
  try {
    return globalShortcut.register(accelerator, () => handler());
  } catch (e) {
    return false;
  }
}

function unregisterCurrent() {
  if (current && active) {
    try {
      globalShortcut.unregister(current);
    } catch (e) {
      // 이미 해제된 경우 무시
    }
  }
  active = false;
}

/**
 * @returns {{ok:true, accelerator:string} | {ok:false, error:string}}
 */
function register(accelerator) {
  const v = Accelerator.validate(accelerator);
  if (!v.ok) return v;
  const next = v.accelerator;

  if (next === current && active) return { ok: true, accelerator: next };

  const previous = current;
  const previousWasActive = active;
  unregisterCurrent();

  if (suspended) {
    // 녹화 중에는 실제 등록을 미루고 resume 시점에 등록한다.
    current = next;
    return { ok: true, accelerator: next };
  }

  if (tryRegister(next)) {
    current = next;
    active = true;
    return { ok: true, accelerator: next };
  }

  // 실패: 기존 단축키 복구
  if (previous && previousWasActive && tryRegister(previous)) {
    current = previous;
    active = true;
  } else {
    current = previous || null;
    active = false;
  }
  return {
    ok: false,
    error:
      Accelerator.toDisplay(next) +
      ' 단축키를 등록할 수 없습니다. 다른 프로그램이 이미 사용 중일 수 있습니다. 다른 조합을 선택해 주세요.'
  };
}

function suspend() {
  if (suspended) return;
  suspended = true;
  unregisterCurrent();
}

function resume() {
  if (!suspended) return { ok: true, accelerator: current };
  suspended = false;
  if (!current) return { ok: false, error: '등록할 단축키가 없습니다.' };
  if (tryRegister(current)) {
    active = true;
    return { ok: true, accelerator: current };
  }
  active = false;
  return { ok: false, error: Accelerator.toDisplay(current) + ' 단축키를 다시 등록하지 못했습니다.' };
}

function unregisterAll() {
  try {
    globalShortcut.unregisterAll();
  } catch (e) {
    // 종료 중 오류 무시
  }
  active = false;
}

function getState() {
  return { accelerator: current, active, suspended };
}

module.exports = { setHandler, register, suspend, resume, unregisterAll, getState };
