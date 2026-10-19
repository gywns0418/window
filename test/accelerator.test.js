'use strict';

const assert = require('assert');
const A = require('../src/shared/accelerator');

test('accelerator: 기본 단축키는 Control+Alt+S', () => {
  assert.strictEqual(A.DEFAULT_SHORTCUT, 'Control+Alt+S');
  assert.deepStrictEqual(A.validate(A.DEFAULT_SHORTCUT), { ok: true, accelerator: 'Control+Alt+S' });
});

test('accelerator: keydown → accelerator (물리 키 코드 기준)', () => {
  const ev = (code, mods) => Object.assign({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, mods);
  assert.strictEqual(A.fromKeyEvent(ev('KeyS', { ctrlKey: true, altKey: true })), 'Control+Alt+S');
  assert.strictEqual(A.fromKeyEvent(ev('Digit1', { ctrlKey: true, shiftKey: true })), 'Control+Shift+1');
  assert.strictEqual(A.fromKeyEvent(ev('F9', { altKey: true })), 'Alt+F9');
  assert.strictEqual(A.fromKeyEvent(ev('ArrowUp', { ctrlKey: true })), 'Control+Up');
  assert.strictEqual(A.fromKeyEvent(ev('ControlLeft', { ctrlKey: true })), null);
  assert.strictEqual(A.fromKeyEvent(ev('ShiftRight', { shiftKey: true })), null);
});

test('accelerator: 정규화(별칭/대소문자/순서)', () => {
  assert.strictEqual(A.normalize('ctrl+alt+s'), 'Control+Alt+S');
  assert.strictEqual(A.normalize('Shift+Alt+Ctrl+x'), 'Control+Alt+Shift+X');
  assert.strictEqual(A.normalize('CmdOrCtrl+F2'), 'Control+F2');
  assert.strictEqual(A.normalize('Control+A+B'), null);
  assert.strictEqual(A.normalize('Control+'), null);
  assert.strictEqual(A.normalize(''), null);
  assert.strictEqual(A.normalize(null), null);
});

test('accelerator: 표시 문자열', () => {
  assert.strictEqual(A.toDisplay('Control+Alt+S'), 'Ctrl + Alt + S');
});

test('accelerator: 정책 검증', () => {
  assert.strictEqual(A.validate('S').ok, false, '수식키 없음');
  assert.strictEqual(A.validate('Shift+S').ok, false, 'Shift 단독');
  assert.strictEqual(A.validate('F5').ok, false, 'F키 단독');
  assert.strictEqual(A.validate('Super+Shift+S').ok, false, 'Win 조합 금지');
  assert.strictEqual(A.validate('Control+Super+S').ok, false, 'Win 조합 금지');
  assert.strictEqual(A.validate('Control+Alt+Delete').ok, false, '시스템 예약');
  assert.strictEqual(A.validate('Control+Alt+Foo').ok, false, '알 수 없는 키');
  assert.strictEqual(A.validate('Alt+F5').ok, true);
  assert.strictEqual(A.validate('Control+Shift+PrintScreen').ok, true);
});
