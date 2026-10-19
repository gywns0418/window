/**
 * 설정값 기본값/정규화(순수 로직). 단위 테스트 대상.
 */
'use strict';

const Accelerator = require('../shared/accelerator');
const { LAUNCH_TARGETS } = require('./snippingToolCore');
const { sanitizeExtraNames } = require('./newCaptureCore');

const DEFAULTS = Object.freeze({
  version: 1,
  shortcut: Accelerator.DEFAULT_SHORTCUT,
  autoLaunch: false,
  // 'auto' | 'modern' | 'legacy'  (README 참고)
  launchTarget: 'auto',
  showNotifications: true,
  // 단축키로 열 때 '새 캡처'까지 자동 실행. 회사 정책 허용 확인이 필요하므로 기본값은 꺼짐.
  autoNewCapture: false,
  // '새 캡처' 버튼 이름 추가 후보(캡처 도구 업데이트로 이름이 바뀐 경우 settings.json 에서 직접 추가)
  newCaptureButtonNames: []
});

/** 파일에서 읽은 임의의 값을 안전한 설정 객체로 만든다. 잘못된 값은 기본값으로 대체. */
function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = Object.assign({}, DEFAULTS);

  if (typeof src.shortcut === 'string') {
    const v = Accelerator.validate(src.shortcut);
    if (v.ok) out.shortcut = v.accelerator;
  }
  if (typeof src.autoLaunch === 'boolean') out.autoLaunch = src.autoLaunch;
  if (LAUNCH_TARGETS.includes(src.launchTarget)) out.launchTarget = src.launchTarget;
  if (typeof src.showNotifications === 'boolean') out.showNotifications = src.showNotifications;
  if (typeof src.autoNewCapture === 'boolean') out.autoNewCapture = src.autoNewCapture;
  out.newCaptureButtonNames = sanitizeExtraNames(src.newCaptureButtonNames);
  return out;
}

module.exports = { DEFAULTS, normalizeSettings };
