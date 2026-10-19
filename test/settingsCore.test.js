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
