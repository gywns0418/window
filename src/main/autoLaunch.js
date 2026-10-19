/**
 * Windows 시작 시 자동 실행.
 * Electron 의 setLoginItemSettings 는 HKCU\Software\Microsoft\Windows\CurrentVersion\Run 에
 * 등록하므로 관리자 권한이 필요 없다.
 */
'use strict';

const { app } = require('electron');

const HIDDEN_ARG = '--hidden';

/**
 * 자동 실행에 등록할 실행 경로.
 * - 포터블 exe: 실행 시 임시 폴더로 풀리므로 process.execPath 가 아닌
 *   원본 exe 경로(PORTABLE_EXECUTABLE_FILE)를 써야 재부팅 후에도 동작한다.
 * - 개발 실행(npm start): electron.exe + 앱 경로
 */
function launchSpec() {
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    return { path: process.env.PORTABLE_EXECUTABLE_FILE, args: [HIDDEN_ARG] };
  }
  if (app.isPackaged) {
    return { path: process.execPath, args: [HIDDEN_ARG] };
  }
  return { path: process.execPath, args: [app.getAppPath(), HIDDEN_ARG] };
}

function isEnabled() {
  try {
    const spec = launchSpec();
    return !!app.getLoginItemSettings({ path: spec.path, args: spec.args }).openAtLogin;
  } catch (e) {
    return false;
  }
}

/** @returns {{ok:boolean, error?:string}} */
function setEnabled(enabled) {
  try {
    const spec = launchSpec();
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: spec.path, args: spec.args });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '자동 실행 설정 중 오류가 발생했습니다: ' + (e && e.message) };
  }
}

function launchedHidden() {
  return process.argv.includes(HIDDEN_ARG);
}

module.exports = { isEnabled, setEnabled, launchedHidden, launchSpec };
