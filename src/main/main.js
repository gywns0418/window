/**
 * SnipShortcut 진입점.
 * 트레이에 상주하며 사용자 지정 단축키로 Windows 기본 캡처 도구를 실행/활성화한다.
 */
'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');

const Accelerator = require('../shared/accelerator');
const settings = require('./settings');
const shortcut = require('./shortcut');
const autoLaunch = require('./autoLaunch');
const tray = require('./tray');
const notify = require('./notify');
const { openSnippingTool } = require('./snippingTool');
const { createWindowIcon } = require('./icon');

const APP_USER_MODEL_ID = 'com.tanine.snipshortcut';

let settingsWindow = null;
let quitting = false;

// ---------------------------------------------------------------------------
// 중복 실행 방지
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 이미 실행 중인 상태에서 exe 를 다시 실행하면 설정 화면을 띄워 실행 중임을 알린다.
    openSettings();
  });
  bootstrap();
}

function bootstrap() {
  // 설정 창 하나만 쓰는 상주형 앱이므로 GPU 프로세스를 쓰지 않아 메모리/CPU 사용을 줄인다.
  app.disableHardwareAcceleration();
  app.setAppUserModelId(APP_USER_MODEL_ID);

  app.whenReady().then(onReady);

  // 설정 창을 닫아도 트레이에 계속 상주한다.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    shortcut.unregisterAll();
    tray.destroy();
  });
}

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------
function currentState() {
  const s = settings.load();
  const sc = shortcut.getState();
  return {
    shortcut: sc.accelerator || s.shortcut,
    shortcutDisplay: Accelerator.toDisplay(sc.accelerator || s.shortcut),
    shortcutActive: sc.active,
    defaultShortcut: Accelerator.DEFAULT_SHORTCUT,
    autoLaunch: s.autoLaunch,
    launchTarget: s.launchTarget,
    showNotifications: s.showNotifications,
    autoNewCapture: s.autoNewCapture,
    isPortable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    settingsPath: settings.filePath(),
    version: app.getVersion()
  };
}

function broadcastState() {
  const state = currentState();
  tray.refresh(state);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('state:changed', state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// 동작
// ---------------------------------------------------------------------------
/**
 * @param {'shortcut'|'tray'|'manual'} source
 *   '새 캡처' 자동 실행은 단축키로 열 때만 적용한다. 트레이/설정 창의 '열기'는 창만 연다.
 */
async function triggerSnip(source) {
  const s = settings.load();
  const autoNewCapture = source === 'shortcut' && s.autoNewCapture;
  const result = await openSnippingTool(s.launchTarget, {
    autoNewCapture,
    newCaptureButtonNames: s.newCaptureButtonNames
  });
  if (result.skipped) return result;
  if (!result.ok) {
    // 차단 의심 시 모달로 한 번만 안내하고 재시도하지 않는다.
    notify.error(result.error, { modal: !!result.blockedSuspected });
    return result;
  }
  if (result.newCapture && !result.newCapture.ok) {
    // 창은 열렸으므로 사용자가 직접 '새 캡처'를 누르면 된다. 재시도하지 않는다.
    // 버튼 목록 진단 정보가 있으면 토스트에서 잘리지 않도록 메시지 박스로 보여 준다.
    const hasDiagnostics = !!(result.newCapture.buttons && result.newCapture.buttons.length);
    notify.error(result.newCapture.error + "\n\n캡처 도구 창에서 '새 캡처'를 직접 눌러 주세요.", {
      modal: hasDiagnostics
    });
  }
  return result;
}

/**
 * '새 캡처' 자동 실행을 켤 때는 회사 정책 허용 여부를 매번 확인받는다.
 */
async function applyAutoNewCapture(enabled) {
  if (enabled) {
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined;
    const options = {
      type: 'warning',
      title: notify.APP_TITLE,
      message: "단축키로 '새 캡처'까지 자동 실행할까요?",
      detail:
        "캡처 도구 창의 '새 캡처' 버튼을 Windows 접근성 API(UI Automation)로 한 번 누릅니다.\n\n" +
        '• 회사 보안 정책에서 이 방식의 사용이 허용된 경우에만 켜 주세요.\n' +
        '• 보안 프로그램의 차단 메시지가 나타나면 즉시 이 기능을 끄고 보안 담당자에게 문의하세요.\n' +
        '• 실패해도 다시 시도하지 않으며, 다른 캡처 경로로 우회하지 않습니다.',
      buttons: ['허용을 확인했으며 사용합니다', '취소'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response !== 0) {
      return { ok: false, cancelled: true, state: broadcastState() };
    }
  }
  settings.update({ autoNewCapture: !!enabled });
  return { ok: true, state: broadcastState() };
}

function applyShortcut(accelerator) {
  const result = shortcut.register(accelerator);
  if (result.ok) {
    settings.update({ shortcut: result.accelerator });
  }
  broadcastState();
  return result;
}

function applyAutoLaunch(enabled) {
  const result = autoLaunch.setEnabled(enabled);
  if (result.ok) {
    settings.update({ autoLaunch: !!enabled });
  } else {
    notify.error(result.error);
  }
  broadcastState();
  return result;
}

function quitApp() {
  quitting = true;
  app.quit();
}

// ---------------------------------------------------------------------------
// 설정 창
// ---------------------------------------------------------------------------
function openSettings() {
  if (!app.isReady()) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  // 다중 모니터: 마우스 커서가 있는 모니터 중앙에 띄운다.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 480;
  const height = Math.min(760, display.workArea.height);
  const area = display.workArea;

  settingsWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    show: false,
    title: 'SnipShortcut 설정',
    icon: createWindowIcon(),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  settingsWindow.setMenu(null);

  const wc = settingsWindow.webContents;
  // 외부 페이지 이동/새 창 차단
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // 녹화 중 창을 닫은 경우 단축키를 복구한다.
    const r = shortcut.resume();
    if (!r.ok && !quitting) notify.error(r.error);
    broadcastState();
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
}

// ---------------------------------------------------------------------------
// IPC (설정 창에서만 허용)
// ---------------------------------------------------------------------------
function fromSettingsWindow(event) {
  return !!settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents;
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromSettingsWindow(event)) return { ok: false, error: '허용되지 않은 요청입니다.' };
    return fn(...args);
  });
}

function registerIpc() {
  handle('settings:get', () => currentState());

  // 녹화(suspend) 중에 저장하는 경우가 대부분이므로 먼저 기존 키를 복구한 뒤 교체한다.
  // 새 키 등록에 실패하면 shortcut.register 가 복구된 기존 키를 유지한다.
  handle('settings:set-shortcut', (accelerator) => {
    shortcut.resume();
    const result = applyShortcut(String(accelerator || ''));
    return Object.assign({ state: currentState() }, result);
  });

  handle('settings:reset-shortcut', () => {
    shortcut.resume();
    const result = applyShortcut(Accelerator.DEFAULT_SHORTCUT);
    return Object.assign({ state: currentState() }, result);
  });

  handle('settings:set-auto-launch', (enabled) => {
    const result = applyAutoLaunch(!!enabled);
    return Object.assign({ state: currentState() }, result);
  });

  handle('settings:set-launch-target', (value) => {
    settings.update({ launchTarget: value });
    return { ok: true, state: broadcastState() };
  });

  handle('settings:set-notifications', (enabled) => {
    settings.update({ showNotifications: !!enabled });
    return { ok: true, state: broadcastState() };
  });

  handle('shortcut:suspend', () => {
    shortcut.suspend();
    return { ok: true };
  });

  handle('shortcut:resume', () => {
    const r = shortcut.resume();
    broadcastState();
    return r;
  });

  handle('settings:set-auto-new-capture', (enabled) => applyAutoNewCapture(!!enabled));

  handle('snip:open', async () => triggerSnip('manual'));

  handle('app:open-settings-folder', () => {
    shell.showItemInFolder(settings.filePath());
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------
function onReady() {
  if (process.platform !== 'win32') {
    notify.error('이 프로그램은 Windows 10/11 전용입니다.', { modal: true });
  }

  registerIpc();

  tray.createTray({
    openSnip: () => triggerSnip('tray'),
    openSettings,
    toggleAutoLaunch: (enabled) => applyAutoLaunch(enabled),
    quit: quitApp
  });

  const s = settings.load();

  shortcut.setHandler(() => {
    triggerSnip('shortcut');
  });
  const reg = shortcut.register(s.shortcut);

  // 자동 실행이 켜져 있으면 현재 exe 경로로 다시 등록(포터블 exe 위치를 옮긴 경우 대비).
  // 실제 레지스트리 상태와 설정값이 다르면 레지스트리 상태를 따른다.
  if (s.autoLaunch) {
    autoLaunch.setEnabled(true);
  } else if (autoLaunch.isEnabled() !== s.autoLaunch) {
    settings.update({ autoLaunch: autoLaunch.isEnabled() });
  }

  const state = broadcastState();

  if (!reg.ok) {
    notify.error(reg.error + '\n트레이 메뉴의 "단축키 설정"에서 다른 조합을 지정해 주세요.');
    openSettings();
    return;
  }

  if (!autoLaunch.launchedHidden()) {
    notify.info(
      '트레이에서 실행 중입니다. ' + state.shortcutDisplay + ' 를 누르면 캡처 도구가 열립니다.',
      s.showNotifications
    );
  }
}
