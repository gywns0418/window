/**
 * 캡처 도구 UI Automation 연동 호출부.
 *  - invokeNewCapture : '새 캡처' 버튼을 한 번 누른다.
 *  - setWindowState   : 캡처 도구 창을 한 번 닫거나 최소화한다(X/최소화 버튼과 같은 창 동작, 강제 종료 아님).
 *  - listRunningPids  : 실행 중인 캡처 도구 PID(상주 워커가 준비된 경우에만, 아니면 null)
 *
 * 상주 워커(uiaWorker)가 준비되어 있으면 워커로, 아니면 PowerShell 을 한 번 띄워 처리한다.
 * - 사용자가 설정에서 직접 켜고, 회사 정책상 허용을 확인한 경우에만 호출된다(기본값 꺼짐).
 * - 키 입력 주입이나 화면 캡처 API 호출은 하지 않는다.
 * - 실패하면 다시 시도하지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const core = require('./newCaptureCore');
const worker = require('./uiaWorker');

const SCRIPT_PATH = path.join(__dirname, 'scripts', 'uia.ps1');
// PowerShell 기동과 UIAutomation 어셈블리 로드 시간을 감안한 여유
const PROCESS_OVERHEAD_MS = 6000;

let scriptCache = null;

function loadScript() {
  if (scriptCache === null) {
    // asar 안의 파일도 Electron fs 로 읽을 수 있다. 스크립트는 파일 실행이 아닌 -Command 로 전달한다.
    scriptCache = fs.readFileSync(SCRIPT_PATH, 'utf8');
  }
  return scriptCache;
}

/** 응답을 기다릴 최대 시간 */
function waitBudget(mode, opts) {
  return opts.timeoutMs || core.DEFAULT_TIMEOUT_MS;
}

function runOneShot(mode, options) {
  const opts = options || {};
  let command;
  try {
    command = core.buildCommand(loadScript(), {
      mode,
      timeoutMs: opts.timeoutMs,
      extraButtonNames: opts.extraButtonNames
    });
  } catch (e) {
    return Promise.resolve({ code: -1, detail: 'script-error', buttons: [], killed: false, error: e.message, via: 'oneshot' });
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      { windowsHide: true, timeout: waitBudget(mode, opts) + PROCESS_OVERHEAD_MS },
      (err, stdout) => {
        const parsed = core.parseResult(stdout);
        resolve(Object.assign(parsed, { killed: !!(err && err.killed), via: 'oneshot' }));
      }
    );
  });
}

/**
 * 워커가 준비되어 있으면 워커로, 아니면 일회 실행으로 처리한다.
 * 워커가 응답하지 못한 경우(도중 종료 등)에만 일회 실행으로 넘어간다. 버튼을 이미 누른 뒤에는 넘어가지 않는다.
 */
async function run(mode, options) {
  const opts = options || {};
  if (worker.isReady()) {
    const arg = mode === 'invoke' ? opts.timeoutMs || core.DEFAULT_TIMEOUT_MS : undefined;
    const out = await worker.request(mode, arg, waitBudget(mode, opts));
    if (out !== null) {
      return Object.assign(core.parseResult(out), { killed: false, via: 'worker' });
    }
    // 워커가 요청을 받은 뒤 응답 없이 끝난 경우, 버튼이 이미 눌렸을 수 있으므로 invoke 는 다시 하지 않는다.
    if (mode === 'invoke') {
      return { code: -1, detail: 'worker-no-response', buttons: [], killed: true, via: 'worker' };
    }
  }
  return runOneShot(mode, opts);
}

function startFailureMessage(r, what) {
  if (r.detail === 'script-error') return what + ' 준비하지 못했습니다: ' + r.error;
  return r.killed
    ? what + ' 시간 안에 끝나지 않아 중단했습니다.'
    : what + ' 시작하지 못했습니다. PowerShell 실행이 제한된 환경일 수 있습니다.';
}

/**
 * @param {{extraButtonNames?:string[], timeoutMs?:number}} [options]
 * @returns {Promise<{ok:boolean, code:number, detail:string, via:string, buttons?:{name:string, automationId:string}[], error?:string}>}
 */
async function invokeNewCapture(options) {
  const opts = options || {};
  const r = await run('invoke', {
    timeoutMs: opts.timeoutMs || core.DEFAULT_TIMEOUT_MS,
    extraButtonNames: opts.extraButtonNames
  });
  if (r.code === 0) return { ok: true, code: 0, detail: r.detail, via: r.via };
  const error = r.code === -1 ? startFailureMessage(r, "'새 캡처' 자동 실행을") : core.messageFor(r.code, r.buttons);
  return { ok: false, code: r.code, detail: r.detail, via: r.via, buttons: r.buttons, error };
}

/**
 * @param {'close'|'minimize'} action
 * @returns {Promise<{ok:boolean, code:number, detail:string, via:string, error?:string|null}>}
 */
async function setWindowState(action) {
  const mode = action === 'minimize' ? 'minimize' : 'close';
  const r = await run(mode, {});
  if (r.code === 0) return { ok: true, code: 0, detail: r.detail, via: r.via };
  const what = mode === 'minimize' ? '캡처 도구 창 자동 최소화를' : '캡처 도구 창 자동 닫기를';
  const error = r.code === -1 ? startFailureMessage(r, what) : core.windowStateMessageFor(mode, r.code);
  return { ok: false, code: r.code, detail: r.detail, via: r.via, error };
}

/** 워커가 준비된 경우에만 PID 목록(없으면 []), 아니면 null(호출 측이 tasklist 사용) */
async function listRunningPids() {
  if (!worker.isReady()) return null;
  const out = await worker.request('running', undefined, 2000);
  if (out === null) return null;
  return core.parseRunningPids(core.parseResult(out));
}

module.exports = { invokeNewCapture, setWindowState, listRunningPids, SCRIPT_PATH };
