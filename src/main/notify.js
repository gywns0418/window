/**
 * 사용자 알림. Windows 알림(토스트)을 우선 사용하고, 불가하면 메시지 박스로 대체한다.
 */
'use strict';

const { Notification, dialog } = require('electron');
const { createWindowIcon } = require('./icon');

const APP_TITLE = 'SnipShortcut';

function toast(title, body) {
  try {
    if (!Notification.isSupported()) return false;
    new Notification({ title, body, icon: createWindowIcon(), silent: false }).show();
    return true;
  } catch (e) {
    return false;
  }
}

/** 정보성 알림: 알림 설정이 꺼져 있으면 표시하지 않는다. */
function info(body, enabled) {
  if (!enabled) return;
  toast(APP_TITLE, body);
}

/** 오류 알림: 알림 설정과 무관하게 항상 표시한다. */
function error(body, opts) {
  const options = opts || {};
  if (options.modal) {
    dialog.showMessageBox({ type: 'warning', title: APP_TITLE, message: body, buttons: ['확인'], noLink: true });
    return;
  }
  if (!toast(APP_TITLE + ' 오류', body)) {
    dialog.showMessageBox({ type: 'error', title: APP_TITLE, message: body, buttons: ['확인'], noLink: true });
  }
}

module.exports = { APP_TITLE, info, error };
