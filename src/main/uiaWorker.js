/**
 * 미리 띄워 두는 PowerShell UI Automation 워커.
 *
 * 단축키를 누를 때마다 PowerShell 을 새로 띄우고 UI Automation 을 불러오는 시간(1~2초대)을 없애기 위해,
 * '새 캡처' 자동 실행이 켜져 있는 동안 숨겨진 PowerShell 하나를 유지한다.
 *
 * - 정해진 명령(ping/running/invoke/close/minimize)만 보낸다(newCaptureCore.buildWorkerRequest 가 검사).
 * - 워커가 준비되지 않았거나 죽어 있으면 request() 는 null 을 돌려주고, 호출 측은 일회 실행으로 처리한다.
 * - 비정상 종료가 연속 MAX_CRASHES 번이면 더 이상 다시 띄우지 않는다(보안 정책 차단 등 고려).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./newCaptureCore');

const SCRIPT_PATH = path.join(__dirname, 'scripts', 'uia.ps1');
const READY_TIMEOUT_MS = 15000;
const RESTART_DELAY_MS = 1500;
const MAX_CRASHES = 3;
// 응답 대기 여유(명령 자체 대기 시간에 더함)
const RESPONSE_MARGIN_MS = 3000;

let child = null;
let ready = false;
let stopping = false;
let enabled = false;
let crashes = 0;
let seq = 0;
let buffer = '';
let readyTimer = null;
let restartTimer = null;
let config = { extraButtonNames: [] };
const pending = new Map();

function clearTimers() {
  if (readyTimer) clearTimeout(readyTimer);
  if (restartTimer) clearTimeout(restartTimer);
  readyTimer = null;
  restartTimer = null;
}

function settleAll(detail) {
  pending.forEach((p) => {
    clearTimeout(p.timer);
    p.resolve(null);
  });
  pending.clear();
  if (detail) buffer = '';
}

function kill() {
  if (!child) return;
  try {
    child.kill();
  } catch (e) {
    // 이미 종료된 경우 무시
  }
}

function onLine(line) {
  const parsed = core.parseWorkerLine(line);
  if (!parsed) return;
  if (parsed.type === 'ready') {
    ready = true;
    crashes = 0;
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = null;
    return;
  }
  if (parsed.type === 'fatal') {
    // UI Automation 을 불러오지 못함 → 다시 띄워도 같으므로 중단
    crashes = MAX_CRASHES;
    return;
  }
  const p = pending.get(parsed.id);
  if (!p) return;
  p.lines.push(parsed.payload);
  if (parsed.final) {
    clearTimeout(p.timer);
    pending.delete(parsed.id);
    p.resolve(p.lines.join('\n'));
  }
}

function onData(chunk) {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    onLine(line);
  }
}

function onExit(proc) {
  if (child !== proc) return;
  child = null;
  ready = false;
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = null;
  settleAll(true);
  if (stopping || !enabled) return;
  crashes += 1;
  if (crashes >= MAX_CRASHES) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    spawnWorker();
  }, RESTART_DELAY_MS);
}

function spawnWorker() {
  if (child || !enabled || crashes >= MAX_CRASHES) return;
  let command;
  try {
    command = core.buildCommand(fs.readFileSync(SCRIPT_PATH, 'utf8'), {
      mode: 'server',
      timeoutMs: core.DEFAULT_TIMEOUT_MS,
      extraButtonNames: config.extraButtonNames
    });
  } catch (e) {
    crashes = MAX_CRASHES;
    return;
  }

  stopping = false;
  buffer = '';
  let proc;
  try {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch (e) {
    crashes += 1;
    return;
  }
  child = proc;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', onData);
  proc.stdin.on('error', () => {});
  proc.once('error', () => onExit(proc));
  proc.once('exit', () => onExit(proc));

  readyTimer = setTimeout(() => {
    readyTimer = null;
    if (!ready) kill();
  }, READY_TIMEOUT_MS);
}

/**
 * 워커를 켠다(이미 켜져 있으면 무시). 설정이 바뀌어 버튼 이름 후보가 달라지면 다시 띄운다.
 * @param {{extraButtonNames?:string[]}} [options]
 */
function start(options) {
  const nextNames = core.sanitizeExtraNames((options && options.extraButtonNames) || []);
  const changed = JSON.stringify(nextNames) !== JSON.stringify(config.extraButtonNames);
  config = { extraButtonNames: nextNames };
  enabled = true;
  if (changed && child) {
    stop();
    enabled = true;
  }
  crashes = 0;
  spawnWorker();
}

/** 워커를 끈다. 대기 중인 요청은 null 로 끝난다. */
function stop() {
  enabled = false;
  stopping = true;
  clearTimers();
  settleAll(true);
  if (child) {
    const proc = child;
    try {
      proc.stdin.end();
    } catch (e) {
      // 무시
    }
    // 입력을 닫으면 스스로 종료한다. 남아 있으면 정리한다.
    setTimeout(() => {
      try {
        proc.kill();
      } catch (e) {
        // 무시
      }
    }, 1000);
  }
  child = null;
  ready = false;
}

function isReady() {
  return !!child && ready;
}

/**
 * @param {'running'|'invoke'|'close'|'minimize'|'ping'} command
 * @param {number} [arg]  invoke 의 대기 시간(ms)
 * @param {number} [timeoutMs]  응답 대기 시간
 * @returns {Promise<string|null>}  워커 출력(RESULT 줄 포함) 또는 사용 불가 시 null
 */
function request(command, arg, timeoutMs) {
  if (!isReady()) return Promise.resolve(null);
  let line;
  const id = ++seq;
  try {
    line = core.buildWorkerRequest(id, command, arg);
  } catch (e) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
      // 응답이 없으면 워커 상태를 알 수 없으므로 다시 띄운다.
      kill();
    }, (timeoutMs || core.DEFAULT_TIMEOUT_MS) + RESPONSE_MARGIN_MS);
    pending.set(id, { resolve, timer, lines: [] });
    try {
      child.stdin.write(line);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resolve(null);
    }
  });
}

module.exports = { start, stop, isReady, request };
