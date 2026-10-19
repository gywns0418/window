/**
 * 시스템 트레이 아이콘과 메뉴.
 */
'use strict';

const { Tray, Menu } = require('electron');
const Accelerator = require('../shared/accelerator');
const { createAppIcon } = require('./icon');
const { APP_TITLE } = require('./notify');

let tray = null;
let actions = null;

/**
 * @param {object} a
 * @param {() => void} a.openSnip
 * @param {() => void} a.openSettings
 * @param {(enabled:boolean) => void} a.toggleAutoLaunch
 * @param {() => void} a.quit
 */
function createTray(a) {
  if (tray) return tray;
  actions = a;
  tray = new Tray(createAppIcon());
  // Windows 에서는 좌클릭도 메뉴를 띄워 조작 방식을 단순하게 유지한다.
  tray.on('click', () => tray.popUpContextMenu());
  return tray;
}

/**
 * @param {{shortcut:string|null, shortcutActive:boolean, autoLaunch:boolean}} state
 */
function refresh(state) {
  if (!tray) return;
  const display = state.shortcut ? Accelerator.toDisplay(state.shortcut) : '없음';
  const shortcutLabel = state.shortcutActive ? display : display + ' (등록 안 됨)';

  tray.setToolTip(APP_TITLE + ' - 캡처 도구 단축키: ' + shortcutLabel);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '캡처 도구 열기  (' + shortcutLabel + ')', click: () => actions.openSnip() },
      { type: 'separator' },
      { label: '단축키 설정...', click: () => actions.openSettings() },
      {
        label: 'Windows 시작 시 자동 실행',
        type: 'checkbox',
        checked: !!state.autoLaunch,
        click: (item) => actions.toggleAutoLaunch(item.checked)
      },
      { type: 'separator' },
      { label: '종료', click: () => actions.quit() }
    ])
  );
}

function destroy() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, refresh, destroy };
