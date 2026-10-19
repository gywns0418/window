'use strict';

const assert = require('assert');
const { DEFAULTS, normalizeSettings } = require('../src/main/settingsCore');

test('settingsCore: 빈 값/손상 값은 기본값', () => {
  assert.deepStrictEqual(normalizeSettings(null), Object.assign({}, DEFAULTS));
  assert.deepStrictEqual(normalizeSettings('broken'), Object.assign({}, DEFAULTS));
});

test('settingsCore: 유효한 값은 유지, 잘못된 값은 기본값', () => {
  const s = normalizeSettings({
    shortcut: 'ctrl+shift+x',
    autoLaunch: true,
    launchTarget: 'legacy',
    showNotifications: false
  });
  assert.strictEqual(s.shortcut, 'Control+Shift+X');
  assert.strictEqual(s.autoLaunch, true);
  assert.strictEqual(s.launchTarget, 'legacy');
  assert.strictEqual(s.showNotifications, false);

  const bad = normalizeSettings({ shortcut: 'Super+Shift+S', autoLaunch: 'yes', launchTarget: 'ms-screenclip' });
  assert.strictEqual(bad.shortcut, DEFAULTS.shortcut);
  assert.strictEqual(bad.autoLaunch, false);
  assert.strictEqual(bad.launchTarget, 'auto');
});

test("settingsCore: '새 캡처' 자동 실행은 기본 꺼짐", () => {
  assert.strictEqual(DEFAULTS.autoNewCapture, false);
  assert.strictEqual(normalizeSettings({ autoNewCapture: 'true' }).autoNewCapture, false);
  assert.strictEqual(normalizeSettings({ autoNewCapture: true }).autoNewCapture, true);
});

test('settingsCore: newCaptureButtonNames 정리', () => {
  assert.deepStrictEqual(DEFAULTS.newCaptureButtonNames, []);
  assert.deepStrictEqual(normalizeSettings({ newCaptureButtonNames: 'x' }).newCaptureButtonNames, []);
  assert.deepStrictEqual(normalizeSettings({ newCaptureButtonNames: ['캡처 시작', 3] }).newCaptureButtonNames, ['캡처 시작']);
});

test('settingsCore: 캡처 후 자동 닫기 기본값/대기 시간 보정', () => {
  const { normalizeDelaySec, AUTO_CLOSE_DELAY_RANGE } = require('../src/main/settingsCore');
  assert.strictEqual(DEFAULTS.autoCloseAfterCapture, true);
  assert.strictEqual(DEFAULTS.autoCloseDelaySec, 10);
  assert.strictEqual(normalizeSettings({ autoCloseAfterCapture: false }).autoCloseAfterCapture, false);
  assert.strictEqual(normalizeSettings({ autoCloseAfterCapture: 'no' }).autoCloseAfterCapture, true);
  assert.strictEqual(normalizeDelaySec('15'), 10);
  assert.strictEqual(normalizeDelaySec(NaN), 10);
  assert.strictEqual(normalizeDelaySec(1), AUTO_CLOSE_DELAY_RANGE.min);
  assert.strictEqual(normalizeDelaySec(999), AUTO_CLOSE_DELAY_RANGE.max);
  assert.strictEqual(normalizeDelaySec(12.4), 12);
  assert.strictEqual(normalizeSettings({ autoCloseDelaySec: 20 }).autoCloseDelaySec, 20);
});

test('settingsCore: 캡처 후 처리 방식/실행 별칭/시간 기록', () => {
  assert.strictEqual(DEFAULTS.afterCaptureAction, 'close');
  assert.strictEqual(normalizeSettings({ afterCaptureAction: 'minimize' }).afterCaptureAction, 'minimize');
  assert.strictEqual(normalizeSettings({ afterCaptureAction: 'kill' }).afterCaptureAction, 'close');
  assert.strictEqual(DEFAULTS.preferExecutionAlias, true);
  assert.strictEqual(normalizeSettings({ preferExecutionAlias: false }).preferExecutionAlias, false);
  assert.strictEqual(DEFAULTS.debugTiming, false);
  assert.strictEqual(normalizeSettings({ debugTiming: true }).debugTiming, true);
  assert.strictEqual(normalizeSettings({ debugTiming: 'yes' }).debugTiming, false);
});
