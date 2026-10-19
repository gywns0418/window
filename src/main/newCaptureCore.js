/**
 * '새 캡처' 자동 실행의 순수 로직(Electron/child_process 비의존). 단위 테스트 대상.
 */
'use strict';

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_EXTRA_NAMES = 10;
const MAX_NAME_LENGTH = 40;
const MAX_DIAGNOSTIC_BUTTONS = 15;

const TARGET = Object.freeze({
  // 확장자 없는 프로세스 이름 (Get-Process -Name)
  processNames: ['SnippingTool', 'ScreenSketch'],
  // Windows 10 '캡처 및 스케치'는 ApplicationFrameHost 창 안에 호스팅된다.
  windowTitles: ['캡처 및 스케치', 'Snip & Sketch'],
  // 버튼 AutomationId 후보. 캡처 도구 버전에 따라 다를 수 있어 이름 매칭을 함께 사용한다.
  automationIds: ['NewButton', 'NewSnipButton', 'NewScreenshotButton'],
  // 버튼 이름 후보(앞쪽이 현재 확인된 이름). 비교 전 normalizeButtonName 규칙으로 정규화한다.
  // settings.json 의 newCaptureButtonNames 로 후보를 추가할 수 있다.
  buttonNames: ['새 캡처', '새로 만들기', '새 스크린샷', 'New', 'New snip', 'New screenshot']
});

const RESULT_MESSAGES = {
  0: null,
  2: "캡처 도구 창을 찾지 못해 '새 캡처'를 실행하지 않았습니다.",
  3: "캡처 도구 창에서 '새 캡처' 버튼을 찾지 못했습니다.",
  4: "'새 캡처' 버튼을 누르지 못했습니다.",
  5: '이 PC에서 UI Automation 을 사용할 수 없습니다.'
};

// 스크립트에 들어가면 안 되는 호출(차단 경로 우회/입력 주입/난독화)
const FORBIDDEN_TOKENS = [
  'ms-screenclip',
  'sendkeys',
  'sendinput',
  'keybd_event',
  'mouse_event',
  'encodedcommand',
  'executionpolicy',
  'invoke-expression',
  'iex '
];

/**
 * 버튼 이름 정규화. invoke-new.ps1 의 Get-NormalizedName 과 같은 규칙을 유지한다.
 * - '&' 제거
 * - 끝의 단축키 표기 제거: (Ctrl+N), Ctrl+N, (컨트롤+Shift+N)
 * - 끝의 니모닉 표기 제거: (N)
 * - 공백 정리, 소문자화
 */
function normalizeButtonName(value) {
  if (!value) return '';
  let t = String(value).replace(/&/g, '');
  t = t.replace(/\s*\(?\s*(ctrl|control|컨트롤)(\s*\+\s*[A-Za-z0-9]+)+\s*\)?\s*$/i, '');
  t = t.replace(/\s*\([A-Za-z]\)\s*$/, '');
  t = t.replace(/\s+/g, ' ');
  return t.trim().toLowerCase();
}

/**
 * settings.json 에서 읽은 추가 버튼 이름 정리.
 * 문자열만, 앞뒤 공백 제거, 1~40자, 큰따옴표/제어문자 불가, 최대 10개, 중복 제거.
 */
function sanitizeExtraNames(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  value.forEach((v) => {
    if (typeof v !== 'string') return;
    const s = v.trim();
    // eslint-disable-next-line no-control-regex
    if (!s || s.length > MAX_NAME_LENGTH || s.indexOf('"') !== -1 || /[\u0000-\u001f\u007f]/.test(s)) return;
    const key = normalizeButtonName(s);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out.slice(0, MAX_EXTRA_NAMES);
}

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function psArray(values) {
  return '@(' + values.map(psQuote).join(', ') + ')';
}

/**
 * ps1 본문 앞에 파라미터 대입문을 붙이고, 주석/빈 줄을 제거해 -Command 인자로 넘길 문자열을 만든다.
 * 명령줄 인용 문제를 피하려고 큰따옴표가 있으면 예외를 던진다.
 * @param {string} scriptText
 * @param {{timeoutMs?:number, extraButtonNames?:string[]}} [options]
 */
function buildCommand(scriptText, options) {
  const opts = options || {};
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? Math.round(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const buttonNames = TARGET.buttonNames.concat(sanitizeExtraNames(opts.extraButtonNames));

  const body = String(scriptText || '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('#');
    })
    .join('\n');

  const header = [
    '$ProcessNames = ' + psArray(TARGET.processNames),
    '$WindowTitles = ' + psArray(TARGET.windowTitles),
    '$AutomationIds = ' + psArray(TARGET.automationIds),
    '$ButtonNames = ' + psArray(buttonNames),
    '$TimeoutMs = ' + timeoutMs
  ].join('\n');

  const command = header + '\n' + body;
  if (command.indexOf('"') !== -1) {
    throw new Error('스크립트에 큰따옴표를 사용할 수 없습니다.');
  }
  const lower = command.toLowerCase();
  const hit = FORBIDDEN_TOKENS.find((t) => lower.indexOf(t) !== -1);
  if (hit) {
    throw new Error('허용되지 않은 호출이 포함되어 있습니다: ' + hit.trim());
  }
  return command;
}

function unescape(value) {
  return String(value || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** BUTTONS:<이름:ID>|... 줄을 [{name, automationId}] 로 변환 */
function parseButtons(stdout) {
  const m = /^BUTTONS:(.*)$/m.exec(String(stdout || ''));
  if (!m || !m[1].trim()) return [];
  return m[1]
    .trim()
    .split('|')
    .map((entry) => {
      const idx = entry.indexOf(':');
      const name = unescape(idx === -1 ? entry : entry.slice(0, idx)).trim();
      const automationId = idx === -1 ? '' : unescape(entry.slice(idx + 1)).trim();
      return { name, automationId };
    })
    .filter((b) => b.name || b.automationId)
    .slice(0, MAX_DIAGNOSTIC_BUTTONS);
}

/** 스크립트 출력에서 RESULT:<코드>:<설명> 과 진단용 버튼 목록을 찾는다. */
function parseResult(stdout) {
  const m = /RESULT:(\d+):([\w-]+)/.exec(String(stdout || ''));
  if (!m) return { code: -1, detail: 'no-result', buttons: [] };
  return { code: parseInt(m[1], 10), detail: m[2], buttons: parseButtons(stdout) };
}

function formatButtons(buttons) {
  return buttons
    .map((b) => {
      if (b.name && b.automationId) return '• ' + b.name + '  [' + b.automationId + ']';
      return '• ' + (b.name || '(이름 없음)  [' + b.automationId + ']');
    })
    .join('\n');
}

/**
 * @param {number} code
 * @param {{name:string, automationId:string}[]} [buttons]  코드 3 일 때 진단 정보
 */
function messageFor(code, buttons) {
  if (code === 0) return null;
  const base = RESULT_MESSAGES[code] || "'새 캡처' 자동 실행 중 알 수 없는 오류가 발생했습니다.";
  if (code === 3 && buttons && buttons.length) {
    return (
      base +
      '\n\n캡처 도구 창에서 찾은 버튼:\n' +
      formatButtons(buttons) +
      '\n\n위 목록에 새 캡처 버튼이 다른 이름으로 보이면 settings.json 의 newCaptureButtonNames 에 그 이름을 추가하세요.'
    );
  }
  return base;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  TARGET,
  FORBIDDEN_TOKENS,
  normalizeButtonName,
  sanitizeExtraNames,
  buildCommand,
  parseButtons,
  parseResult,
  messageFor
};
