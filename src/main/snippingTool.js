/**
 * Windows 기본 캡처 도구 실행/활성화.
 *
 * 보안 원칙
 *  - 사용자가 직접 실행할 때와 같은 경로(캡처 도구 앱 자체 실행)만 사용한다.
 *  - Win+Shift+S 가 쓰는 화면 영역 캡처 호출(ms-screenclip: 등)은 사용하지 않는다.
 *  - 키 입력 주입은 하지 않는다. '새 캡처'는 사용자가 설정에서 켠 경우에만
 *    newCapture.js 가 접근성 API 로 버튼을 한 번 누른다.
 *  - 실행에 실패하면(보안 프로그램 차단 포함) 다른 경로로 재시도하지 않고 즉시 중단한다.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const core = require('./snippingToolCore');
const { LAUNCH_TIMEOUT_MS } = require('./newCaptureCore');
const { invokeNewCapture, listRunningPids } = require('./newCapture');

const TASKLIST_TIMEOUT_MS = 5000;
const ACTIVATE_TIMEOUT_MS = 5000;
const VERIFY_TOTAL_MS = 6000;
const VERIFY_INTERVAL_MS = 150;
// 직전 처리 후 이 시간 안의 입력은 무시(연타 방지). 캡처 직후 창만 남았을 때 바로 다시 누를 수 있도록 짧게 둔다.
const COOLDOWN_MS = 300;

let inFlight = null;
let lastFinishedAt = 0;

const NOOP_TIMER = { mark() {} };

function systemRoot() {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 실행 별칭(재분석 지점)도 확인할 수 있도록 lstat 으로 존재 여부를 본다. */
function pathExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (e) {
    return false;
  }
}

function tasklistPids(imageName) {
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      core.tasklistArgs(imageName),
      { windowsHide: true, timeout: TASKLIST_TIMEOUT_MS },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(core.parseTasklistCsv(stdout, [imageName]).map((p) => p.pid));
      }
    );
  });
}

/**
 * 실행 중인 캡처 도구 PID 목록.
 * - useWorker: 상주 워커가 준비되어 있으면 워커로 조회(수십 ms). 워커가 다른 요청을 처리 중일 때는 쓰지 않는다.
 * - 그 외: 캡처 도구 이름별로 걸러서 tasklist 를 동시에 조회. 실패 시 빈 배열.
 */
async function findRunning(options) {
  const useWorker = !!(options && options.useWorker);
  if (useWorker) {
    const pids = await listRunningPids();
    if (pids) return pids;
  }
  const lists = await Promise.all(core.PROCESS_NAMES.map(tasklistPids));
  return [].concat.apply([], lists);
}

/**
 * 기존 SnippingTool.exe(레거시) 창을 앞으로 가져온다.
 * WScript.Shell.AppActivate 는 창 포커스만 바꾸며 캡처 기능을 호출하지 않는다.
 */
function activateByPid(pid) {
  return new Promise((resolve) => {
    const script =
      '$s = New-Object -ComObject WScript.Shell; if ($s.AppActivate(' +
      Number(pid) +
      ')) { exit 0 } else { exit 1 }';
    execFile(
      'powershell.exe',
      // 스크립트 파일이 아닌 -Command 이므로 실행 정책 변경(-ExecutionPolicy)은 지정하지 않는다.
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      { windowsHide: true, timeout: ACTIVATE_TIMEOUT_MS },
      (err) => resolve(!err)
    );
  });
}

function spawnDetached(command, args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (err) => done({ ok: false, error: err }));
      child.once('spawn', () => {
        child.unref();
        done({ ok: true });
      });
    } catch (err) {
      done({ ok: false, error: err });
    }
  });
}

/**
 * 실행 직후 프로세스가 실제로 떴는지 확인한다(재실행이 아닌 상태 확인만).
 * '새 캡처' 요청과 동시에 돌기 때문에 상주 워커를 쓰지 않고 tasklist 로 확인한다.
 * @returns {Promise<number[]|null>} 뜬 PID 목록, 시간 안에 안 뜨면 null
 */
async function verifyStarted() {
  const deadline = Date.now() + VERIFY_TOTAL_MS;
  while (Date.now() < deadline) {
    await sleep(VERIFY_INTERVAL_MS);
    const pids = await findRunning({ useWorker: false });
    if (pids.length > 0) return pids;
  }
  return null;
}

function blockedMessage(label) {
  return (
    label +
    ' 실행을 확인하지 못했습니다.\n' +
    '회사 보안 프로그램의 차단 메시지가 표시되었다면 정책에 의해 차단된 것이므로 재시도하지 않습니다.\n' +
    '시작 메뉴에서 캡처 도구를 직접 실행할 수 있는지 확인하고, 필요하면 보안 담당자에게 문의해 주세요.'
  );
}

/**
 * @param {string} preference
 * @param {{autoNewCapture?:boolean, newCaptureButtonNames?:string[], preferAlias?:boolean, timer?:{mark:(name:string)=>void}}} opts
 */
async function openInternal(preference, opts) {
  const timer = opts.timer || NOOP_TIMER;
  const newCaptureOptions = (timeoutMs) => ({ extraButtonNames: opts.newCaptureButtonNames, timeoutMs });

  const target = core.resolveLaunchTarget({
    preference,
    release: os.release(),
    systemRoot: systemRoot(),
    localAppData: process.env.LOCALAPPDATA,
    preferAlias: opts.preferAlias !== false,
    exists: pathExists
  });

  if (target.kind === 'none') {
    return { ok: false, error: target.reason };
  }

  const pidsBefore = await findRunning({ useWorker: true });
  timer.mark('check');

  const finishActivated = async () => {
    const result = { ok: true, action: 'activated', target: target.label, via: target.via, pidsBefore, pids: pidsBefore };
    if (opts.autoNewCapture) {
      result.newCapture = await invokeNewCapture(newCaptureOptions());
      timer.mark('newCapture');
    }
    return result;
  };

  if (pidsBefore.length > 0 && target.kind === 'legacy') {
    const activated = await activateByPid(pidsBefore[0]);
    timer.mark('activate');
    if (activated) return finishActivated();
    // 포커스 전환이 불가한 환경(PowerShell 제한 등)에서는 새 창을 하나 연다.
  }

  const spawned = await spawnDetached(target.command, target.args);
  timer.mark('spawn');
  if (!spawned.ok) {
    const code = spawned.error && spawned.error.code;
    return {
      ok: false,
      error:
        code === 'ENOENT'
          ? target.label + ' 실행 파일을 찾을 수 없습니다.'
          : target.label + ' 실행 중 오류가 발생했습니다: ' + ((spawned.error && spawned.error.message) || code)
    };
  }

  // 신규 캡처 도구가 이미 실행 중이었다면 기존 창이 활성화된다.
  if (pidsBefore.length > 0) return finishActivated();

  // 새로 실행한 경우: 실행 확인과 '새 캡처' 버튼 대기를 동시에 시작한다.
  // '새 캡처'는 캡처 도구 창이 실제로 나타나야만 누를 수 있으므로, 실행이 차단되면 누를 대상이 없어 아무 것도 하지 않는다.
  const newCapturePromise = opts.autoNewCapture ? invokeNewCapture(newCaptureOptions(LAUNCH_TIMEOUT_MS)) : null;

  // 실행 별칭/explorer 는 성공해도 종료 코드가 일정하지 않아 프로세스 존재로 확인한다.
  const pidsAfter = await verifyStarted();
  timer.mark('verify');
  if (!pidsAfter) {
    if (newCapturePromise) await newCapturePromise;
    return { ok: false, blockedSuspected: true, error: blockedMessage(target.label) };
  }

  const result = { ok: true, action: 'launched', target: target.label, via: target.via, pidsBefore, pids: pidsAfter };
  if (newCapturePromise) {
    result.newCapture = await newCapturePromise;
    timer.mark('newCapture');
  }
  return result;
}

/**
 * 캡처 도구를 실행하거나 활성화한다.
 * - 처리 중에 다시 호출되면 무시(중복 실행 방지). '새 캡처' 처리 시간도 포함된다.
 * - 직전 처리 후 COOLDOWN_MS 이내 호출은 무시(단축키 연타 방지)
 * - options.autoNewCapture 가 true 이면 캡처 도구 창이 나타난 뒤 '새 캡처'를 한 번 누른다.
 *   창이 나타나지 않으면(차단 의심 포함) 누르지 않는다.
 * @param {string} preference
 * @param {{autoNewCapture?:boolean, newCaptureButtonNames?:string[], preferAlias?:boolean, timer?:{mark:(name:string)=>void}}} [options]
 * @returns {Promise<{ok:boolean, skipped?:boolean, skipReason?:'busy'|'cooldown', action?:string, via?:string, error?:string, blockedSuspected?:boolean,
 *                    pidsBefore?:number[], pids?:number[],
 *                    newCapture?:{ok:boolean, code:number, detail:string, via:string, error?:string}}>}
 */
function openSnippingTool(preference, options) {
  const opts = options || {};
  if (inFlight) return Promise.resolve({ ok: true, skipped: true, skipReason: 'busy' });
  if (Date.now() - lastFinishedAt < COOLDOWN_MS) {
    return Promise.resolve({ ok: true, skipped: true, skipReason: 'cooldown' });
  }

  inFlight = openInternal(preference, opts)
    .catch((err) => ({ ok: false, error: '알 수 없는 오류: ' + ((err && err.message) || err) }))
    .finally(() => {
      inFlight = null;
      lastFinishedAt = Date.now();
    });
  return inFlight;
}

module.exports = { openSnippingTool, findRunning };
