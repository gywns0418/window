/**
 * 설정값 기본값/정규화(순수 로직). 단위 테스트 대상.
 */
'use strict';

const Accelerator = require('../shared/accelerator');
const { LAUNCH_TARGETS } = require('./snippingToolCore');
const { sanitizeExtraNames, AFTER_CAPTURE_ACTIONS } = require('./newCaptureCore');

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
  newCaptureButtonNames: [],
  // '새 캡처' 자동 실행 후 일정 시간이 지나면 캡처 도구 창 닫기('새 캡처' 자동 실행이 켜져 있을 때만 동작)
  autoCloseAfterCapture: true,
  // 자동 닫기 대기 시간(초). settings.json 에서만 변경, AUTO_CLOSE_DELAY_RANGE 범위로 보정
  autoCloseDelaySec: 10,
  // 대기 시간이 지나면 'close'(닫기) 또는 'minimize'(최소화: 다음 단축키 때 더 빨리 열림)
  afterCaptureAction: 'close',
  // Windows 11 캡처 도구 실행 별칭이 있으면 explorer.exe 대신 사용(settings.json 에서만 변경)
  preferExecutionAlias: true,
  // 단계별 소요 시간을 timing.log 에 기록(settings.json 에서만 변경)
  debugTiming: false
});

const AUTO_CLOSE_DELAY_RANGE = Object.freeze({ min: 5, max: 60 });

/** 숫자가 아니면 기본값, 범위를 벗어나면 경계값으로 보정한다. */
function normalizeDelaySec(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.autoCloseDelaySec;
  return Math.min(AUTO_CLOSE_DELAY_RANGE.max, Math.max(AUTO_CLOSE_DELAY_RANGE.min, Math.round(value)));
}

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
  if (typeof src.autoCloseAfterCapture === 'boolean') out.autoCloseAfterCapture = src.autoCloseAfterCapture;
  out.autoCloseDelaySec = normalizeDelaySec(src.autoCloseDelaySec);
  if (AFTER_CAPTURE_ACTIONS.includes(src.afterCaptureAction)) out.afterCaptureAction = src.afterCaptureAction;
  if (typeof src.preferExecutionAlias === 'boolean') out.preferExecutionAlias = src.preferExecutionAlias;
  if (typeof src.debugTiming === 'boolean') out.debugTiming = src.debugTiming;
  return out;
}

module.exports = { DEFAULTS, AUTO_CLOSE_DELAY_RANGE, normalizeDelaySec, normalizeSettings };
