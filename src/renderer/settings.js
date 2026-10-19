/* global Accelerator, snipApi */
(function () {
  'use strict';

  var $ = function (id) {
    return document.getElementById(id);
  };

  var el = {
    box: $('shortcutBox'),
    status: $('shortcutStatus'),
    hint: $('recordHint'),
    message: $('message'),
    btnRecord: $('btnRecord'),
    btnSave: $('btnSave'),
    btnCancel: $('btnCancel'),
    btnReset: $('btnReset'),
    chkAutoLaunch: $('chkAutoLaunch'),
    chkNotifications: $('chkNotifications'),
    chkAutoNew: $('chkAutoNew'),
    selLaunchTarget: $('selLaunchTarget'),
    portableNote: $('portableNote'),
    btnOpenSnip: $('btnOpenSnip'),
    btnFolder: $('btnFolder'),
    version: $('version')
  };

  var state = null;
  var recording = false;
  var pending = null; // 녹화 중 입력된 유효한 accelerator
  var busy = false;

  function showMessage(text, kind) {
    if (!text) {
      el.message.hidden = true;
      el.message.textContent = '';
      return;
    }
    el.message.hidden = false;
    el.message.className = 'message ' + (kind || '');
    el.message.textContent = text;
  }

  function render(next) {
    if (next) state = next;
    if (!state) return;

    if (!recording) {
      el.box.textContent = state.shortcutDisplay || '-';
    }
    el.status.className = 'badge ' + (state.shortcutActive ? 'ok' : 'err');
    el.status.textContent = state.shortcutActive ? '사용 중' : '등록 안 됨';
    if (recording) {
      el.status.className = 'badge';
      el.status.textContent = '입력 대기';
    }

    el.chkAutoLaunch.checked = !!state.autoLaunch;
    el.chkNotifications.checked = !!state.showNotifications;
    el.chkAutoNew.checked = !!state.autoNewCapture;
    el.selLaunchTarget.value = state.launchTarget || 'auto';
    el.portableNote.hidden = !state.isPortable;
    el.version.textContent = 'v' + state.version;
  }

  function setRecordingUi(on) {
    recording = on;
    el.box.classList.toggle('recording', on);
    el.hint.hidden = !on;
    el.btnRecord.hidden = on;
    el.btnSave.hidden = !on;
    el.btnCancel.hidden = !on;
    el.btnReset.disabled = on;
    el.btnSave.disabled = true;
  }

  function startRecording() {
    if (recording || busy) return;
    pending = null;
    showMessage('');
    snipApi.suspendShortcut().then(function () {
      setRecordingUi(true);
      el.box.textContent = '키를 누르세요…';
      el.box.focus();
      render();
    });
  }

  function stopRecording() {
    if (!recording) return Promise.resolve();
    setRecordingUi(false);
    pending = null;
    return snipApi.resumeShortcut().then(function () {
      return snipApi.getState().then(render);
    });
  }

  function saveRecording() {
    if (!recording || !pending || busy) return;
    busy = true;
    var accelerator = pending;
    snipApi
      .setShortcut(accelerator)
      .then(function (result) {
        setRecordingUi(false);
        pending = null;
        render(result.state);
        if (result.ok) {
          showMessage('단축키가 ' + Accelerator.toDisplay(result.accelerator) + ' 로 변경되었습니다.', 'ok');
        } else {
          showMessage(result.error, 'err');
        }
      })
      .finally(function () {
        busy = false;
      });
  }

  function onKeyDown(e) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      stopRecording();
      showMessage('');
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      saveRecording();
      return;
    }

    var accelerator = Accelerator.fromKeyEvent(e);
    if (!accelerator) {
      // 수식키만 누른 상태: 진행 상황만 보여준다.
      var mods = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push('Win');
      el.box.textContent = mods.length ? mods.join(' + ') + ' + …' : '키를 누르세요…';
      return;
    }

    el.box.textContent = Accelerator.toDisplay(accelerator);
    var v = Accelerator.validate(accelerator);
    if (v.ok) {
      pending = v.accelerator;
      el.btnSave.disabled = false;
      showMessage('Enter 또는 저장 버튼을 누르면 적용됩니다.', '');
    } else {
      pending = null;
      el.btnSave.disabled = true;
      showMessage(v.error, 'err');
    }
  }

  // --- 이벤트 바인딩 -------------------------------------------------------
  window.addEventListener('keydown', onKeyDown, true);

  // 창이 포커스를 잃으면 녹화를 취소해 단축키가 해제된 채로 남지 않게 한다.
  window.addEventListener('blur', function () {
    if (recording) stopRecording();
  });

  el.btnRecord.addEventListener('click', startRecording);
  el.btnCancel.addEventListener('click', function () {
    stopRecording();
    showMessage('');
  });
  el.btnSave.addEventListener('click', saveRecording);

  el.btnReset.addEventListener('click', function () {
    if (busy) return;
    busy = true;
    snipApi
      .resetShortcut()
      .then(function (result) {
        render(result.state);
        showMessage(result.ok ? '기본 단축키(Ctrl + Alt + S)로 복원했습니다.' : result.error, result.ok ? 'ok' : 'err');
      })
      .finally(function () {
        busy = false;
      });
  });

  el.chkAutoLaunch.addEventListener('change', function () {
    var wanted = el.chkAutoLaunch.checked;
    snipApi.setAutoLaunch(wanted).then(function (result) {
      render(result.state);
      if (!result.ok) showMessage(result.error, 'err');
    });
  });

  el.chkNotifications.addEventListener('change', function () {
    snipApi.setNotifications(el.chkNotifications.checked).then(function (result) {
      render(result.state);
    });
  });

  el.chkAutoNew.addEventListener('change', function () {
    var wanted = el.chkAutoNew.checked;
    el.chkAutoNew.disabled = true;
    snipApi
      .setAutoNewCapture(wanted)
      .then(function (result) {
        // 확인 창에서 취소하면 state 기준으로 체크가 원래대로 돌아간다.
        render(result.state);
        if (result.ok) {
          showMessage(wanted ? "단축키로 열 때 '새 캡처'까지 실행합니다." : "'새 캡처' 자동 실행을 껐습니다.", 'ok');
        }
      })
      .finally(function () {
        el.chkAutoNew.disabled = false;
      });
  });

  el.selLaunchTarget.addEventListener('change', function () {
    snipApi.setLaunchTarget(el.selLaunchTarget.value).then(function (result) {
      render(result.state);
    });
  });

  el.btnOpenSnip.addEventListener('click', function () {
    el.btnOpenSnip.disabled = true;
    snipApi
      .openSnip()
      .then(function (result) {
        if (result && !result.ok && result.error) showMessage(result.error, 'err');
      })
      .finally(function () {
        el.btnOpenSnip.disabled = false;
      });
  });

  el.btnFolder.addEventListener('click', function () {
    snipApi.openSettingsFolder();
  });

  snipApi.onStateChanged(function (next) {
    render(next);
  });

  snipApi.getState().then(render);
})();
