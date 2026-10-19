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
const { invokeNewCapture } = require('./newCapture');

const TASKLIST_TIMEOUT_MS = 5000;
const ACTIVATE_TIMEOUT_MS = 5000;
const VERIFY_TOTAL_MS = 6000;
const VERIFY_INTERVAL_MS = 400;
const COOLDOWN_MS = 1000;

let inFlight = null;
let lastFinishedAt = 0;

function systemRoot() {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 실행 중인 캡처 도구 프로세스 목록. tasklist 실패 시 빈 배열. */
function findRunning() {
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: TASKLIST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(core.parseTasklistCsv(stdout, core.PROCESS_NAMES));
      }
    );
  });
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

/** 실행 직후 프로세스가 실제로 떴는지 확인한다(재실행이 아닌 상태 확인만). */
async function verifyStarted() {
  const deadline = Date.now() + VERIFY_TOTAL_MS;
  while (Date.now() < deadline) {
    await sleep(VERIFY_INTERVAL_MS);
    const running = await findRunning();
    if (running.length > 0) return true;
  }
  return false;
}

function blockedMessage(label) {
  return (
    label +
    ' 실행을 확인하지 못했습니다.\n' +
    '회사 보안 프로그램의 차단 메시지가 표시되었다면 정책에 의해 차단된 것이므로 재시도하지 않습니다.\n' +
    '시작 메뉴에서 캡처 도구를 직접 실행할 수 있는지 확인하고, 필요하면 보안 담당자에게 문의해 주세요.'
  );
}

async function openInternal(preference) {
  const target = core.resolveLaunchTarget({
    preference,
    release: os.release(),
    systemRoot: systemRoot(),
    exists: (p) => {
      try {
        return fs.existsSync(p);
      } catch (e) {
        return false;
      }
    }
  });

  if (target.kind === 'none') {
    return { ok: false, error: target.reason };
  }

  const running = await findRunning();

  if (running.length > 0 && target.kind === 'legacy') {
    const activated = await activateByPid(running[0].pid);
    if (activated) return { ok: true, action: 'activated', target: target.label };
    // 포커스 전환이 불가한 환경(PowerShell 제한 등)에서는 새 창을 하나 연다.
  }

  const spawned = await spawnDetached(target.command, target.args);
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

  // 신규 캡처 도구가 이미 실행 중이었다면 explorer 가 기존 창을 활성화한다.
  if (running.length > 0) {
    return { ok: true, action: 'activated', target: target.label };
  }

  // explorer.exe 는 성공해도 종료 코드가 1인 경우가 있어 종료 코드 대신 프로세스 존재로 확인한다.
  const started = await verifyStarted();
  if (!started) {
    return { ok: false, blockedSuspected: true, error: blockedMessage(target.label) };
  }
  return { ok: true, action: 'launched', target: target.label };
}

/**
 * 캡처 도구를 실행하거나 활성화한다.
 * - 처리 중에 다시 호출되면 무시(중복 실행 방지). '새 캡처' 처리 시간도 포함된다.
 * - 직전 처리 후 COOLDOWN_MS 이내 호출은 무시(단축키 연타 방지)
 * - options.autoNewCapture 가 true 이고 창 열기/활성화에 성공한 경우에만 '새 캡처'를 한 번 누른다.
 *   창 열기에 실패(차단 의심 포함)하면 '새 캡처'는 시도하지 않는다.
 * @param {string} preference
 * @param {{autoNewCapture?:boolean, newCaptureButtonNames?:string[]}} [options]
 * @returns {Promise<{ok:boolean, skipped?:boolean, action?:string, error?:string, blockedSuspected?:boolean,
 *                    newCapture?:{ok:boolean, code:number, detail:string, error?:string}}>}
 */
function openSnippingTool(preference, options) {
  const opts = options || {};
  if (inFlight) return Promise.resolve({ ok: true, skipped: true });
  if (Date.now() - lastFinishedAt < COOLDOWN_MS) return Promise.resolve({ ok: true, skipped: true });

  inFlight = openInternal(preference)
    .then(async (result) => {
      if (!result.ok || !opts.autoNewCapture) return result;
      result.newCapture = await invokeNewCapture({ extraButtonNames: opts.newCaptureButtonNames });
      return result;
    })
    .catch((err) => ({ ok: false, error: '알 수 없는 오류: ' + ((err && err.message) || err) }))
    .finally(() => {
      inFlight = null;
      lastFinishedAt = Date.now();
    });
  return inFlight;
}

module.exports = { openSnippingTool, findRunning };
