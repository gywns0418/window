/**
 * 단축키(Electron Accelerator) 변환/검증 유틸.
 * main 프로세스(require)와 설정 화면(<script>) 양쪽에서 쓰기 위해 UMD 형태로 작성한다.
 * 의존성이 없는 순수 함수만 둔다(단위 테스트 대상).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Accelerator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_SHORTCUT = 'Control+Alt+S';

  var MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Super'];

  // KeyboardEvent.code 기반 매핑. 한글 IME 상태에서도 물리 키 기준으로 동일하게 동작한다.
  var CODE_MAP = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    PrintScreen: 'PrintScreen',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    Numpad0: 'num0',
    Numpad1: 'num1',
    Numpad2: 'num2',
    Numpad3: 'num3',
    Numpad4: 'num4',
    Numpad5: 'num5',
    Numpad6: 'num6',
    Numpad7: 'num7',
    Numpad8: 'num8',
    Numpad9: 'num9',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec'
  };

  var MODIFIER_CODES = {
    ControlLeft: 1, ControlRight: 1, AltLeft: 1, AltRight: 1,
    ShiftLeft: 1, ShiftRight: 1, MetaLeft: 1, MetaRight: 1,
    OSLeft: 1, OSRight: 1
  };

  var MODIFIER_ALIASES = {
    control: 'Control', ctrl: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control',
    alt: 'Alt', option: 'Alt', altgr: 'Alt',
    shift: 'Shift',
    super: 'Super', meta: 'Super', win: 'Super', cmd: 'Super', command: 'Super'
  };

  function isFunctionKey(key) {
    return /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  }

  function codeToKey(code) {
    if (!code) return null;
    if (MODIFIER_CODES[code]) return null;
    var m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    if (isFunctionKey(code)) return code;
    return CODE_MAP[code] || null;
  }

  /**
   * keydown 이벤트 형태의 객체를 Accelerator 문자열로 변환한다.
   * 수식키만 눌린 상태면 null.
   * @param {{code:string, ctrlKey:boolean, altKey:boolean, shiftKey:boolean, metaKey:boolean}} e
   */
  function fromKeyEvent(e) {
    var key = codeToKey(e && e.code);
    if (!key) return null;
    var parts = [];
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Super');
    parts.push(key);
    return parts.join('+');
  }

  /** 대소문자/별칭/순서를 정규화한다. 해석 불가하면 null. */
  function normalize(accelerator) {
    if (typeof accelerator !== 'string') return null;
    var tokens = accelerator.split('+').map(function (t) { return t.trim(); });
    if (tokens.length === 0 || tokens.some(function (t) { return t === ''; })) {
      // "Control++" 처럼 '+' 키 자체는 지원하지 않는다(Equal 키의 Shift 조합으로 대체).
      return null;
    }
    var mods = {};
    var key = null;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var alias = MODIFIER_ALIASES[t.toLowerCase()];
      if (alias) {
        mods[alias] = true;
        continue;
      }
      if (key !== null) return null; // 일반 키는 1개만
      key = t.length === 1 ? t.toUpperCase() : t;
    }
    if (key === null) return null;
    var out = MODIFIER_ORDER.filter(function (m) { return mods[m]; });
    out.push(key);
    return out.join('+');
  }

  function toDisplay(accelerator) {
    var n = normalize(accelerator);
    if (!n) return String(accelerator || '');
    return n
      .split('+')
      .map(function (t) {
        if (t === 'Control') return 'Ctrl';
        if (t === 'Super') return 'Win';
        return t;
      })
      .join(' + ');
  }

  /**
   * 사용자 지정 단축키 정책 검증.
   * - Ctrl 또는 Alt를 최소 1개 포함해야 한다(F1~F24 포함). 단일 키/Shift 단독 조합은
   *   다른 프로그램의 일반 입력을 가로채므로 허용하지 않는다.
   * - Win(Super) 조합은 금지: Windows 예약 단축키(Win+Shift+S 등)와 충돌하고,
   *   보안 정책으로 차단된 Win+Shift+S 경로를 대체하려는 용도로 오해될 수 있다.
   * @returns {{ok:true, accelerator:string} | {ok:false, error:string}}
   */
  function validate(accelerator) {
    var n = normalize(accelerator);
    if (!n) return { ok: false, error: '단축키 형식을 해석할 수 없습니다.' };
    var parts = n.split('+');
    var key = parts[parts.length - 1];
    var mods = parts.slice(0, -1);

    if (mods.indexOf('Super') !== -1) {
      return { ok: false, error: 'Windows 키(Win) 조합은 사용할 수 없습니다. Ctrl/Alt 조합을 사용해 주세요.' };
    }
    if (mods.indexOf('Control') === -1 && mods.indexOf('Alt') === -1) {
      return { ok: false, error: 'Ctrl 또는 Alt 키를 하나 이상 포함해야 합니다.' };
    }
    if (n === 'Control+Alt+Delete') {
      return { ok: false, error: 'Ctrl + Alt + Delete 는 시스템 예약 키입니다.' };
    }
    var known =
      /^[A-Z0-9]$/.test(key) ||
      isFunctionKey(key) ||
      Object.keys(CODE_MAP).some(function (c) { return CODE_MAP[c] === key; });
    if (!known) return { ok: false, error: '지원하지 않는 키입니다: ' + key };
    return { ok: true, accelerator: n };
  }

  return {
    DEFAULT_SHORTCUT: DEFAULT_SHORTCUT,
    codeToKey: codeToKey,
    fromKeyEvent: fromKeyEvent,
    normalize: normalize,
    toDisplay: toDisplay,
    validate: validate
  };
});
