/**
 * 설정 파일 읽기/쓰기.
 * 위치: %APPDATA%\SnipShortcut\settings.json (app.getPath('userData'))
 * 포터블 exe 는 실행할 때마다 임시 폴더에 풀리므로 실행 파일 옆이 아닌 사용자 프로필에 저장한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeSettings } = require('./settingsCore');

let cache = null;

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch (e) {
    // 파일 없음/손상 → 기본값 사용
  }
  cache = normalizeSettings(raw);
  return cache;
}

/** 임시 파일에 쓴 뒤 rename 하여 쓰기 도중 종료돼도 설정 파일이 깨지지 않게 한다. */
function save(next) {
  const normalized = normalizeSettings(next);
  const target = filePath();
  const tmp = target + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  cache = normalized;
  return cache;
}

function update(patch) {
  return save(Object.assign({}, load(), patch));
}

module.exports = { load, save, update, filePath };
