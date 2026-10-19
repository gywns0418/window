/**
 * 의존성 없는 최소 테스트 러너(Node 16 에서도 동작).
 * Electron 에 의존하지 않는 순수 로직만 검증한다.
 *   npm test
 */
'use strict';

const fs = require('fs');
const path = require('path');

const tests = [];
global.test = (name, fn) => tests.push({ name, fn });

fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .forEach((f) => require(path.join(__dirname, f)));

let failed = 0;
(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      console.log('  ok   ' + t.name);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + t.name);
      console.log('       ' + String((e && e.stack) || e).split('\n').join('\n       '));
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
