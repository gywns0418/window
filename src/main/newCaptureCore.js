/**
 * 캡처 도구 UI Automation 연동의 순수 로직(Electron/child_process 비의존). 단위 테스트 대상.
 */
'use strict';

// 이미 떠 있는 창에서 '새 캡처' 버튼을 기다리는 최대 시간
const DEFAULT_TIMEOUT_MS = 4000;
// 캡처 도구를 새로 실행한 경우(앱 기동 시간 포함) 버튼을 기다리는 최대 시간
const LAUNCH_TIMEOUT_MS = 8000;
const MAX_EXTRA_NAMES = 10;
const MAX_NAME_LENGTH = 40;
const MAX_DIAGNOSTIC_BUTTONS = 15;

// uia.ps1 이 처리하는 모드/명령(그 외 값은 거부)
const MODES = Object.freeze(['server', 'running', 'invoke', 'close', 'minimize']);
// 캡처 후 처리 방식
const AFTER_CAPTURE_ACTIONS = Object.freeze(['close', 'minimize']);

const TARGET = Object.freeze({
  // 확장자 없는 프로세스 이름 (Get-Process -Name)
  processNames: ['SnippingTool', 'ScreenSketch'],
  // Windows 10 '캡처 및 스케치'는 ApplicationFrameHost 창 안에 호스팅된다.
  windowTitles: ['캡처 및 스케치', 'Snip & Sketch'],
  // 버튼 AutomationId 후보. 캡처 도구 버전에 따라 다를 수 있어 이름 매칭을 함께 사용한다.
  // NewCaptureButton: Windows 11 캡처 도구에서 확인한 값
  automationIds: ['NewCaptureButton', 'NewButton', 'NewSnipButton', 'NewScreenshotButton'],
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

// 스크립트에 들어가면 안 되는 호출(차단 경로 우회/입력 주입/난독화/강제 종료)
const FORBIDDEN_TOKENS = [
  'ms-screenclip',
  'sendkeys',
  'sendinput',
  'keybd_event',
  'mouse_event',
  'encodedcommand',
  'executionpolicy',
  'invoke-expression',
  'iex ',
  'stop-process',
  'taskkill'
];

/**
 * 버튼 이름 정규화. uia.ps1 의 Get-NormalizedName 과 같은 규칙을 유지한다.
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

function normalizeTimeout(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(99999, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

/**
 * ps1 본문 앞에 파라미터 대입문을 붙이고, 주석/빈 줄을 제거해 -Command 인자로 넘길 문자열을 만든다.
 * 명령줄 인용 문제를 피하려고 큰따옴표가 있으면 예외를 던진다.
 * @param {string} scriptText
 * @param {{mode?:string, timeoutMs?:number, extraButtonNames?:string[]}} [options]
 */
function buildCommand(scriptText, options) {
  const opts = options || {};
  const mode = opts.mode === undefined ? 'invoke' : opts.mode;
  if (!MODES.includes(mode)) {
    throw new Error('지원하지 않는 모드입니다: ' + mode);
  }
  const buttonNames = TARGET.buttonNames.concat(sanitizeExtraNames(opts.extraButtonNames));

  const body = String(scriptText || '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('#');
    })
    .join('\n');

  const header = [
    '$Mode = ' + psQuote(mode),
    '$ProcessNames = ' + psArray(TARGET.processNames),
    '$WindowTitles = ' + psArray(TARGET.windowTitles),
    '$AutomationIds = ' + psArray(TARGET.automationIds),
    '$ButtonNames = ' + psArray(buttonNames),
    '$TimeoutMs = ' + normalizeTimeout(opts.timeoutMs)
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

/**
 * 상주 워커에 보낼 요청 줄. 명령은 MODES 중 server 를 제외한 값만, 인자는 숫자만 허용한다.
 */
function buildWorkerRequest(id, command, arg) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('잘못된 요청 번호입니다.');
  if (command === 'server' || (command !== 'ping' && !MODES.includes(command))) {
    throw new Error('지원하지 않는 명령입니다: ' + command);
  }
  const parts = [String(id), command];
  if (arg !== undefined && arg !== null && arg !== '') {
    if (!/^\d{1,5}$/.test(String(arg))) throw new Error('잘못된 인자입니다.');
    parts.push(String(arg));
  }
  return parts.join(' ') + '\n';
}

/**
 * 상주 워커 출력 한 줄 해석.
 * @returns {{type:'ready'} | {type:'line', id:number, payload:string, final:boolean} | {type:'fatal', payload:string} | null}
 */
function parseWorkerLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  if (s === 'READY') return { type: 'ready' };
  // 준비 전에 출력되는 결과(UI Automation 로드 실패 등)
  if (/^RESULT:\d+:/.test(s)) return { type: 'fatal', payload: s };
  const m = /^(\d{1,9}) (.+)$/.exec(s);
  if (!m) return null;
  return { type: 'line', id: parseInt(m[1], 10), payload: m[2], final: /^RESULT:\d+:/.test(m[2]) };
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

/** running 결과(RESULT:0:123-456)에서 PID 목록. 실행 중이 아니면 [], 해석 불가면 null */
function parseRunningPids(result) {
  if (!result) return null;
  if (result.code === 2) return [];
  if (result.code !== 0) return null;
  return String(result.detail)
    .split('-')
    .map((v) => parseInt(v, 10))
    .filter((v) => Number.isInteger(v) && v > 0);
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

/**
 * 캡처 후 닫기/최소화 결과 메시지. 창이 이미 없으면(코드 2) 사용자가 직접 닫은 것이므로 안내하지 않는다.
 * @param {'close'|'minimize'} action
 */
function windowStateMessageFor(action, code) {
  const verb = action === 'minimize' ? '최소화하지' : '닫지';
  if (code === 0 || code === 2) return null;
  if (code === 4) {
    return action === 'minimize'
      ? '캡처 도구 창을 자동으로 최소화하지 못했습니다.'
      : '캡처 도구 창을 자동으로 닫지 못했습니다. 저장 확인 창이 떠 있다면 직접 선택해 주세요.';
  }
  if (code === 5) return '이 PC에서 UI Automation 을 사용할 수 없어 캡처 도구 창을 ' + verb + ' 못했습니다.';
  return '캡처 도구 창을 자동으로 ' + verb + ' 못했습니다(알 수 없는 오류).';
}

/** 하위 호환: 닫기 결과 메시지 */
function closeMessageFor(code) {
  return windowStateMessageFor('close', code);
}

/**
 * 이번에 활성화한 캡처 도구가 이 프로그램이 예전에 실행해 둔 것(최소화해 둔 창 등)인지.
 * @param {number[]} pidsBefore  단축키를 누르기 직전 실행 중이던 PID
 * @param {Set<number>|number[]} ownedPids  이 프로그램이 실행한 캡처 도구 PID
 */
function isOwnedInstance(pidsBefore, ownedPids) {
  if (!Array.isArray(pidsBefore) || pidsBefore.length === 0 || !ownedPids) return false;
  const owned = ownedPids instanceof Set ? ownedPids : new Set(ownedPids);
  return pidsBefore.some((pid) => owned.has(pid));
}

/**
 * 캡처 후 닫기/최소화 타이머를 걸지 결정한다.
 * - 설정이 켜져 있고, '새 캡처'를 실제로 눌렀을 때만
 * - 이 프로그램이 캡처 도구를 새로 실행했거나(launched),
 *   직전 대기 중에 다시 눌렀거나(hadPending), 예전에 이 프로그램이 실행해 둔 창(owned)인 경우에만.
 *   사용자가 직접 열어 두었던 창은 건드리지 않는다.
 * @param {{enabled:boolean, newCaptureOk:boolean, action?:string, hadPending?:boolean, owned?:boolean}} p
 */
function shouldScheduleAutoClose(p) {
  if (!p || !p.enabled || !p.newCaptureOk) return false;
  return p.action === 'launched' || !!p.hadPending || !!p.owned;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  LAUNCH_TIMEOUT_MS,
  MODES,
  AFTER_CAPTURE_ACTIONS,
  TARGET,
  FORBIDDEN_TOKENS,
  normalizeButtonName,
  sanitizeExtraNames,
  buildCommand,
  buildWorkerRequest,
  parseWorkerLine,
  parseButtons,
  parseResult,
  parseRunningPids,
  messageFor,
  windowStateMessageFor,
  closeMessageFor,
  isOwnedInstance,
  shouldScheduleAutoClose
};
