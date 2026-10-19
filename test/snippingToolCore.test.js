'use strict';

const assert = require('assert');
const core = require('../src/main/snippingToolCore');

const WIN10 = '10.0.19045';
const WIN11 = '10.0.22631';
const LEGACY = 'C:\\Windows\\System32\\SnippingTool.exe';

const exists = (set) => (p) => set.includes(p);

test('snippingToolCore: Windows 빌드 판별', () => {
  assert.strictEqual(core.parseWindowsBuild(WIN11), 22631);
  assert.strictEqual(core.isWindows11(WIN11), true);
  assert.strictEqual(core.isWindows11(WIN10), false);
  assert.strictEqual(core.parseWindowsBuild('garbage'), 0);
});

test('snippingToolCore: auto - Windows 11 은 신규 캡처 도구 앱', () => {
  const t = core.resolveLaunchTarget({ preference: 'auto', release: WIN11, systemRoot: 'C:\\Windows', exists: exists([LEGACY]) });
  assert.strictEqual(t.kind, 'modern');
  assert.strictEqual(t.command, 'explorer.exe');
  assert.deepStrictEqual(t.args, ['shell:AppsFolder\\Microsoft.ScreenSketch_8wekyb3d8bbwe!App']);
});

test('snippingToolCore: auto - Windows 10 은 SnippingTool.exe 가 있으면 사용', () => {
  const t = core.resolveLaunchTarget({ preference: 'auto', release: WIN10, systemRoot: 'C:\\Windows', exists: exists([LEGACY]) });
  assert.strictEqual(t.kind, 'legacy');
  assert.strictEqual(t.command, LEGACY);
});

test('snippingToolCore: auto - Windows 10 에 SnippingTool.exe 가 없으면 앱', () => {
  const t = core.resolveLaunchTarget({ preference: 'auto', release: WIN10, systemRoot: 'C:\\Windows', exists: exists([]) });
  assert.strictEqual(t.kind, 'modern');
});

test('snippingToolCore: legacy 지정인데 파일이 없으면 실행하지 않음', () => {
  const t = core.resolveLaunchTarget({ preference: 'legacy', release: WIN11, systemRoot: 'C:\\Windows', exists: exists([]) });
  assert.strictEqual(t.kind, 'none');
});

test('snippingToolCore: 화면 캡처 URI(ms-screenclip) 경로를 사용하지 않음', () => {
  ['auto', 'modern', 'legacy'].forEach((preference) => {
    [WIN10, WIN11].forEach((release) => {
      const t = core.resolveLaunchTarget({ preference, release, systemRoot: 'C:\\Windows', exists: exists([LEGACY]) });
      const joined = [t.command || ''].concat(t.args || []).join(' ').toLowerCase();
      assert.ok(!joined.includes('ms-screenclip'), preference + '/' + release);
    });
  });
});

test('snippingToolCore: tasklist CSV 파싱', () => {
  const out = [
    '"System Idle Process","0","Services","0","8 K"',
    '"SnippingTool.exe","12345","Console","1","45,000 K"',
    '"explorer.exe","4321","Console","1","120,000 K"',
    '"ScreenSketch.exe","777","Console","1","30,000 K"',
    ''
  ].join('\r\n');
  assert.deepStrictEqual(core.parseTasklistCsv(out), [
    { name: 'SnippingTool.exe', pid: 12345 },
    { name: 'ScreenSketch.exe', pid: 777 }
  ]);
  assert.deepStrictEqual(core.parseTasklistCsv('INFO: No tasks are running which match the specified criteria.'), []);
});

const LOCAL = 'C:\\Users\\me\\AppData\\Local';
const ALIAS = LOCAL + '\\Microsoft\\WindowsApps\\SnippingTool.exe';

test('snippingToolCore: 실행 별칭이 있으면 explorer 대신 별칭으로 실행', () => {
  const t = core.resolveLaunchTarget({
    preference: 'auto',
    release: WIN11,
    systemRoot: 'C:\\Windows',
    localAppData: LOCAL,
    exists: exists([LEGACY, ALIAS])
  });
  assert.strictEqual(t.kind, 'modern');
  assert.strictEqual(t.via, 'alias');
  assert.strictEqual(t.command, ALIAS);
  assert.deepStrictEqual(t.args, []);
});

test('snippingToolCore: 별칭이 없거나 꺼져 있으면 explorer', () => {
  const base = { preference: 'modern', release: WIN11, systemRoot: 'C:\\Windows', localAppData: LOCAL };
  assert.strictEqual(core.resolveLaunchTarget(Object.assign({ exists: exists([]) }, base)).via, 'explorer');
  assert.strictEqual(
    core.resolveLaunchTarget(Object.assign({ exists: exists([ALIAS]), preferAlias: false }, base)).via,
    'explorer'
  );
  assert.strictEqual(core.executionAliasPath(undefined), null);
});

test('snippingToolCore: legacy 지정이면 별칭이 있어도 SnippingTool.exe(System32)', () => {
  const t = core.resolveLaunchTarget({
    preference: 'legacy',
    release: WIN11,
    systemRoot: 'C:\\Windows',
    localAppData: LOCAL,
    exists: exists([LEGACY, ALIAS])
  });
  assert.strictEqual(t.kind, 'legacy');
  assert.strictEqual(t.command, LEGACY);
});

test('snippingToolCore: 이름으로 걸러 조회하는 tasklist 인자', () => {
  assert.deepStrictEqual(core.tasklistArgs('SnippingTool.exe'), ['/FI', 'IMAGENAME eq SnippingTool.exe', '/FO', 'CSV', '/NH']);
});
