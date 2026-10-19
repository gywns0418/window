'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../src/main/newCaptureCore');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'scripts', 'uia.ps1'), 'utf8');

test('newCaptureCore: 모든 모드로 uia.ps1 명령 생성 (큰따옴표/금지 호출/강제 종료 없음)', () => {
  core.MODES.forEach((mode) => {
    const cmd = core.buildCommand(SCRIPT, { mode, timeoutMs: 4000 });
    assert.ok(cmd.startsWith("$Mode = '" + mode + "'"), mode);
    assert.ok(cmd.includes('$TimeoutMs = 4000'));
    assert.ok(cmd.includes("$ButtonNames = @('새 캡처'"), "'새 캡처'가 첫 번째 후보");
    assert.ok(!cmd.includes('"'));
    core.FORBIDDEN_TOKENS.forEach((t) => assert.ok(!cmd.toLowerCase().includes(t), mode + ': ' + t));
  });
});

test('newCaptureCore: 지원하지 않는 모드 거부', () => {
  assert.throws(() => core.buildCommand(SCRIPT, { mode: 'exec' }));
  assert.throws(() => core.buildCommand(SCRIPT, { mode: "invoke'; Remove-Item" }));
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
  assert.ok(core.LAUNCH_TIMEOUT_MS > core.DEFAULT_TIMEOUT_MS);
});

test('newCaptureCore: 큰따옴표/금지 호출이 있으면 거부', () => {
  assert.throws(() => core.buildCommand('Write-Output "x"'));
  assert.throws(() => core.buildCommand("Start-Process 'ms-screenclip:'"));
  assert.throws(() => core.buildCommand("$s.SendKeys('^n')"));
  assert.throws(() => core.buildCommand("powershell -EncodedCommand 'abc'"));
  assert.throws(() => core.buildCommand('Stop-Process -Name SnippingTool'));
  assert.throws(() => core.buildCommand('taskkill /IM SnippingTool.exe'));
});

test('newCaptureCore: 상주 워커 요청 줄 (정해진 명령/숫자 인자만)', () => {
  assert.strictEqual(core.buildWorkerRequest(1, 'invoke', 4000), '1 invoke 4000\n');
  assert.strictEqual(core.buildWorkerRequest(2, 'close'), '2 close\n');
  assert.strictEqual(core.buildWorkerRequest(3, 'minimize'), '3 minimize\n');
  assert.strictEqual(core.buildWorkerRequest(4, 'running'), '4 running\n');
  assert.strictEqual(core.buildWorkerRequest(5, 'ping'), '5 ping\n');
  assert.throws(() => core.buildWorkerRequest(6, 'server'));
  assert.throws(() => core.buildWorkerRequest(7, 'Get-Process'));
  assert.throws(() => core.buildWorkerRequest(8, 'invoke', '1; whoami'));
  assert.throws(() => core.buildWorkerRequest(0, 'close'));
});

test('newCaptureCore: 상주 워커 출력 줄 해석', () => {
  assert.deepStrictEqual(core.parseWorkerLine('READY\r'), { type: 'ready' });
  assert.deepStrictEqual(core.parseWorkerLine('RESULT:5:uia-unavailable'), { type: 'fatal', payload: 'RESULT:5:uia-unavailable' });
  assert.deepStrictEqual(core.parseWorkerLine('12 BUTTONS:a:b'), { type: 'line', id: 12, payload: 'BUTTONS:a:b', final: false });
  assert.deepStrictEqual(core.parseWorkerLine('12 RESULT:0:invoked'), { type: 'line', id: 12, payload: 'RESULT:0:invoked', final: true });
  assert.strictEqual(core.parseWorkerLine(''), null);
  assert.strictEqual(core.parseWorkerLine('garbage'), null);
});

test('newCaptureCore: running 결과 PID 해석', () => {
  assert.deepStrictEqual(core.parseRunningPids(core.parseResult('RESULT:0:123-456')), [123, 456]);
  assert.deepStrictEqual(core.parseRunningPids(core.parseResult('RESULT:2:none')), []);
  assert.strictEqual(core.parseRunningPids(core.parseResult('RESULT:1:error')), null);
  assert.strictEqual(core.parseRunningPids(null), null);
});

test('newCaptureCore: 버튼 이름 정규화 (단축키/니모닉 표기 제거)', () => {
  const n = core.normalizeButtonName;
  assert.strictEqual(n('새 캡처'), '새 캡처');
  assert.strictEqual(n('새 캡처 (Ctrl+N)'), '새 캡처');
  assert.strictEqual(n('새 캡처(Ctrl + N)'), '새 캡처');
  assert.strictEqual(n('새 스크린샷(Ctrl + N)'), '새 스크린샷');
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

test('newCaptureCore: 닫기/최소화 결과 메시지', () => {
  ['close', 'minimize'].forEach((a) => {
    assert.strictEqual(core.windowStateMessageFor(a, 0), null);
    assert.strictEqual(core.windowStateMessageFor(a, 2), null, '이미 닫힌 경우 안내 안 함');
    assert.ok(core.windowStateMessageFor(a, 4));
    assert.ok(core.windowStateMessageFor(a, 5));
    assert.ok(core.windowStateMessageFor(a, -1));
  });
  assert.ok(core.windowStateMessageFor('minimize', 4).includes('최소화'));
  assert.strictEqual(core.closeMessageFor(2), null);
});

test('newCaptureCore: 이 프로그램이 실행한 창 판별', () => {
  assert.strictEqual(core.isOwnedInstance([10, 20], new Set([20])), true);
  assert.strictEqual(core.isOwnedInstance([10], [20]), false);
  assert.strictEqual(core.isOwnedInstance([], new Set([20])), false);
  assert.strictEqual(core.isOwnedInstance(undefined, new Set([20])), false);
});

test('newCaptureCore: 자동 닫기/최소화 예약 조건', () => {
  const s = core.shouldScheduleAutoClose;
  assert.strictEqual(s({ enabled: true, newCaptureOk: true, action: 'launched' }), true);
  assert.strictEqual(s({ enabled: true, newCaptureOk: true, action: 'activated' }), false, '직접 열어 둔 창');
  assert.strictEqual(s({ enabled: true, newCaptureOk: true, action: 'activated', hadPending: true }), true, '대기 중 재입력');
  assert.strictEqual(s({ enabled: true, newCaptureOk: true, action: 'activated', owned: true }), true, '최소화해 둔 내 창');
  assert.strictEqual(s({ enabled: false, newCaptureOk: true, action: 'launched' }), false, '설정 꺼짐');
  assert.strictEqual(s({ enabled: true, newCaptureOk: false, action: 'launched' }), false, "'새 캡처' 실패");
  assert.strictEqual(s(null), false);
});

test("newCaptureCore: '새 캡처'는 찾으면 한 번만 누름(확인/다시 누르기 없음)", () => {
  assert.ok(SCRIPT.includes('function Invoke-ButtonOnce($b)'));
  assert.ok(SCRIPT.includes('return Invoke-ButtonOnce $fast'));
  assert.ok(SCRIPT.includes('return Invoke-ButtonOnce $b'));
  assert.strictEqual((SCRIPT.match(/\.Invoke\(\)/g) || []).length, 1, 'Invoke() 호출 위치는 한 곳');
  assert.ok(!SCRIPT.includes('$attempt'), '다시 누르기 반복 없음');
});

test('newCaptureCore: 확인된 AutomationId(NewCaptureButton)를 첫 후보로 사용', () => {
  assert.strictEqual(core.TARGET.automationIds[0], 'NewCaptureButton');
  const cmd = core.buildCommand(SCRIPT, { mode: 'invoke' });
  assert.ok(cmd.includes("$AutomationIds = @('NewCaptureButton'"));
  assert.ok(SCRIPT.includes('$fast = $w.FindFirst($TreeScope::Descendants, $IdCond)'));
});
