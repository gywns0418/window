/**
 * 단계별 소요 시간 로그 파일 기록.
 * 위치: %APPDATA%\SnipShortcut\timing.log (1MB 를 넘으면 비우고 새로 쓴다)
 * 클립보드/화면 내용은 기록하지 않고 시간과 처리 방식만 남긴다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { formatTimingLine } = require('./timingCore');

const MAX_BYTES = 1024 * 1024;

function filePath() {
  return path.join(app.getPath('userData'), 'timing.log');
}

function write(entry) {
  const target = filePath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let size = 0;
    try {
      size = fs.statSync(target).size;
    } catch (e) {
      size = 0;
    }
    const line = formatTimingLine(entry) + '\n';
    if (size > MAX_BYTES) fs.writeFileSync(target, line, 'utf8');
    else fs.appendFileSync(target, line, 'utf8');
  } catch (e) {
    // 로그 실패는 동작에 영향을 주지 않는다.
  }
}

module.exports = { write, filePath };
