'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../src/main/newCaptureCore');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'scripts', 'invoke-new.ps1'), 'utf8');

test('newCaptureCore: 실제 ps1 로 명령 생성 (큰따옴표/금지 호출 없음)', () => {
  const cmd = core.buildCommand(SCRIPT, { timeoutMs: 4000 });
  assert.ok(cmd.startsWith('$ProcessNames = '));
  assert.ok(cmd.includes('$TimeoutMs = 4000'));
  assert.ok(cmd.includes("$ButtonNames = @('새 캡처'"), "'새 캡처'가 첫 번째 후보");
  assert.ok(!cmd.includes('"'));
  core.FORBIDDEN_TOKENS.forEach((t) => assert.ok(!cmd.toLowerCase().includes(t), t));
});

test('newCaptureCore: 주석/빈 줄 제거', () => {
  const cmd = core.buildCommand("# comment\n\n  # indented\nWrite-Output 'x'\n");
  assert.ok(!cmd.includes('comment'));
  assert.ok(!cmd.includes('indented'));
  assert.ok(cmd.endsWith("Write-Output 'x'"));
});

test('newCaptureCore: 기본 타임아웃', () => {
  const cmd = core.buildCommand("Write-Output 'x'", { timeoutMs: -1 });
  assert.ok(cmd.includes('$TimeoutMs = ' + core.DEFAULT_TIMEOUT_MS));
});

test('newCaptureCore: 큰따옴표/금지 호출이 있으면 거부', () => {
  assert.throws(() => core.buildCommand('Write-Output "x"'));
  assert.throws(() => core.buildCommand("Start-Process 'ms-screenclip:'"));
  assert.throws(() => core.buildCommand("$s.SendKeys('^n')"));
  assert.throws(() => core.buildCommand("powershell -EncodedCommand 'abc'"));
});

test('newCaptureCore: 버튼 이름 정규화 (단축키/니모닉 표기 제거)', () => {
  const n = core.normalizeButtonName;
  assert.strictEqual(n('새 캡처'), '새 캡처');
  assert.strictEqual(n('새 캡처 (Ctrl+N)'), '새 캡처');
  assert.strictEqual(n('새 캡처(Ctrl + N)'), '새 캡처');
  assert.strictEqual(n('새 캡처 Ctrl+N'), '새 캡처');
  assert.strictEqual(n('새 캡처 (컨트롤+Shift+N)'), '새 캡처');
  assert.strictEqual(n('새로 만들기(N)'), '새로 만들기');
  assert.strictEqual(n('&New'), 'new');
  assert.strictEqual(n('  New   screenshot  '), 'new screenshot');
  assert.strictEqual(n(''), '');
  assert.strictEqual(n(null), '');
});

test('newCaptureCore: ps1 정규화 규칙이 JS 와 같은 패턴을 사용', () => {
  assert.ok(SCRIPT.includes("'\\s*\\(?\\s*(ctrl|control|컨트롤)(\\s*\\+\\s*[A-Za-z0-9]+)+\\s*\\)?\\s*$'"));
  assert.ok(SCRIPT.includes("'\\s*\\([A-Za-z]\\)\\s*$'"));
});

test('newCaptureCore: settings.json 추가 이름 정리', () => {
  assert.deepStrictEqual(core.sanitizeExtraNames(null), []);
  assert.deepStrictEqual(core.sanitizeExtraNames('새 캡처'), []);
  assert.deepStrictEqual(
    core.sanitizeExtraNames([' 캡처 시작 ', '', 1, 'a"b', 'x\ny', '캡처 시작 (Ctrl+N)', 'A'.repeat(41)]),
    ['캡처 시작']
  );
  const many = Array.from({ length: 20 }, (_, i) => 'name' + i);
  assert.strictEqual(core.sanitizeExtraNames(many).length, 10);
});

test('newCaptureCore: 추가 이름은 후보 뒤에 붙고, 작은따옴표는 이스케이프', () => {
  const cmd = core.buildCommand("Write-Output 'x'", { extraButtonNames: ["캡처'시작"] });
  assert.ok(cmd.includes("'New screenshot', '캡처''시작')"));
  assert.throws(() => core.buildCommand("Write-Output 'x'", { extraButtonNames: ['SendKeys'] }));
});

test('newCaptureCore: 결과 파싱', () => {
  assert.deepStrictEqual(core.parseResult('RESULT:0:invoked\r\n'), { code: 0, detail: 'invoked', buttons: [] });
  assert.deepStrictEqual(core.parseResult('noise\nRESULT:3:button-not-found\n'), {
    code: 3,
    detail: 'button-not-found',
    buttons: []
  });
  assert.deepStrictEqual(core.parseResult(''), { code: -1, detail: 'no-result', buttons: [] });
});

test('newCaptureCore: 진단 버튼 목록 파싱 (\\uXXXX 이스케이프)', () => {
  // '새 캡처:NewSnip' , '닫기:Close' , ':IdOnly'
  const esc = (s) =>
    s.replace(/[^A-Za-z0-9 ]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const line = 'BUTTONS:' + [esc('새 캡처') + ':' + 'NewSnip', esc('a|b:c') + ':', ':IdOnly'].join('|');
  const parsed = core.parseResult(line + '\r\nRESULT:3:button-not-found\r\n');
  assert.deepStrictEqual(parsed.buttons, [
    { name: '새 캡처', automationId: 'NewSnip' },
    { name: 'a|b:c', automationId: '' },
    { name: '', automationId: 'IdOnly' }
  ]);
  const msg = core.messageFor(3, parsed.buttons);
  assert.ok(msg.includes('• 새 캡처  [NewSnip]'));
  assert.ok(msg.includes('• (이름 없음)  [IdOnly]'));
  assert.ok(msg.includes('newCaptureButtonNames'));
});

test('newCaptureCore: 메시지', () => {
  assert.strictEqual(core.messageFor(0), null);
  assert.ok(core.messageFor(3).includes('새 캡처'));
  assert.ok(!core.messageFor(3).includes('newCaptureButtonNames'), '진단 정보 없으면 안내 생략');
  assert.ok(core.messageFor(99));
});
