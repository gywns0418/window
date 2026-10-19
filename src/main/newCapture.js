/**
 * 캡처 도구의 '새 캡처' 버튼을 UI Automation 으로 한 번 누른다.
 *
 * - 사용자가 설정에서 직접 켜고, 회사 정책상 허용을 확인한 경우에만 호출된다(기본값 꺼짐).
 * - 캡처 도구 앱이 제공하는 버튼을 접근성 API(InvokePattern)로 누를 뿐이며,
 *   키 입력 주입이나 화면 캡처 API 호출은 하지 않는다.
 * - 실패하면 다시 시도하지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const core = require('./newCaptureCore');

const SCRIPT_PATH = path.join(__dirname, 'scripts', 'invoke-new.ps1');
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

/**
 * @param {{extraButtonNames?:string[]}} [options]
 * @returns {Promise<{ok:boolean, code:number, detail:string, buttons?:{name:string, automationId:string}[], error?:string}>}
 */
function invokeNewCapture(options) {
  const opts = options || {};
  let command;
  try {
    command = core.buildCommand(loadScript(), {
      timeoutMs: core.DEFAULT_TIMEOUT_MS,
      extraButtonNames: opts.extraButtonNames
    });
  } catch (e) {
    return Promise.resolve({ ok: false, code: -1, detail: 'script-error', error: "'새 캡처' 자동 실행을 준비하지 못했습니다: " + e.message });
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      { windowsHide: true, timeout: core.DEFAULT_TIMEOUT_MS + PROCESS_OVERHEAD_MS },
      (err, stdout) => {
        const parsed = core.parseResult(stdout);
        if (parsed.code === 0) {
          return resolve({ ok: true, code: 0, detail: parsed.detail });
        }
        let error = core.messageFor(parsed.code, parsed.buttons);
        if (parsed.code === -1) {
          error =
            err && err.killed
              ? "'새 캡처' 자동 실행이 시간 안에 끝나지 않아 중단했습니다."
              : "'새 캡처' 자동 실행을 시작하지 못했습니다. PowerShell 실행이 제한된 환경일 수 있습니다.";
        }
        resolve({ ok: false, code: parsed.code, detail: parsed.detail, buttons: parsed.buttons, error });
      }
    );
  });
}

module.exports = { invokeNewCapture, SCRIPT_PATH };
