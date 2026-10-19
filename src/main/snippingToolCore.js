/**
 * 캡처 도구 연동의 순수 로직(Electron/child_process 비의존). 단위 테스트 대상.
 */
'use strict';

const path = require('path');

// Windows 11 캡처 도구 / Windows 10 캡처 및 스케치 패키지 (같은 패키지 패밀리)
const MODERN_APP_ID = 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App';

// 캡처 도구 관련 프로세스 이미지 이름
//  - SnippingTool.exe : Win11 신규 캡처 도구, Win10 기존 캡처 도구
//  - ScreenSketch.exe : Win10 캡처 및 스케치
const PROCESS_NAMES = ['SnippingTool.exe', 'ScreenSketch.exe'];

const LAUNCH_TARGETS = ['auto', 'modern', 'legacy'];

/** Windows 빌드 번호(os.release() 의 세 번째 값). 해석 실패 시 0. */
function parseWindowsBuild(release) {
  const parts = String(release || '').split('.');
  const build = parseInt(parts[2], 10);
  return Number.isFinite(build) ? build : 0;
}

function isWindows11(release) {
  return parseWindowsBuild(release) >= 22000;
}

function legacyExePath(systemRoot) {
  return path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'SnippingTool.exe');
}

/**
 * Windows 11 캡처 도구 앱의 실행 별칭(App Execution Alias).
 * 패키지 앱이 등록하는 공식 실행 경로이며, explorer.exe 를 거치지 않아 실행이 조금 빠르다.
 */
function executionAliasPath(localAppData) {
  if (!localAppData) return null;
  return path.win32.join(localAppData, 'Microsoft', 'WindowsApps', 'SnippingTool.exe');
}

/** 캡처 도구 이미지 이름 하나로 걸러 조회하는 tasklist 인자(전체 목록 조회보다 빠름) */
function tasklistArgs(imageName) {
  return ['/FI', 'IMAGENAME eq ' + imageName, '/FO', 'CSV', '/NH'];
}

/**
 * 실행할 대상을 "실행 전에" 한 번만 결정한다.
 * 실행 실패 후 다른 경로로 재시도하지 않기 위해, 폴백 판단은 여기서만 한다.
 *
 * @param {object} opts
 * @param {'auto'|'modern'|'legacy'} opts.preference
 * @param {string} opts.release       os.release()
 * @param {string} opts.systemRoot    %SystemRoot%
 * @param {string} [opts.localAppData]  %LOCALAPPDATA% (실행 별칭 위치)
 * @param {boolean} [opts.preferAlias]  실행 별칭이 있으면 사용(기본 true)
 * @param {(p:string)=>boolean} opts.exists  파일 존재 확인 함수
 * @returns {{kind:'modern', command:string, args:string[], label:string, via:'alias'|'explorer'}
 *          |{kind:'legacy', command:string, args:string[], label:string}
 *          |{kind:'none', reason:string}}
 */
function resolveLaunchTarget(opts) {
  const preference = LAUNCH_TARGETS.includes(opts.preference) ? opts.preference : 'auto';
  const legacy = legacyExePath(opts.systemRoot);
  const legacyExists = !!opts.exists(legacy);
  const alias = opts.preferAlias === false ? null : executionAliasPath(opts.localAppData);
  const aliasExists = !!alias && !!opts.exists(alias);

  // 패키지 앱(UWP/WinUI)은 실행 별칭 또는 explorer 의 AppsFolder 셸 경로로 실행한다.
  // 이미 실행 중이면 새 창을 만들지 않고 기존 창이 활성화된다(단일 인스턴스 앱).
  const modernTarget = aliasExists
    ? { kind: 'modern', via: 'alias', command: alias, args: [], label: '캡처 도구(Microsoft.ScreenSketch)' }
    : {
        kind: 'modern',
        via: 'explorer',
        command: 'explorer.exe',
        args: ['shell:AppsFolder\\' + MODERN_APP_ID],
        label: '캡처 도구(Microsoft.ScreenSketch)'
      };
  const legacyTarget = {
    kind: 'legacy',
    command: legacy,
    args: [],
    label: '캡처 도구(SnippingTool.exe)'
  };

  if (preference === 'modern') return modernTarget;
  if (preference === 'legacy') {
    return legacyExists
      ? legacyTarget
      : { kind: 'none', reason: '기존 캡처 도구 실행 파일을 찾을 수 없습니다: ' + legacy };
  }
  // auto: Windows 11 은 신규 캡처 도구, Windows 10 은 기존 SnippingTool.exe 가 있으면 그것을 사용
  if (isWindows11(opts.release)) return modernTarget;
  return legacyExists ? legacyTarget : modernTarget;
}

/**
 * `tasklist /FO CSV /NH` 출력에서 대상 프로세스의 PID 목록을 뽑는다.
 * 예) "SnippingTool.exe","12345","Console","1","45,000 K"
 */
function parseTasklistCsv(output, names) {
  const wanted = (names || PROCESS_NAMES).map((n) => n.toLowerCase());
  const result = [];
  String(output || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (!m) return;
      if (wanted.includes(m[1].toLowerCase())) {
        result.push({ name: m[1], pid: parseInt(m[2], 10) });
      }
    });
  return result;
}

module.exports = {
  MODERN_APP_ID,
  PROCESS_NAMES,
  LAUNCH_TARGETS,
  parseWindowsBuild,
  isWindows11,
  legacyExePath,
  executionAliasPath,
  tasklistArgs,
  resolveLaunchTarget,
  parseTasklistCsv
};
