/* ═══════════════════════════════════════
   Dynamic Notch — Core Logic (Rebuild)
   ═══════════════════════════════════════ */

let isExpanded = false;
let hoverTimeout = null;
let currentState = 'idle';
let mediaData = { playing: false };
let recordingData = { recording: false };
let wasCharging = null;
let showedLowBattery = false;
let btToastTimeout = null;
let battToastTimeout = null;
let btConnectedDevice = null; // persistent BT state
let calendarOffset = 0;
let progressInterval = null;
let fakePct = 0;
let visualizerInterval = null;
let btEqInterval = null;
let forcedPanel = null; // override for expansion
let isDragActive = false;
let isMouseOverNotch = false;
let ignoreMouseLeave = false;
let reenterGuard = false; // brief lockout so collapsing doesn't instantly re-expand
let wasMsgMiniBeforeExpand = false; // Track if we expanded from msg-mini state
let lastMouseX = 0;
let lastMouseY = 0;
let isVoiceSearchActive = false; // Track when voice search is active to suppress recording UI

// Timer state
let isTimerActive = false;
let isTimerPaused = false;
let localTimerTotal = 0;
let localTimerElapsed = 0;
let localTimerInterval = null;
let alarmActive = false; // timer has fired and is ringing until dismissed

const notch = document.getElementById('notch');
const collapsedView = document.getElementById('collapsedView');

// --- External monitor events (mic / recording) ---
window.notchAPI.onExternalTimerUpdate((data) => {
  // The timer notch is driven solely by the notch's own timer picker. Timers
  // running elsewhere (a "timer" Google search, the Focus/Clock app) are ignored
  // outright — they used to take over the notch, and their polling would resync
  // or cancel a timer set here. Mic/recording events below still flow through.
  if (data.type === 'chrome' || data.type === 'focus' || data.type === 'none_timer') {
    return;
  } else if (data.type === 'mic_active') {
    // Don't show recording panel for voice search
    if (isVoiceSearchActive) return;
    
    const was = recordingData.recording;
    const wasPaused = recordingData.state === 'PAUSED';
    
    if (!was || wasPaused) {
      recordingData.recording = true;
      recordingData.state = 'ACTIVE';
      // If we weren't already recording, reset elapsed time
      if (!was) {
        recordingData.elapsed = 0;
      }
      recordingData.startTime = Date.now() - (recordingData.elapsed || 0);
      decideState();
      
      if (!recordingData.interval) {
        recordingData.interval = setInterval(() => {
          if (!recordingData.recording || recordingData.state === 'PAUSED') return;
          const elapsed = Date.now() - recordingData.startTime;
          recordingData.elapsed = elapsed;
          
          const ms = elapsed % 1000;
          const s = Math.floor(elapsed / 1000) % 60;
          const m = Math.floor(elapsed / 60000) % 60;
          
          const mStr = String(m).padStart(2, '0');
          const sStr = String(s).padStart(2, '0');
          const msStr = String(Math.floor(ms / 10)).padStart(2, '0');
          const timeStr = `${mStr}:${sStr}.${msStr}`;
          
          recordingData.timeStr = timeStr;
          document.getElementById('expRecTime').textContent = timeStr;
          document.getElementById('cRecTime').textContent = timeStr;
        }, 50);
      }
    }
    
    const wave = document.getElementById('pillRecWave');
    if (wave) wave.style.opacity = '1';
    const pauseBtn = document.getElementById('recPauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="#fff"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>';
    
  } else if (data.type === 'mic_paused') {
    // Don't process if voice search was active
    if (isVoiceSearchActive) return;
    
    if (!recordingData.recording) {
       // if we caught a paused state but weren't recording before, just initialize it
       recordingData.recording = true;
       recordingData.elapsed = 0;
       recordingData.timeStr = "00:00.00";
    }
    recordingData.state = 'PAUSED';
    if (recordingData.interval) {
      clearInterval(recordingData.interval);
      recordingData.interval = null;
    }
    
    document.getElementById('expRecTime').textContent = recordingData.timeStr;
    document.getElementById('cRecTime').textContent = recordingData.timeStr;
    const wave = document.getElementById('pillRecWave');
    if (wave) wave.style.opacity = '0.3';
    const pauseBtn = document.getElementById('recPauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    
    decideState();
  } else if (data.type === 'mic_inactive') {
    // Don't process if voice search was active
    if (isVoiceSearchActive) return;
    
    if (recordingData.recording) {
      recordingData.recording = false;
      if (recordingData.interval) {
        clearInterval(recordingData.interval);
        recordingData.interval = null;
      }
      decideState();
    }
  }
});

/* ─── Panel map ─── */
const panelMap = {
  idle:            'panelIdle',
  hover:           'panelHoverToggles',
  music:           'panelMusic',
  recording:       'panelRecording',
  timer:           'panelTimer',
  bluetooth:       'panelBluetooth',
  'bt-connected':  'panelIdle',
  'bt-music':      'panelBtMusic',
  unlock:          'panelUnlock',
  charging:        'panelCharging',
  'low-battery':   'panelLowBattery',
  slider:          'panelSlider',
  'file-tray':     'panelIdle',
  video:           'panelVideo',
  camera:          'panelCamera',
  tasks:           'panelTasks',
  'timer-setup':   'panelTimerSetup',
  dnd:             'panelDnd',
  'msg-mini':      'panelMsgMini',
  'msg-expanded':  'panelMsgExpanded',
  'unreads':       'panelUnreads',
  pairing:         'panelPairing',
  startup:         'panelStartup'
};

function hideAllPanels() {
  Object.values(panelMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('shown');
      el.classList.add('leaving');
      el.style.opacity = '0';
      setTimeout(() => {
        if (el.style.opacity === '0') {
          el.style.display = 'none';
        }
      }, 200);
    }
  });
}

function showActivePanel() {
  const activeId = forcedPanel || panelMap[currentState];
  Object.values(panelMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === activeId) {
        if (el.style.display !== 'flex') {
          el.style.display = 'flex';
          // Force a layout read so the entry transition starts from its
          // pre-morph state instead of being collapsed into the same frame.
          void el.offsetHeight;
        }
        el.classList.remove('leaving');
        el.classList.add('shown');
        el.style.opacity = '1';
        
        // Dynamically adjust height for message expansion
        if (activeId === 'panelMsgExpanded') {
          requestAnimationFrame(() => {
            notch.style.height = Math.max(140, el.scrollHeight + 16) + 'px';
          });
        }
      } else {
        el.classList.remove('shown');
        el.classList.add('leaving');
        el.style.opacity = '0';
        setTimeout(() => {
          if (el.style.opacity === '0') {
            el.style.display = 'none';
          }
        }, 200);
      }
    }
  });
  
  if (activeId === 'panelTasks') {
    layoutTasksPanel();
  } else if (activeId !== 'panelMsgExpanded') {
    notch.style.height = '';
  }
  
  // Also handle forcedPanel if it's not in panelMap (like panelDnd)
  if (forcedPanel && !Object.values(panelMap).includes(forcedPanel)) {
    const forcedEl = document.getElementById(forcedPanel);
    if (forcedEl) {
      if (forcedEl.style.display !== 'flex') forcedEl.style.display = 'flex';
      forcedEl.style.opacity = '1';
    }
  }

  // Handle inner content of panelIdle (Dashboard Main vs File Tray)
  const dashMain = document.getElementById('dashMainContent');
  const dashFileTray = document.getElementById('dashFileTrayContent');
  if (dashMain && dashFileTray) {
    if (currentState === 'file-tray') {
      dashMain.style.display = 'none';
      dashFileTray.style.display = 'flex';
    } else {
      dashMain.style.display = 'flex';
      dashFileTray.style.display = 'none';
    }
  }
}

function setState(s) {
  console.log('[App] Setting State:', s);
  currentState = s;
  notch.dataset.state = s;
  if (isExpanded) showActivePanel(); else hideAllPanels();
}

function handleBluetoothUpdate(device) {
  if (device.connected) {
    btConnectedDevice = device;
    
    // Update collapsed bar battery if present
    const battDiv = document.getElementById('cNoteBattery');
    const battPct = document.getElementById('cNoteBatteryPct');
    if (battDiv && battPct) {
        if (device.battery > -1) {
            battPct.textContent = device.battery + '%';
            battDiv.style.display = 'inline-flex';
            battPct.classList.toggle('low', device.battery <= 20);
        } else {
            battDiv.style.display = 'none';
        }
    }

    if (!btToastTimeout) {
        showBluetoothToast(device);
    }
  } else {
    btConnectedDevice = null;
    const battDiv = document.getElementById('cNoteBattery');
    if (battDiv) battDiv.style.display = 'none';
    decideState();
  }
}

// True while a Face ID scan (lock screen or Windows Hello enrollment/passkey)
// is animating. decideState() must not recompute the notch out from under it,
// or background pollers (battery/calendar/recording) will stomp 'unlock' back
// to 'idle' within milliseconds and the animation never becomes visible.
let faceScanActive = false;

function decideState() {
  if (faceScanActive) return; // Protect the Face ID scan animation
  if (forcedPanel === 'panelSlider' || forcedPanel === 'panelDnd') return; // Don't override forced state
  if (forcedPanel === 'panelTimer') return; // "Time's up" hold owns the notch
  if (currentState === 'file-tray' || currentState === 'video' || currentState === 'camera') return; // Don't override active states
  if (currentState === 'tasks' || currentState === 'timer-setup') return; // User is editing tasks / picking a duration
  if (currentState === 'msg-mini' || currentState === 'msg-expanded' || currentState === 'unreads' || currentState === 'startup') return; // Protect message and startup states

  let s = 'idle';
  if (recordingData.recording) s = 'recording';
  else if (isTimerActive) s = 'timer';
  // Only take over the collapsed pill — never hijack an already-expanded panel.
  else if (downloadActive && !isExpanded) s = 'download';
  else if (battToastTimeout) s = 'battery';
  else if (btToastTimeout) s = 'bluetooth';
  else if (btConnectedDevice && (mediaData.playing || mediaData.paused)) s = 'bt-music';
  else if (btConnectedDevice) s = 'bt-connected';
  else if (mediaData.playing || mediaData.paused) s = 'music';
  else if (unreadList.length > 0) s = 'unreads';
  
  setState(s);

  // A running timer keeps its full panel (pause / ✕ / countdown) on screen.
  if (s === 'recording' || s === 'timer') {
    if (!isExpanded) expand();
  }

  // Sub-notch visibility
  const sub = document.getElementById('subNotch');
  if (sub) {
    const shouldShow = (currentState === 'music' || currentState === 'bt-music') && !isExpanded;
    if (shouldShow) sub.classList.add('visible');
    else sub.classList.remove('visible');
  }
}

/* ─── Expand / Collapse ─── */
function expand() {
  if (isExpanded) return;
  isExpanded = true;
  notch.classList.remove('collapsed');
  notch.classList.add('expanded');
  showActivePanel();
  window.notchAPI.setIgnoreMouse(false);
  decideState(); // Refresh sub-notch etc.
}

function collapse() {
  if (!isExpanded) return;
  if (currentState === 'recording' || currentState === 'startup') return; // Force keep expanded
  if (alarmActive) return; // Ringing timer stays open so the ✕ is always reachable
  if (currentState === 'timer' && isTimerActive) return; // Running timer keeps its full panel
  isExpanded = false;
  forcedPanel = null; // Reset pin
  notch.style.height = ''; // Drop any panel-driven height (tasks / expanded message)
  if (currentState === 'file-tray') currentState = 'idle';
  if (currentState === 'msg-mini' || currentState === 'msg-expanded' || currentState === 'unreads') currentState = 'idle';
  hideAllPanels();
  notch.classList.remove('expanded');
  notch.classList.add('collapsed');
  notch.classList.remove('forced-full'); // Remove forced size
  
  // Wait for the collapse transition to complete, then check if mouse is still over notch
  // Use requestAnimationFrame to let the CSS transition finish
  requestAnimationFrame(() => {
    // Check if mouse is over the collapsed notch using last known mouse position
    const elementUnderMouse = document.elementFromPoint(lastMouseX, lastMouseY);
    const mouseOverNotch = elementUnderMouse && notch.contains(elementUnderMouse);
    
    if (!mouseOverNotch) {
      window.notchAPI.setIgnoreMouse(true);
      isMouseOverNotch = false; // Mouse has truly left
    } else {
      // Mouse is still over the collapsed notch - keep receiving events
      // isMouseOverNotch stays true so we can detect when it leaves the collapsed notch
    }
  });
  
  decideState(); // Refresh sub-notch etc.
}

/* ─── Camera notch ─── */
let camStream = null;
let camZoom = 1;
const CAM_ZOOM_MIN = 1, CAM_ZOOM_MAX = 4;

function applyCamZoom() {
  const video = document.getElementById('camVideo');
  if (!video) return;
  // Combine the selfie mirror (scaleX -1) with the pinch zoom factor.
  video.style.transform = 'scaleX(-1) scale(' + camZoom + ')';
}

function openCamera() {
  const panel = document.getElementById('panelCamera');
  const video = document.getElementById('camVideo');
  const errEl = document.getElementById('camError');
  if (!panel || !video) return;
  panel.classList.remove('cam-failed', 'cam-ready');
  camZoom = 1;
  applyCamZoom();

  forcedPanel = 'panelCamera';
  currentState = 'camera';
  notch.setAttribute('data-state', 'camera');
  if (!isExpanded) expand(); else showActivePanel();

  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then(stream => {
      camStream = stream;
      video.srcObject = stream;
      // Only reveal the feed once frames are actually flowing — seamless load.
      const reveal = () => panel.classList.add('cam-ready');
      video.addEventListener('playing', reveal, { once: true });
      // Fallback in case 'playing' doesn't fire on some drivers.
      video.addEventListener('loadeddata', reveal, { once: true });
    })
    .catch(err => {
      console.error('[Camera] getUserMedia failed:', err);
      if (errEl) errEl.textContent = 'Camera unavailable' + (err && err.name ? ' (' + err.name + ')' : '');
      panel.classList.add('cam-failed');
    });
}

function closeCamera() {
  const video = document.getElementById('camVideo');
  const panel = document.getElementById('panelCamera');
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  if (video) video.srcObject = null;
  if (panel) panel.classList.remove('cam-ready', 'cam-failed');
  forcedPanel = null;
  if (currentState === 'camera') currentState = 'idle';
  notch.setAttribute('data-state', 'idle');
  collapse();
  decideState();
}

let isMicRecording = false;

/* ─── Interactions ─── */
function setupInteractions() {
// ─── Hover detection (robust, mousemove-driven) ───
  // The window is created click-through (setIgnoreMouseEvents(true, {forward:true}))
  // so the page still receives mousemove.
// Schedules an expand on hover. Idempotent — safe to call on every mousemove
// while the cursor sits over the collapsed notch, so expansion never depends
// on catching a single "entered" edge event.
function scheduleExpand() {
  if (isExpanded || reenterGuard || hoverTimeout) return;
  hoverTimeout = setTimeout(() => { hoverTimeout = null; expand(); }, 30);
}

function handleNotchEnter() {
  // Brief lockout after a collapse so the notch doesn't instantly re-expand
  // while the pointer is still sitting over the (now smaller) collapsed pill.
  if (reenterGuard) return;
  isMouseOverNotch = true;
  window.notchAPI.setIgnoreMouse(false);

  if (window.msgCollapseTimeout) {
    clearTimeout(window.msgCollapseTimeout);
    window.msgCollapseTimeout = null;
  }
  if (currentState === 'msg-mini') {
    wasMsgMiniBeforeExpand = true;
    currentState = 'msg-expanded';
    notch.setAttribute('data-state', 'msg-expanded');
    showActivePanel();
    setTimeout(() => {
      const replyInput = document.getElementById('msgReplyInput');
      if (replyInput) replyInput.focus();
    }, 300);
    return;
  }

  scheduleExpand();
}

function handleNotchLeave() {
  const searchInput = document.getElementById('dashSearchInput');
  if (searchInput && document.activeElement === searchInput) return;
  // Keep the notch open while the user is actively typing a reply, even if
  // the mouse drifts off the notch.
  const replyInput = document.getElementById('msgReplyInput');
  if (replyInput && document.activeElement === replyInput) return;
  if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
  if (currentState === 'file-tray' && isDragActive) return;
  if (currentState === 'recording') return;
  if (currentState === 'camera') return; // Camera stays open until explicitly closed
  if (alarmActive) return; // Ringing timer stays open until dismissed
  // Tasks / timer picker close via their own buttons — a stray mouse drift while
  // typing a task or spinning a wheel must not throw the panel away.
  if (currentState === 'tasks' || currentState === 'timer-setup') return;
  if (isDraggingSlider) return; // Don't collapse while dragging the vol/bright slider
  if (ignoreMouseLeave) return;

  if (isExpanded) {
    // If we expanded from msg-mini state, return to msg-mini instead of idle
    if (currentState === 'msg-expanded' && wasMsgMiniBeforeExpand) {
      currentState = 'msg-mini';
      wasMsgMiniBeforeExpand = false;
    }
    if (currentState === 'unreads') {
      currentState = 'idle';
    }
    collapse();
    if (currentState === 'idle') {
      reenterGuard = true;
      setTimeout(() => { reenterGuard = false; }, 80);
    }
  } else {
    // Determine if mouse is over the collapsed notch
    const elementUnderMouse = document.elementFromPoint(lastMouseX, lastMouseY);
    const mouseOverNotch = elementUnderMouse && notch.contains(elementUnderMouse);
    isMouseOverNotch = mouseOverNotch;  // Set based on actual position
    
    // If mouse is not over collapsed notch, set ignore mouse
    if (!mouseOverNotch) {
      window.notchAPI.setIgnoreMouse(true);
    }
  }
}

function isMouseOverNotchBounds(e, forLeave) {
  const r = notch.getBoundingClientRect();
  // Use smaller margin for leave detection (0) vs enter (4px) for snappier collapse
  const margin = forLeave ? 0 : 4;
  return e.clientX >= r.left - margin && e.clientX <= r.right + margin &&
         e.clientY >= r.top - margin && e.clientY <= r.bottom + margin;
}

  // Fallback native listener - trigger collapse when mouse leaves notch element entirely
  notch.addEventListener('mouseleave', (e) => {
    // When expanded, collapse immediately on mouseleave from notch
    if (isMouseOverNotch && isExpanded) {
      handleNotchLeave();
    }
  });

  // Also handle mouseout on notch for immediate collapse when cursor leaves notch bounds
  notch.addEventListener('mouseout', (e) => {
    // Only trigger if leaving notch entirely (not moving to a child)
    const related = e.relatedTarget;
    if (isMouseOverNotch && isExpanded && (!related || !notch.contains(related))) {
      handleNotchLeave();
    }
  });

  // Additional mouseleave on document for when cursor leaves window entirely
  document.addEventListener('mouseleave', (e) => {
    if (isMouseOverNotch && (!e.relatedTarget || e.relatedTarget === null)) {
      handleNotchLeave();
    }
  });

  // NOTE: We deliberately do NOT attach mouseleave handlers to individual
  // .panel elements. Swapping panels sets the outgoing one to display:none,
  // which fires a spurious mouseleave even though the cursor is still inside
  // the notch — that was collapsing the reply UI the instant it opened (the
  // "flicker"). The notch-level mouseleave above already handles genuine
  // exits, so per-panel handlers are redundant and harmful.

  // Quick share icon hover out effect (same as notch)
const quickShareIcon = document.getElementById('quickShareIcon');
   if (quickShareIcon) {
     quickShareIcon.addEventListener('mouseleave', (e) => {
       if (isMouseOverNotch && isExpanded) {
         handleNotchLeave();
       }
     });
     quickShareIcon.addEventListener('mouseover', (e) => {
       if (mediaData.playing && !isExpanded) {
         expand();
       }
     });
     quickShareIcon.addEventListener('mouseout', (e) => {
       const related = e.relatedTarget;
       if (isMouseOverNotch && isExpanded && (!related || !quickShareIcon.contains(related))) {
         handleNotchLeave();
       }
     });
   }

  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    const inBounds = isMouseOverNotchBounds(e, isExpanded);
    if (inBounds && !isMouseOverNotch) handleNotchEnter();
    else if (!inBounds && isMouseOverNotch) handleNotchLeave();
    // Safety net: hovering the collapsed notch must always expand it, even if
    // isMouseOverNotch is still set from a collapse that happened under a
    // resting cursor (otherwise you'd have to move away and back, or click).
    else if (inBounds && !isExpanded) {
      window.notchAPI.setIgnoreMouse(false);
      scheduleExpand();
    }
  });
  collapsedView.addEventListener('click', e => { 
    e.stopPropagation(); 
    if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; } 
    expand(); 
  });
  
  const unreadBadge = document.getElementById('cUnreadBadge');
  if (unreadBadge) {
    unreadBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (unreadList.length > 0) {
        currentState = 'unreads';
        notch.setAttribute('data-state', 'unreads');
        if (!isExpanded) expand();
        else showActivePanel();
      }
    });
  }

  const dashHomeBtn = document.getElementById('dashHomeBtn');
  if (dashHomeBtn) {
    dashHomeBtn.addEventListener('click', e => {
      e.stopPropagation();
      console.log('[App] dashHomeBtn clicked - returning to home view.');
      forcedPanel = null;
      currentState = 'idle';
      notch.setAttribute('data-state', 'idle');
      decideState();
      showActivePanel();
    });
  }

  const dashOpenTrayBtn = document.getElementById('dashOpenTrayBtn');
  if (dashOpenTrayBtn) {
    dashOpenTrayBtn.addEventListener('click', e => {
      e.stopPropagation();
      console.log('[App] dashOpenTrayBtn clicked — opening file tray. Current state:', currentState, 'isExpanded:', isExpanded);
      if (currentState === 'file-tray' && isExpanded) {
        collapse();
        return;
      }
      
      // Set cooldown/grace period so shrinking doesn't trigger immediate collapse
      ignoreMouseLeave = true;
      isMouseOverNotch = false; // assume mouse will be out, mouseenter will correct this if they stay in
      setTimeout(() => {
        ignoreMouseLeave = false;
        if (!isMouseOverNotch && currentState === 'file-tray' && isExpanded) {
          collapse();
        }
      }, 1500);

      currentState = 'file-tray';
      notch.setAttribute('data-state', 'file-tray');
      if (!isExpanded) {
        expand();
      } else {
        showActivePanel();
      }
      renderFileTray();
    });
  }

  const dashOpenCamBtn = document.getElementById('dashOpenCamBtn');
  if (dashOpenCamBtn) {
    dashOpenCamBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (currentState === 'camera' && isExpanded) { closeCamera(); return; }
      openCamera();
    });
  }

  const dashOpenTasksBtn = document.getElementById('dashOpenTasksBtn');
  if (dashOpenTasksBtn) {
    dashOpenTasksBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (currentState === 'tasks' && isExpanded) { closeTasksPanel(); return; }
      openTasksPanel();
    });
  }

  const dashOpenTimerBtn = document.getElementById('dashOpenTimerBtn');
  if (dashOpenTimerBtn) {
    dashOpenTimerBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (currentState === 'timer-setup' && isExpanded) { closeTimerPicker(); return; }
      openTimerPicker();
    });
  }

  const camCloseBtn = document.getElementById('camCloseBtn');
  if (camCloseBtn) {
    camCloseBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeCamera();
    });
  }

  // Two-finger pinch zoom on the camera. Trackpad pinch arrives as a wheel
  // event with ctrlKey set (Chromium convention); a plain wheel also zooms.
  const camPanel = document.getElementById('panelCamera');
  if (camPanel) {
    camPanel.addEventListener('wheel', e => {
      if (currentState !== 'camera') return;
      e.preventDefault();
      // ctrlKey (pinch) gestures are finer-grained; scale the step accordingly.
      const step = e.ctrlKey ? e.deltaY * 0.01 : e.deltaY * 0.003;
      camZoom = Math.min(CAM_ZOOM_MAX, Math.max(CAM_ZOOM_MIN, camZoom - step));
      applyCamZoom();
    }, { passive: false });
  }

  const sub = document.getElementById('subNotch');
  if (sub) {
    sub.addEventListener('mouseenter', () => {
      window.notchAPI.setIgnoreMouse(false);
    });
    sub.addEventListener('mouseleave', () => {
      if (!isExpanded) window.notchAPI.setIgnoreMouse(true);
    });
    sub.addEventListener('click', e => {
      e.stopPropagation();
      forcedPanel = 'panelIdle';
      notch.classList.add('forced-full'); // Force ultra-wide layout
      expand();
    });
  }

  const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let isLocalPaused = false;
  function handleMediaAction(action, e) {
    if (e) e.stopPropagation();
    
    let controlledIframe = false;
    if (typeof mediaData !== 'undefined' && mediaData && mediaData.source === 'YouTube') {
      const iframes = ['mainYtIframe', 'dashYtIframe', 'musicYtIframe'];
      for (let id of iframes) {
        const iframe = document.getElementById(id);
        if (iframe && iframe.src && iframe.style.display !== 'none' && iframe.contentWindow) {
          if (action === 'playpause') {
            isLocalPaused = !isLocalPaused;
            const func = isLocalPaused ? 'pauseVideo' : 'playVideo';
            iframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: func}), '*');
          } else if (action === 'next') {
            iframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'nextVideo'}), '*');
          } else if (action === 'prev') {
            iframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'previousVideo'}), '*');
          }
          controlledIframe = true;
          break; // only control the visible one
        }
      }
    }
    
    if (!controlledIframe) {
      // Use system media keys for background Chrome tabs or Spotify
      window.notchAPI.controlMedia(action);
      if (action === 'playpause') isLocalPaused = !isLocalPaused;
    }
    
    if (action === 'playpause') {
      if (typeof mediaData !== 'undefined' && mediaData) mediaData.paused = isLocalPaused;
      const playSvg = document.querySelector('#playBtn svg');
      const dashPlayBtnSvg = document.querySelector('#dashPlayBtn svg');
      const btmuPlaySvg = document.querySelector('#btmuPlayBtn svg');
      if (isLocalPaused) {
        if(typeof stopVisualizer === 'function') stopVisualizer();
        if (playSvg) playSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
        if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
        if (btmuPlaySvg) btmuPlaySvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      } else {
        if(typeof startVisualizer === 'function') startVisualizer();
        if (playSvg) playSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        if (btmuPlaySvg) btmuPlaySvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      }
    }
  }

  // Music controls (expanded panel)
  document.getElementById('prevBtn').addEventListener('click', e => handleMediaAction('prev', e));
  document.getElementById('playBtn').addEventListener('click', e => handleMediaAction('playpause', e));
  document.getElementById('nextBtn').addEventListener('click', e => handleMediaAction('next', e));
  
  const queueBtn = document.getElementById('queueBtn');
  if (queueBtn) {
    queueBtn.addEventListener('click', e => {
      e.stopPropagation();
      forcedPanel = 'panelIdle';
      notch.classList.add('forced-full');
      showActivePanel();
    });
  }



  // YouTube Play Buttons Click
  const dashYtPlayBtn = document.getElementById('dashYtPlayBtn');
  if (dashYtPlayBtn) {
    dashYtPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaData && mediaData.videoId) {
        const iframe = document.getElementById('dashYtIframe');
        const overlay = document.getElementById('ytPlayOverlay');
        if (iframe && overlay) {
          overlay.style.display = 'none';
          iframe.style.display = 'block';
          iframe.src = `https://www.youtube-nocookie.com/embed/${mediaData.videoId}?autoplay=1&enablejsapi=1`;
        }
      }
    });
  }

  const dashYtPipBtn = document.getElementById('dashYtPipBtn');
  if (dashYtPipBtn) {
    dashYtPipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaData && mediaData.videoId) {
        // Stop in-cover-art playback if active
        const dashIframe = document.getElementById('dashYtIframe');
        if (dashIframe) { dashIframe.style.display = 'none'; dashIframe.src = ''; }
        const musicIframe = document.getElementById('musicYtIframe');
        if (musicIframe) { musicIframe.style.display = 'none'; musicIframe.src = ''; }
        
        // Open PiP Notch Player
        forcedPanel = null;
        notch.classList.remove('forced-full');
        currentState = 'video';
        notch.setAttribute('data-state', 'video');
        showActivePanel();
        const mainYtIframe = document.getElementById('mainYtIframe');
        if (mainYtIframe) {
          mainYtIframe.src = `https://www.youtube-nocookie.com/embed/${mediaData.videoId}?autoplay=1&enablejsapi=1`;
        }
      }
    });
  }

  const musicYtPlayBtn = document.getElementById('musicYtPlayBtn');
  if (musicYtPlayBtn) {
    musicYtPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaData && mediaData.videoId) {
        const iframe = document.getElementById('musicYtIframe');
        const overlay = document.getElementById('ytMusicPlayOverlay');
        if (iframe && overlay) {
          overlay.style.display = 'none';
          iframe.style.display = 'block';
          iframe.src = `https://www.youtube-nocookie.com/embed/${mediaData.videoId}?autoplay=1&enablejsapi=1`;
        }
      }
    });
  }

  const musicYtPipBtn = document.getElementById('musicYtPipBtn');
  if (musicYtPipBtn) {
    musicYtPipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaData && mediaData.videoId) {
        // Stop in-cover-art playback if active
        const dashIframe = document.getElementById('dashYtIframe');
        if (dashIframe) { dashIframe.style.display = 'none'; dashIframe.src = ''; }
        const musicIframe = document.getElementById('musicYtIframe');
        if (musicIframe) { musicIframe.style.display = 'none'; musicIframe.src = ''; }
        
        // Open PiP Notch Player
        currentState = 'video';
        notch.setAttribute('data-state', 'video');
        showActivePanel();
        const mainYtIframe = document.getElementById('mainYtIframe');
        if (mainYtIframe) {
          mainYtIframe.src = `https://www.youtube-nocookie.com/embed/${mediaData.videoId}?autoplay=1&enablejsapi=1`;
        }
      }
    });
  }

  const closeVideoBtn = document.getElementById('closeVideoBtn');
  if (closeVideoBtn) {
    closeVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mainYtIframe = document.getElementById('mainYtIframe');
      if (mainYtIframe) mainYtIframe.src = '';
      
      // Return to music panel (or idle depending on if music is playing)
      currentState = mediaData.playing ? 'music' : 'idle';
      notch.setAttribute('data-state', currentState);
      showActivePanel();
    });
  }

  // Star buttons logic
  const toggleStar = (btn) => {
    if(!btn) return;
    const svg = btn.querySelector('svg');
    if (!svg) return;
    const isFilled = svg.getAttribute('fill') === 'currentColor';
    if (isFilled) {
      svg.setAttribute('fill', 'none');
      btn.style.color = 'rgba(255,255,255,0.5)';
    } else {
      svg.setAttribute('fill', 'currentColor');
      btn.style.color = '#22c55e'; // Green highlight
    }
  };
  
  // Helper to update star/PiP button icon based on videoId availability
  function updateStarButtons() {
    const hasVideo = mediaData && mediaData.videoId;
    const starSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    const pipSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><rect x="12" y="12" width="8" height="8" rx="2" ry="2" fill="currentColor"></rect></svg>';
    
    const pStar = document.getElementById('shuffleBtn');
    const dStar = document.getElementById('dashStarBtn');
    
    if (pStar) {
      const svg = pStar.querySelector('svg');
      if (svg) {
        if (hasVideo) {
          svg.outerHTML = starSvg;
          pStar.title = 'Toggle favorite';
        } else {
          svg.outerHTML = pipSvg;
          pStar.title = 'Play in Notch PiP';
        }
      }
    }
    if (dStar) {
      const svg = dStar.querySelector('svg');
      if (svg) {
        if (hasVideo) {
          svg.outerHTML = starSvg;
          dStar.title = 'Toggle favorite';
        } else {
          svg.outerHTML = pipSvg;
          dStar.title = 'Play in Notch PiP';
        }
      }
    }
  }

  const pStar = document.getElementById('shuffleBtn'); // panelMusic star
  if(pStar) pStar.addEventListener('click', (e) => {
    e.stopPropagation();
    const hasVideo = mediaData && mediaData.videoId;
    if (hasVideo) {
      // Toggle favorite star state
      toggleStar(pStar);
    } else {
      // Stop in-cover-art playback if active
      const dashIframe = document.getElementById('dashYtIframe');
      if (dashIframe) { dashIframe.style.display = 'none'; dashIframe.src = ''; }
      const musicIframe = document.getElementById('musicYtIframe');
      if (musicIframe) { musicIframe.style.display = 'none'; musicIframe.src = ''; }
      
      // Open PiP Notch Player
      currentState = 'video';
      notch.setAttribute('data-state', 'video');
      showActivePanel();
      const mainYtIframe = document.getElementById('mainYtIframe');
      if (mainYtIframe) {
        mainYtIframe.src = `https://www.youtube-nocookie.com/embed/${mediaData.videoId}?autoplay=1&enablejsapi=1`;
      }
    }
  });

  const dStar = document.getElementById('dashStarBtn'); // dashMusic star
  if(dStar) dStar.addEventListener('click', (e) => {
    e.stopPropagation();
    const hasVideo = mediaData && mediaData.videoId;
    if (hasVideo) {
      // Toggle favorite star state
      toggleStar(dStar);
    } else {
      // Stop in-cover-art playback if active
      const dashIframe = document.getElementById('dashYtIframe');
      if (dashIframe) { dashIframe.style.display = 'none'; dashIframe.src = ''; }
      const musicIframe = document.getElementById('musicYtIframe');
      if (musicIframe) { musicIframe.style.display = 'none'; musicIframe.src = ''; }
      
      // Open PiP Notch Player
      currentState = 'video';
      notch.setAttribute('data-state', 'video');
      showActivePanel();
      const mainYtIframe = document.getElementById('mainYtIframe');
      if (mainYtIframe) {
        mainYtIframe.src = `https://www.youtube-nocookie.com/embed/${mediaData.videoId}?autoplay=1&enablejsapi=1`;
      }
    }
  });

  // Call updateStarButtons initially and whenever mediaData changes
  // We'll call it from updateMusicUI

  setupScrubberDrag();

  // Combined BT-Music controls
  document.getElementById('btmuPrevBtn').addEventListener('click', e => handleMediaAction('prev', e));
  document.getElementById('btmuPlayBtn').addEventListener('click', e => handleMediaAction('playpause', e));
  document.getElementById('btmuNextBtn').addEventListener('click', e => handleMediaAction('next', e));

  // Dashboard music controls
  const dPrev = document.getElementById('dashPrevBtn');
  const dPlay = document.getElementById('dashPlayBtn');
  const dNext = document.getElementById('dashNextBtn');
  if(dPrev) dPrev.addEventListener('click', e => handleMediaAction('prev', e));
  if(dPlay) dPlay.addEventListener('click', e => handleMediaAction('playpause', e));
  if(dNext) dNext.addEventListener('click', e => handleMediaAction('next', e));
  
  const dashChevronBtn = document.getElementById('dashChevronBtn');
  if (dashChevronBtn) {
    dashChevronBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (currentState === 'music') {
        // When music is playing, always open the music panel in expanded notch
        // (replaces idle panel with notifications/calendar)
        forcedPanel = null;
        notch.classList.remove('forced-full');
        showActivePanel();
      } else {
        collapse();
      }
    });
  }


  // Calendar nav
  const calPrev = document.getElementById('calPrevBtn');
  const calNext = document.getElementById('calNextBtn');
  if(calPrev) calPrev.addEventListener('click', e => { e.stopPropagation(); calendarOffset -= 1; updateClock(); });
  if(calNext) calNext.addEventListener('click', e => { e.stopPropagation(); calendarOffset += 1; updateClock(); });

  // Calendar click → open
  const calStrip = document.getElementById('dashDays');
  if (calStrip) {
    calStrip.style.cursor = 'pointer';
    calStrip.addEventListener('click', e => {
      e.stopPropagation();
      const d = new Date(); d.setDate(d.getDate() + calendarOffset);
      window.notchAPI.openCalendar(`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`);
    });
  }

  // Hover toggles (Mic/Cam)
  const micBtn = document.getElementById('htMicToggle');
  const camBtn = document.getElementById('htCamToggle');
  if (micBtn) {
    micBtn.addEventListener('click', e => {
      e.stopPropagation();
      const icon = micBtn.querySelector('.ht-icon');
      if (icon.classList.contains('mic-on')) {
        icon.classList.remove('mic-on');
        icon.classList.add('mic-off');
        icon.innerHTML = '<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line><line x1="1" y1="1" x2="23" y2="23"></line>';
      } else {
        icon.classList.remove('mic-off');
        icon.classList.add('mic-on');
        icon.innerHTML = '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>';
      }
    });
  }
  if (camBtn) {
    camBtn.addEventListener('click', e => {
      e.stopPropagation();
      const icon = camBtn.querySelector('.ht-icon');
      if (icon.classList.contains('cam-on')) {
        icon.classList.remove('cam-on');
        icon.classList.add('cam-off');
        icon.innerHTML = '<line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>';
      } else {
        icon.classList.remove('cam-off');
        icon.classList.add('cam-on');
        icon.innerHTML = '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>';
      }
    });
  }

  const searchMicBtn = document.getElementById('searchMicBtn');
  const dashSearchInput = document.getElementById('dashSearchInput');

  let activeMicStop = null;
  let processRecording = null;

  if (searchMicBtn) {
    const originalMicSvg = searchMicBtn.innerHTML;
    searchMicBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        if (isMicRecording) {
          isMicRecording = false;
          isVoiceSearchActive = false;
          searchMicBtn.innerHTML = originalMicSvg;
          dashSearchInput.placeholder = 'Search Google...';
          if (activeMicStop) activeMicStop();
          if (processRecording) processRecording();
          return;
        }
        
        try {
          isMicRecording = true;
          isVoiceSearchActive = true;
          searchMicBtn.innerHTML = '<div style="width:10px;height:10px;background:var(--red);border-radius:50%;animation:pulse 1s infinite"></div>';
          dashSearchInput.placeholder = 'Recording...';
          
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          
          await audioCtx.audioWorklet.addModule('audio-processor.js');
          
          const source = audioCtx.createMediaStreamSource(stream);
          const workletNode = new AudioWorkletNode(audioCtx, 'audio-processor');
          
          let pcmChunks = [];
          workletNode.port.onmessage = (e) => {
              if (isMicRecording) {
                  pcmChunks.push(new Int16Array(e.data));
              }
          };
          
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = 0;
          source.connect(workletNode);
          workletNode.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          
          let isDone = false;
          activeMicStop = () => {
            if (isDone) return;
            isDone = true;
            workletNode.disconnect();
            source.disconnect();
            stream.getTracks().forEach(t => t.stop());
            if (audioCtx.state !== 'closed') audioCtx.close();
          };
          
          processRecording = async () => {
            const totalLen = pcmChunks.reduce((acc, val) => acc + val.length, 0);
            if (totalLen === 0) {
              dashSearchInput.placeholder = 'Search Google...';
              return;
            }
            
            const pcmData = new Int16Array(totalLen);
            let offset = 0;
            for (let chunk of pcmChunks) {
                pcmData.set(chunk, offset);
                offset += chunk.length;
            }
            
            try {
              const transcribedText = await window.notchAPI.transcribeAudio(pcmData.buffer);
              console.log('[App] Speech Recognition returned:', transcribedText);
              
              if (transcribedText) {
                dashSearchInput.value = transcribedText;
                executeSearch();
              } else {
                dashSearchInput.placeholder = 'Did not catch that...';
                setTimeout(() => {
                  if (!isMicRecording) dashSearchInput.placeholder = 'Search Google...';
                }, 2000);
              }
            } catch (err) {
              dashSearchInput.placeholder = 'Mic error!';
              setTimeout(() => {
                if (!isMicRecording) dashSearchInput.placeholder = 'Search Google...';
              }, 2000);
            } finally {
              isVoiceSearchActive = false;
            }
          };
          
        } catch (err) {
          console.error('Speech recognition error:', err);
          dashSearchInput.placeholder = 'Mic error!';
          isMicRecording = false;
          isVoiceSearchActive = false;
          searchMicBtn.innerHTML = originalMicSvg;
          setTimeout(() => dashSearchInput.placeholder = 'Search Google...', 2000);
        }
    });
  }
  
  // Dashboard calendar view horizontal swipe navigation
  const dashCal = document.querySelector('.dash-cal');

  if (dashCal) {
    const strip = document.getElementById('dashDays');
    // Wheel/trackpad scrolls the day strip horizontally.
    dashCal.addEventListener('wheel', e => {
      e.stopPropagation();
      if (!strip) return;
      e.preventDefault();
      // Use whichever axis the user is scrolling on
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      strip.scrollLeft += delta;
    }, { passive: false });

    // Click-and-drag to scroll the carousel left/right (grab & swipe).
    if (strip) {
      let dragging = false, startX = 0, lastX = 0, moved = false;
      strip.addEventListener('pointerdown', e => {
        dragging = true; moved = false;
        startX = lastX = e.clientX;
        strip.classList.add('dragging');
        try { strip.setPointerCapture(e.pointerId); } catch (_) {}
      });
      strip.addEventListener('pointermove', e => {
        if (!dragging) return;
        // Incremental delta — stays consistent even if the carousel prepends/
        // appends days mid-drag (which shifts scrollLeft to compensate).
        if (Math.abs(e.clientX - startX) > 3) moved = true;
        strip.scrollLeft -= (e.clientX - lastX);
        lastX = e.clientX;
      });
      const endDrag = e => {
        if (!dragging) return;
        dragging = false;
        strip.classList.remove('dragging');
        try { strip.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      strip.addEventListener('pointerup', endDrag);
      strip.addEventListener('pointercancel', endDrag);
      // Swallow the click that follows a drag so it doesn't open the calendar app.
      strip.addEventListener('click', e => {
        if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
      }, true);
    }
  }
}

/* ─── Clock / Calendar ─── */
function updateClock() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('cTime').textContent = `${h % 12 || 12}:${m}`;
  document.getElementById('cPeriod').textContent = h >= 12 ? 'Pm' : 'Am';

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // Month label is driven by the calendar carousel (updateCalMonthLabel), not here.

  const cDateEl = document.getElementById('cDate');
  const dateStr = `${shortDays[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  if (cDateEl) cDateEl.textContent = dateStr;

  const bigTime = document.getElementById('bigTime');
  const bigDate = document.getElementById('bigDate');
  if (bigTime) bigTime.textContent = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
  if (bigDate) bigDate.textContent = dateStr;

  renderCalStrip();
}

/* ─── Calendar: infinite (circular) day carousel ─── */
const CAL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAL_SHORT_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let lastStripKey = '';
let calFirst = 0, calLast = 0;   // offset range (days from today) currently rendered
let calScrollBound = false;

// One day cell. `offset` is days from today; offset 0 is today (highlighted blue).
function dayCellHTML(offset) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(today); d.setDate(today.getDate() + offset);
  const isToday = offset === 0;
  const full = CAL_SHORT_DAYS[d.getDay()];
  const name = isToday ? full.toUpperCase() : full.charAt(0);
  const num = d.getDate().toString().padStart(2, '0');
  return `<div class="day${isToday ? ' active' : ''}" data-offset="${offset}" data-month="${d.getMonth()}"><span>${name}</span><span>${num}</span></div>`;
}

// Mutate the FRONT of the strip while keeping the visual scroll position stable
// (adding/removing at the front shifts everything, so compensate scrollLeft).
function calFrontMutate(strip, fn) {
  const prev = strip.style.scrollBehavior;
  strip.style.scrollBehavior = 'auto';
  const before = strip.scrollWidth;
  fn();
  const after = strip.scrollWidth;
  strip.scrollLeft += (after - before);
  strip.style.scrollBehavior = prev;
}

// Update the big month label ("Aug") to whichever day sits at the strip's centre.
function updateCalMonthLabel() {
  const strip = document.getElementById('dashDays');
  const monthEl = document.getElementById('dashMonth');
  if (!strip || !monthEl || !strip.children.length) return;
  const box = strip.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  let best = null, bestDist = Infinity;
  for (const c of strip.children) {
    const b = c.getBoundingClientRect();
    const dist = Math.abs((b.left + b.width / 2) - cx);
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  if (best && best.dataset.month != null) {
    monthEl.textContent = CAL_MONTHS[parseInt(best.dataset.month, 10)];
  }
}

// Carousel depth: fade + shrink each day cell by its distance from the strip's
// centre, so today sits bright in the middle and days trail off to both sides.
function applyCalFade() {
  const strip = document.getElementById('dashDays');
  if (!strip || !strip.children.length) return;
  const box = strip.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const half = (box.width / 2) || 1;
  for (const c of strip.children) {
    // Today always stays full-strength so its bold blue reads clearly.
    if (c.classList.contains('active')) { c.style.opacity = '1'; c.style.transform = 'scale(1)'; continue; }
    const b = c.getBoundingClientRect();
    const d = Math.min(1, Math.abs((b.left + b.width / 2) - cx) / half);
    c.style.opacity = (1 - d * d * 0.85).toFixed(3);   // strong fade toward edges
    c.style.transform = `scale(${(1 - d * 0.3).toFixed(3)})`; // shrink toward edges
  }
}

// Grow the strip near either edge so it never runs out (circular feel), and trim
// the far side so the DOM stays bounded.
function extendCalIfNeeded() {
  const strip = document.getElementById('dashDays');
  if (!strip) return;
  const BATCH = 14, THRESH = 260, MAX = 100;

  if (strip.scrollLeft < THRESH) {
    let h = '';
    for (let o = calFirst - 1; o >= calFirst - BATCH; o--) h = dayCellHTML(o) + h;
    calFrontMutate(strip, () => strip.insertAdjacentHTML('afterbegin', h));
    calFirst -= BATCH;
    while (calLast - calFirst > MAX && strip.lastElementChild) { // trim far (right) end
      strip.removeChild(strip.lastElementChild); calLast--;
    }
  }

  if (strip.scrollLeft > strip.scrollWidth - strip.clientWidth - THRESH) {
    let h = '';
    for (let o = calLast + 1; o <= calLast + BATCH; o++) h += dayCellHTML(o);
    strip.insertAdjacentHTML('beforeend', h);
    calLast += BATCH;
    calFrontMutate(strip, () => { // trim far (left) end, compensating scroll
      while (calLast - calFirst > MAX && strip.firstElementChild) {
        strip.removeChild(strip.firstElementChild); calFirst++;
      }
    });
  }
}

// Build the carousel once per day (rebuilds at midnight so "today" moves).
function renderCalStrip() {
  const strip = document.getElementById('dashDays');
  if (!strip) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const key = today.toDateString();
  if (key === lastStripKey) return; // already built for today — keep scroll position
  lastStripKey = key;

  calFirst = -30; calLast = 30;
  let html = '';
  for (let o = calFirst; o <= calLast; o++) html += dayCellHTML(o);
  strip.innerHTML = html;

  calCentered = false;

  if (!calScrollBound) {
    calScrollBound = true;
    let raf = null;
    strip.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        extendCalIfNeeded();
        updateCalMonthLabel();
        applyCalFade();
      });
    });
    // The dashboard is often display:none when the strip is first built, so the
    // initial centring measures zero and fails — re-centre today once the strip
    // actually gets laid out (and whenever it becomes visible again).
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      new ResizeObserver(() => {
        const w = strip.clientWidth;
        if (w > 0 && (lastW === 0 || !calCentered)) centerCalToday();
        lastW = w;
      }).observe(strip);
    }
  }

  // Centre today after layout settles (works when already visible).
  requestAnimationFrame(centerCalToday);

  fetchCalendar();
}

// Scroll the strip so today sits dead-centre. No-op until the strip has a real
// width (i.e. the dashboard is actually on screen).
let calCentered = false;
function centerCalToday() {
  const strip = document.getElementById('dashDays');
  if (!strip || !strip.clientWidth || !strip.children.length) return;
  const el = strip.querySelector('.active');
  if (el) {
    const prev = strip.style.scrollBehavior;
    strip.style.scrollBehavior = 'auto';
    const sb = strip.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    strip.scrollLeft += (eb.left + eb.width / 2) - (sb.left + sb.width / 2);
    strip.style.scrollBehavior = prev;
    calCentered = true;
  }
  updateCalMonthLabel();
  applyCalFade();
}

/* ─── Media ─── */
function handleMediaUpdate(data) {
  // Don't interrupt startup animation
  if (currentState === 'startup') return;

  mediaData = data;
  updateMusicUI();
  decideState();
}

/*  Timer Logic  */
function startTimer(seconds) {
  isTimerActive = true;
  isTimerPaused = false;
  localTimerTotal = seconds;
  localTimerElapsed = 0;
  updateTimerUI();
  decideState();
  clearInterval(localTimerInterval);
  localTimerInterval = setInterval(() => {
    if (!isTimerPaused) {
      localTimerElapsed++;
      if (localTimerElapsed >= localTimerTotal) {
        isTimerActive = false;
        clearInterval(localTimerInterval);
        onTimerFinished(); // holds the panel open and runs decideState itself
      } else {
        updateTimerUI();
      }
    }
  }, 1000);
  decideState();
}

function formatTimerClock(totalSeconds) {
  const rem = Math.max(0, totalSeconds);
  const h = Math.floor(rem / 3600);
  const m = Math.floor(rem / 60) % 60;
  const s = rem % 60;
  const ss = s.toString().padStart(2, '0');
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function updateTimerUI() {
  const txtStr = formatTimerClock(localTimerTotal - localTimerElapsed);
  const txt = document.getElementById('timerText');
  if (txt) txt.textContent = txtStr;

  const cTxt = document.getElementById('cTimerTime');
  if (cTxt) cTxt.textContent = txtStr;

  const icon = document.getElementById('timerPauseIcon');
  if (icon) {
    if (isTimerPaused) {
      icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    } else {
      icon.innerHTML = '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>';
    }
  }
}

window.startTimer = startTimer;

/*  Tasks  */
let tasks = [];
try { tasks = JSON.parse(localStorage.getItem('notchTasks') || '[]') || []; } catch (e) { tasks = []; }

function saveTasks() {
  try { localStorage.setItem('notchTasks', JSON.stringify(tasks)); } catch (e) {}
}

function renderTasks() {
  const list = document.getElementById('tasksList');
  const panel = document.getElementById('panelTasks');
  const count = document.getElementById('tasksCount');
  if (!list || !panel) return;

  list.innerHTML = '';
  tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'task-row' + (task.done ? ' done' : '');

    const check = document.createElement('div');
    check.className = 'task-check';
    check.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    check.addEventListener('click', e => {
      e.stopPropagation();
      task.done = !task.done;
      saveTasks();
      renderTasks();
    });

    const text = document.createElement('div');
    text.className = 'task-text';
    text.textContent = task.text;
    text.title = task.text;

    const del = document.createElement('div');
    del.className = 'task-del';
    del.title = 'Delete task';
    del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    del.addEventListener('click', e => {
      e.stopPropagation();
      tasks = tasks.filter(t => t.id !== task.id);
      saveTasks();
      renderTasks();
    });

    row.appendChild(check);
    row.appendChild(text);
    row.appendChild(del);
    list.appendChild(row);
  });

  panel.classList.toggle('is-empty', tasks.length === 0);
  if (count) {
    const left = tasks.filter(t => !t.done).length;
    count.textContent = left === 1 ? '1 left' : left + ' left';
  }
  layoutTasksPanel();
}

// The notch hugs its content: header + search bar, plus one row per task.
// Beyond TASKS_MAX_ROWS the list scrolls instead of growing further.
const TASKS_BASE_H = 106;   // padding + header + input row
const TASKS_ROW_H = 32;
const TASKS_ROW_GAP = 4;
const TASKS_MAX_ROWS = 5;

function layoutTasksPanel() {
  if (currentState !== 'tasks') return;
  const rows = Math.min(tasks.length, TASKS_MAX_ROWS);
  const listH = rows > 0 ? rows * TASKS_ROW_H + (rows - 1) * TASKS_ROW_GAP : 0;
  notch.style.height = (TASKS_BASE_H + listH) + 'px';
}

// Return to the expanded dashboard rather than shrinking the notch away —
// closing a sub-panel should feel like stepping back, not dismissing.
function goHomeView() {
  forcedPanel = null;
  currentState = 'idle';
  notch.setAttribute('data-state', 'idle');
  notch.style.height = '';
  if (!isExpanded) expand();
  decideState();
  showActivePanel();
}

function addTaskFromInput() {
  const input = document.getElementById('taskInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  tasks.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), text, done: false });
  input.value = '';
  saveTasks();
  renderTasks();
  const list = document.getElementById('tasksList');
  if (list) list.scrollTop = list.scrollHeight;
}

function setupTasksPanel() {
  const addBtn = document.getElementById('taskAddBtn');
  const input = document.getElementById('taskInput');
  const closeBtn = document.getElementById('tasksCloseBtn');

  if (addBtn) addBtn.addEventListener('click', e => { e.stopPropagation(); addTaskFromInput(); });
  if (input) {
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') addTaskFromInput();
      else if (e.key === 'Escape') closeTasksPanel();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); closeTasksPanel(); });

  renderTasks();
}

function openTasksPanel() {
  forcedPanel = 'panelTasks';
  currentState = 'tasks';
  notch.setAttribute('data-state', 'tasks');
  renderTasks();
  if (!isExpanded) expand(); else showActivePanel();
  setTimeout(() => {
    const input = document.getElementById('taskInput');
    if (input) input.focus();
  }, 260);
}

function closeTasksPanel() {
  const input = document.getElementById('taskInput');
  if (input) { input.value = ''; input.blur(); }
  goHomeView();
}

/*  Timer picker (iOS-style wheels)  */
const TP_ITEM_H = 36;
const tpCols = [
  { id: 'tpHours',   max: 23 },
  { id: 'tpMinutes', max: 59 },
  { id: 'tpSeconds', max: 59 }
];
let tpBuilt = false;

function tpSelectedValue(col) {
  return Math.max(0, Math.min(col.max, Math.round(col.el.scrollTop / TP_ITEM_H)));
}

function tpPaint(col) {
  const sel = tpSelectedValue(col);
  col.items.forEach((item, i) => item.classList.toggle('sel', i === sel));
  return sel;
}

function tpRefreshStartBtn() {
  const btn = document.getElementById('tpStartBtn');
  if (btn) btn.disabled = tpTotalSeconds() === 0;
}

function tpTotalSeconds() {
  const [h, m, s] = tpCols.map(col => (col.el ? tpSelectedValue(col) : 0));
  return h * 3600 + m * 60 + s;
}

function tpScrollTo(col, value, smooth) {
  col.el.scrollTo({ top: value * TP_ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
}

function buildTimerPicker() {
  if (tpBuilt) return;
  tpCols.forEach(col => {
    const el = document.getElementById(col.id);
    if (!el) return;
    col.el = el;
    const holder = el.querySelector('.tp-items');
    col.items = [];
    for (let v = 0; v <= col.max; v++) {
      const item = document.createElement('div');
      item.className = 'tp-item';
      item.textContent = v;
      // Clicking a row scrolls it into the selection pill rather than requiring a drag.
      item.addEventListener('click', e => { e.stopPropagation(); tpScrollTo(col, v, true); });
      holder.appendChild(item);
      col.items.push(item);
    }
    let settle = null;
    el.addEventListener('scroll', () => {
      tpPaint(col);
      tpRefreshStartBtn();
      // Snap-to-row after the wheel comes to rest (scroll-snap alone leaves
      // sub-pixel offsets when the user flicks).
      clearTimeout(settle);
      settle = setTimeout(() => {
        const sel = tpSelectedValue(col);
        if (Math.abs(el.scrollTop - sel * TP_ITEM_H) > 1) tpScrollTo(col, sel, true);
      }, 120);
    });
    // Vertical wheel over a column moves it one row at a time.
    el.addEventListener('wheel', e => { e.stopPropagation(); }, { passive: true });
  });
  tpBuilt = true;
}

function setupTimerPicker() {
  buildTimerPicker();
  const startBtn = document.getElementById('tpStartBtn');
  const cancelBtn = document.getElementById('tpCancelBtn');
  if (startBtn) {
    startBtn.addEventListener('click', e => {
      e.stopPropagation();
      const total = tpTotalSeconds();
      if (total <= 0) return;
      forcedPanel = null;
      currentState = 'timer';
      notch.setAttribute('data-state', 'timer');
      startTimer(total);
      showActivePanel();
    });
  }
  if (cancelBtn) cancelBtn.addEventListener('click', e => { e.stopPropagation(); closeTimerPicker(); });
}

function openTimerPicker() {
  buildTimerPicker();
  forcedPanel = 'panelTimerSetup';
  currentState = 'timer-setup';
  notch.setAttribute('data-state', 'timer-setup');
  if (!isExpanded) expand(); else showActivePanel();
  // Columns must be laid out (non-zero height) before scrollTop takes effect.
  requestAnimationFrame(() => {
    tpCols.forEach(col => {
      if (!col.el) return;
      tpScrollTo(col, 0, false); // every wheel starts at zero
      tpPaint(col);
    });
    tpRefreshStartBtn();
  });
}

function closeTimerPicker() {
  goHomeView();
}

// Alarm chime, synthesised — the app ships no audio assets. A "duh duh duh"
// triple beep that repeats until the user dismisses it with the ✕.
let chimeCtx = null;
let chimeOscs = [];
let chimeLoop = null;
const CHIME_PERIOD_MS = 1400;

function playChimeGroup() {
  if (!chimeCtx) return;
  const ctx = chimeCtx;
  const master = ctx.createGain();
  master.gain.value = 0.25;
  master.connect(ctx.destination);

  const t0 = ctx.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.17;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    // Percussive envelope: near-instant attack, exponential decay.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.18);
    osc.addEventListener('ended', () => {
      chimeOscs = chimeOscs.filter(o => o !== osc);
    });
    chimeOscs.push(osc);
  }
}

function playTimerChime() {
  stopTimerChime();
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    chimeCtx = new AC();
    if (chimeCtx.state === 'suspended') chimeCtx.resume();
    playChimeGroup();
    chimeLoop = setInterval(playChimeGroup, CHIME_PERIOD_MS);
  } catch (e) {
    console.warn('[Timer] chime failed:', e);
  }
}

function stopTimerChime() {
  if (chimeLoop) { clearInterval(chimeLoop); chimeLoop = null; }
  chimeOscs.forEach(osc => { try { osc.stop(); } catch (e) {} });
  chimeOscs = [];
  if (chimeCtx) {
    try { chimeCtx.close(); } catch (e) {}
    chimeCtx = null;
  }
}

// Stop the countdown and step back to the dashboard. Also dismisses the alarm
// if it fires while the "Time's up" panel is still up.
function cancelTimer() {
  isTimerActive = false;
  isTimerPaused = false;
  alarmActive = false;
  notch.classList.remove('alarm');
  clearInterval(localTimerInterval);
  stopTimerChime();
  const txt = document.getElementById('timerText');
  if (txt) txt.textContent = '0:00'; // reset before the panel is reused
  goHomeView();
}

// Nothing outside the notch knows about this timer, so the notch announces it
// itself: it rings and stays open on "Time's up" until the ✕ is clicked, so the
// alarm can't be missed and the dismiss button is always on screen.
function onTimerFinished() {
  isTimerPaused = false;
  alarmActive = true;
  notch.classList.add('alarm');
  playTimerChime();

  const txt = document.getElementById('timerText');
  if (txt) txt.textContent = "Time's up";
  const cTxt = document.getElementById('cTimerTime');
  if (cTxt) cTxt.textContent = '0:00';

  forcedPanel = 'panelTimer';
  currentState = 'timer';
  notch.setAttribute('data-state', 'timer');
  if (!isExpanded) expand(); else showActivePanel();
}

async function fetchCalendar() {
  try {
    const target = new Date();
    target.setDate(target.getDate() + calendarOffset);
    
    const events = await window.notchAPI.getCalendar(target.toISOString());
    const footer = document.getElementById('dashCalFooter');
    if (footer) {
      if (events && events.length > 0) {
        const todayEvent = events[0];
        footer.querySelector('span').textContent = todayEvent.title;
        footer.style.color = todayEvent.color || 'rgba(255,255,255,0.35)';
        footer.style.display = 'flex';
      } else {
        // No events — hide the footer entirely (no "Nothing for today" placeholder)
        footer.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error fetching calendar:', err);
  }
}

function getAverageRGB(img) {
  const fallback = '#1DB954';
  const c = document.createElement('canvas');
  const ctx = c.getContext && c.getContext('2d');
  if (!ctx) return fallback;
  const h = c.height = img.naturalHeight || img.offsetHeight || img.height;
  const w = c.width = img.naturalWidth || img.offsetWidth || img.width;
  if (!h || !w) return fallback;
  try {
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r=0,g=0,b=0,n=0;
    for (let i=0;i<d.length;i+=20){r+=d[i];g+=d[i+1];b+=d[i+2];n++}
    r=Math.floor(r/n);g=Math.floor(g/n);b=Math.floor(b/n);
    const mx=Math.max(r,g,b);
    if(mx<200&&mx>0){const mul=200/mx;r=Math.min(255,Math.floor(r*mul));g=Math.min(255,Math.floor(g*mul));b=Math.min(255,Math.floor(b*mul));}
    return `rgb(${r},${g},${b})`;
  } catch(e){return fallback}
}

function updateStarButtons() {
    const hasVideo = mediaData && mediaData.videoId;
    const starSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    const pipSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><rect x="12" y="12" width="8" height="8" rx="2" ry="2" fill="currentColor"></rect></svg>';
    
    const pStar = document.getElementById('shuffleBtn');
    const dStar = document.getElementById('dashStarBtn');
    
    if (pStar) {
      const svg = pStar.querySelector('svg');
      if (svg) {
        if (hasVideo) {
          svg.outerHTML = starSvg;
          pStar.title = 'Toggle favorite';
        } else {
          svg.outerHTML = pipSvg;
          pStar.title = 'Play in Notch PiP';
        }
      }
    }
    if (dStar) {
      const svg = dStar.querySelector('svg');
      if (svg) {
        if (hasVideo) {
          svg.outerHTML = starSvg;
          dStar.title = 'Toggle favorite';
        } else {
          svg.outerHTML = pipSvg;
          dStar.title = 'Play in Notch PiP';
        }
      }
    }
  }
  
  function updateMusicUI() {
  const coverImg = document.getElementById('coverImg');
  const placeholder = document.getElementById('albumPlaceholder');
  const cAlbum = document.getElementById('cAlbumImg');

  // Update star/PiP buttons based on whether video is available
  const hasVideo = mediaData && mediaData.videoId;
  const pStar = document.getElementById('shuffleBtn');
  const dStar = document.getElementById('dashStarBtn');
  const starSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
  const pipSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><rect x="12" y="12" width="8" height="8" rx="2" ry="2" fill="currentColor"></rect></svg>';
  
  function updateStarButton(btn) {
    if (!btn) return;
    if (hasVideo) {
      btn.innerHTML = starSvg;
      btn.title = 'Add to favorites';
    } else {
      btn.innerHTML = pipSvg;
      btn.title = 'Play in Notch PiP';
    }
  }
  
  updateStarButton(pStar);
  updateStarButton(dStar);

  if (mediaData.playing || mediaData.paused) {
    const track = mediaData.track || mediaData.title;
    const songTitle = document.getElementById('songTitle');
    if (songTitle) songTitle.textContent = track;
    const songArtist = document.getElementById('songArtist');
    if (songArtist) songArtist.textContent = mediaData.artist ? `By: ${mediaData.artist}` : '';
    const cSongTitle = document.getElementById('cSongTitle');
    if (cSongTitle) cSongTitle.textContent = mediaData.artist ? `${track} - By: ${mediaData.artist}` : track;
    const dashSongTitle = document.getElementById('dashSongTitle');
    if (dashSongTitle) dashSongTitle.textContent = track;
    const dashSongArtist = document.getElementById('dashSongArtist');
    if (dashSongArtist) dashSongArtist.textContent = mediaData.artist ? `By: ${mediaData.artist}` : '';
    const dashSongAlbum = document.getElementById('dashSongAlbum');
    if (dashSongAlbum) dashSongAlbum.textContent = mediaData.album || '';
    const btmuSongTitle = document.getElementById('btmuSongTitle');
    if (btmuSongTitle) btmuSongTitle.textContent = track;
    const btmuSongArtist = document.getElementById('btmuSongArtist');
    if (btmuSongArtist) btmuSongArtist.textContent = mediaData.artist ? `By: ${mediaData.artist}` : '';

    // Show music column on dashboard
    document.getElementById('dashMusicCol').classList.remove('hidden');
    document.getElementById('dashMusicSep').classList.remove('hidden');
    const cal = document.querySelector('.dash-cal');
    if (cal) cal.style.justifyContent = 'flex-end';

    const playSvg = document.querySelector('#playBtn svg');
    const btmuPlaySvg = document.querySelector('#btmuPlayBtn svg');
    const dashPlayBtnSvg = document.querySelector('#dashPlayBtn svg');

    if (mediaData.paused) {
      stopVisualizer();
      if (playSvg) playSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      if (btmuPlaySvg) btmuPlaySvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
    } else {
      startVisualizer();
      if (playSvg) playSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (btmuPlaySvg) btmuPlaySvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    }
    animateProgress();

    // Show scrubber for YouTube now that we parse duration correctly
    const seekBars = document.querySelectorAll('.mu-seek, .dash-seek');
    seekBars.forEach(bar => {
      bar.style.display = 'flex';
    });

    if (mediaData.artUrl) {
      coverImg.crossOrigin = 'Anonymous';
      cAlbum.crossOrigin = 'Anonymous';
      coverImg.onload = () => { document.documentElement.style.setProperty('--eq', getAverageRGB(coverImg)); };
      coverImg.src = mediaData.artUrl;
      coverImg.style.display = 'block';
      placeholder.style.display = 'none';
      cAlbum.src = mediaData.artUrl;
      cAlbum.style.display = 'block';
      const dashImg = document.getElementById('dashCoverImg');
      const dashPh = document.getElementById('dashArtPlaceholder');
      const ytPlayOverlay = document.getElementById('ytPlayOverlay');
      const ytIframe = document.getElementById('dashYtIframe');
      const ytMusicPlayOverlay = document.getElementById('ytMusicPlayOverlay');
      const musicYtIframe = document.getElementById('musicYtIframe');
      
      if (dashImg) { dashImg.src = mediaData.artUrl; dashImg.style.display = 'block'; }
      if (dashPh) { dashPh.style.display = 'none'; }
      
      if (mediaData.videoId) {
        if (ytPlayOverlay) ytPlayOverlay.style.display = 'flex';
        if (ytMusicPlayOverlay) ytMusicPlayOverlay.style.display = 'flex';
        // Hide iframes initially if the track changes
        if (ytIframe && !ytIframe.src.includes(mediaData.videoId)) {
            ytIframe.style.display = 'none';
            ytIframe.src = '';
        }
        if (musicYtIframe && !musicYtIframe.src.includes(mediaData.videoId)) {
            musicYtIframe.style.display = 'none';
            musicYtIframe.src = '';
        }
      } else {
        if (ytPlayOverlay) ytPlayOverlay.style.display = 'none';
        if (ytIframe) { ytIframe.style.display = 'none'; ytIframe.src = ''; }
        if (ytMusicPlayOverlay) ytMusicPlayOverlay.style.display = 'none';
        if (musicYtIframe) { musicYtIframe.style.display = 'none'; musicYtIframe.src = ''; }
        // Reset to PiP icon when no videoId
        const pStar = document.getElementById('shuffleBtn');
        if (pStar) {
          pStar.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><rect x="12" y="12" width="8" height="8" rx="2" ry="2" fill="currentColor"></rect></svg>';
          pStar.style.color = 'rgba(255,255,255,0.5)';
          pStar.title = 'Play in Notch PiP';
        }
        const dStar = document.getElementById('dashStarBtn');
        if (dStar) {
          dStar.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><rect x="12" y="12" width="8" height="8" rx="2" ry="2" fill="currentColor"></rect></svg>';
          dStar.style.color = 'rgba(255,255,255,0.5)';
          dStar.title = 'Play in Notch PiP';
        }
      }

      const btmuImg = document.getElementById('btmuCoverImg');
      const btmuPh = document.getElementById('btmuAlbumPh');
      if (btmuImg) { btmuImg.src = mediaData.artUrl; btmuImg.style.display = 'block'; }
      if (btmuPh) { btmuPh.style.display = 'none'; }
    } else {
      document.documentElement.style.setProperty('--eq', '#FA233B'); // Apple Red
      coverImg.style.display = 'none';
      placeholder.style.display = 'flex';
      cAlbum.style.display = 'none';
      const btmuImg = document.getElementById('btmuCoverImg');
      const btmuPh = document.getElementById('btmuAlbumPh');
      if (btmuImg) btmuImg.style.display = 'none';
      if (btmuPh) btmuPh.style.display = 'flex';
      const dashImg = document.getElementById('dashCoverImg');
      if (dashImg) dashImg.style.display = 'none';
      const dashPh = document.getElementById('dashArtPlaceholder');
      if (dashPh) dashPh.style.display = 'flex';
      const ytPlayOverlay = document.getElementById('ytPlayOverlay');
      const ytIframe = document.getElementById('dashYtIframe');
      if (ytPlayOverlay) ytPlayOverlay.style.display = 'none';
      if (ytIframe) { ytIframe.style.display = 'none'; ytIframe.src = ''; }
      const ytMusicPlayOverlay = document.getElementById('ytMusicPlayOverlay');
      const musicYtIframe = document.getElementById('musicYtIframe');
      if (ytMusicPlayOverlay) ytMusicPlayOverlay.style.display = 'none';
      if (musicYtIframe) { musicYtIframe.style.display = 'none'; musicYtIframe.src = ''; }
    }
  } else {
    const songTitle = document.getElementById('songTitle');
    if (songTitle) songTitle.textContent = 'Not Playing';
    const songArtist = document.getElementById('songArtist');
    if (songArtist) songArtist.textContent = 'No active media';
    const cSongTitle = document.getElementById('cSongTitle');
    if (cSongTitle) cSongTitle.textContent = '';
    const dashSongTitle = document.getElementById('dashSongTitle');
    if (dashSongTitle) dashSongTitle.textContent = 'Not Playing';
    const dashSongArtist = document.getElementById('dashSongArtist');
    if (dashSongArtist) dashSongArtist.textContent = 'No active media';
    const dashSongAlbum = document.getElementById('dashSongAlbum');
    if (dashSongAlbum) dashSongAlbum.textContent = '';
    const btmuSongTitle = document.getElementById('btmuSongTitle');
    if (btmuSongTitle) btmuSongTitle.textContent = 'Not Playing';
    const btmuSongArtist = document.getElementById('btmuSongArtist');
    if (btmuSongArtist) btmuSongArtist.textContent = 'No active media';

    // Hide music column on dashboard
    document.getElementById('dashMusicCol').classList.add('hidden');
    document.getElementById('dashMusicSep').classList.add('hidden');
    const cal = document.querySelector('.dash-cal');
    if (cal) cal.style.justifyContent = 'center';

    stopVisualizer();
    coverImg.style.display = 'none';
    placeholder.style.display = 'flex';
    cAlbum.style.display = 'none';
    const seekFills = [document.getElementById('seekFill'), document.getElementById('dashSeekFill')];
    seekFills.forEach(el => { if (el) el.style.width = '0%'; });
    const seekThumbs = [document.getElementById('seekThumb'), document.getElementById('dashSeekThumb')];
    seekThumbs.forEach(el => { if (el) el.style.left = '0%'; });
    const elsElapsed = [document.getElementById('timeElapsed'), document.getElementById('dashTimeElapsed')];
    elsElapsed.forEach(el => { if (el) el.textContent = '-0:00'; });
    const elsTotal = [document.getElementById('timeTotal'), document.getElementById('dashTimeTotal')];
    elsTotal.forEach(el => { if (el) el.textContent = '0:00'; });
    if (progressInterval) clearInterval(progressInterval);
  }
}

let lastKnownPeak = 0;
let visualizerFrame = null;

function startVisualizer() {
  if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  visualizerFrame = requestAnimationFrame(visualizerLoop);
}

function stopVisualizer() {
  if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  visualizerFrame = null;
  document.querySelectorAll('.equalizer span, .c-eq span').forEach(s => {
    s.style.height = s.parentElement.classList.contains('equalizer') ? '4px' : '3px';
  });
}

function visualizerLoop() {
  if (!mediaData.playing) {
    stopVisualizer();
    return;
  }

  const spans = document.querySelectorAll('.equalizer span, .c-eq span');
  const now = Date.now();
  
  // Use lastKnownPeak, decaying slowly if no update received
  lastKnownPeak *= 0.92; 
  if (lastKnownPeak < 0.1) lastKnownPeak = 0;

  spans.forEach((s, idx) => {
    const isBig = s.parentElement.classList.contains('equalizer');
    const maxH = isBig ? 24 : 12;
    const minH = isBig ? 4 : 3;
    
    const randomOffset = Math.sin(now / 100 + idx * 2) * 0.5 + 0.5;
    const barPeak = lastKnownPeak * (0.3 + 0.7 * randomOffset);
    const peakContribution = (barPeak / 100) * (maxH - minH);
    const targetH = Math.max(minH, minH + peakContribution);
    
    s.style.height = targetH + 'px';
    // Faster transition for accurate data
    s.style.transition = 'height 0.05s linear';
  });

  visualizerFrame = requestAnimationFrame(visualizerLoop);
}

function updateVisualizerWithPeak(peak) {
  if (peak > lastKnownPeak) lastKnownPeak = peak;
  else lastKnownPeak = (lastKnownPeak * 0.7) + (peak * 0.3);
}

let lastKnownMicPeak = 0;
let micVisualizerFrame = null;

function micVisualizerLoop() {
  const spans = document.querySelectorAll('#pillRecWave span.wb');
  if (!spans || spans.length === 0) return;
  
  if (recordingData.recording && recordingData.state !== 'PAUSED') {
    const now = Date.now();
    lastKnownMicPeak *= 0.85; // Faster decay for mic
    if (lastKnownMicPeak < 0.1) lastKnownMicPeak = 0;

    spans.forEach((s, idx) => {
      const maxH = 14;
      const minH = 3;
      
      const randomOffset = Math.sin(now / 80 + idx * 3) * 0.5 + 0.5;
      const barPeak = lastKnownMicPeak * (0.4 + 0.6 * randomOffset);
      const peakContribution = (barPeak / 100) * (maxH - minH);
      const targetH = minH + peakContribution;
      
      s.style.height = targetH + 'px';
      s.style.transition = 'height 0.05s linear';
    });
  } else {
    // If not recording or paused, make them flat
    spans.forEach(s => {
      s.style.height = '3px';
      s.style.transition = 'height 0.1s linear';
    });
  }
  
  micVisualizerFrame = requestAnimationFrame(micVisualizerLoop);
}
// Start it immediately, it will idle nicely
micVisualizerLoop();

function updateMicVisualizerWithPeak(peak) {
  // Boost mic peak slightly for better visuals
  let boosted = peak * 1.5;
  if (boosted > 100) boosted = 100;
  if (boosted > lastKnownMicPeak) lastKnownMicPeak = boosted;
  else lastKnownMicPeak = (lastKnownMicPeak * 0.5) + (boosted * 0.5);
}

let musicDuration = 0;
let musicElapsed = 0;
let isDraggingScrubber = false;

function animateProgress() {
  if (progressInterval) clearInterval(progressInterval);
  
  if (mediaData.duration && mediaData.duration > 0) {
    musicDuration = Math.floor(mediaData.duration / 1000);
  } else {
    musicDuration = 0; // Default or hidden if unknown
  }

  // If a new track started playing, reset elapsed
  if (mediaData.playing && !isDraggingScrubber && (fakePct === 0 || lastTrack !== mediaData.track)) {
    musicElapsed = 0;
    lastTrack = mediaData.track;
  }

  progressInterval = setInterval(() => {
    if (!mediaData.playing || isDraggingScrubber) return;
    
    if (musicDuration > 0) {
      musicElapsed += 0.5;
      if (musicElapsed > musicDuration) musicElapsed = 0;
      fakePct = (musicElapsed / musicDuration) * 100;
    } else {
      fakePct += 0.25; if (fakePct > 100) fakePct = 0;
      musicElapsed = Math.floor((fakePct/100) * 210);
      musicDuration = 210;
    }

    updateScrubberUI(fakePct, musicElapsed, musicDuration);
  }, 500);
}

function updateScrubberUI(pct, elapsed, total) {
  const seekFills = [document.getElementById('seekFill'), document.getElementById('dashSeekFill')];
  const seekThumbs = [document.getElementById('seekThumb'), document.getElementById('dashSeekThumb')];
  
  seekFills.forEach(el => { if (el) el.style.width = pct + '%'; });
  seekThumbs.forEach(el => { if (el) el.style.left = pct + '%'; });
  
  const elsElapsed = [document.getElementById('timeElapsed'), document.getElementById('dashTimeElapsed')];
  const elsTotal = [document.getElementById('timeTotal'), document.getElementById('dashTimeTotal')];

  if (total > 0) {
    const elStr = `${Math.floor(elapsed/60)}:${(Math.floor(elapsed)%60).toString().padStart(2,'0')}`;
    const rem = total - elapsed;
    const totStr = `-${Math.floor(rem/60)}:${(Math.floor(rem)%60).toString().padStart(2,'0')}`;
    
    elsElapsed.forEach(el => { if (el) el.textContent = elStr; });
    elsTotal.forEach(el => { if (el) el.textContent = totStr; });
  } else {
    elsElapsed.forEach(el => { if (el) el.textContent = ''; });
    elsTotal.forEach(el => { if (el) el.textContent = ''; });
  }
}

// Set up scrubber drag events
function setupScrubberDrag() {
  const seekAreas = [document.querySelector('.mu-bar'), document.getElementById('dashSeekArea')];
  
  let isDown = false;
  
  const moveScrubber = (e, area) => {
    if (!isDown) return;
    const rect = area.getBoundingClientRect();
    let x = e.clientX || (e.touches && e.touches[0].clientX);
    if (x === undefined) return;
    
    let pct = ((x - rect.left) / rect.width) * 100;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    
    fakePct = pct;
    const curTotal = musicDuration > 0 ? musicDuration : 210;
    musicElapsed = (pct / 100) * curTotal;
    updateScrubberUI(pct, musicElapsed, curTotal);
  };
  
  seekAreas.forEach(seekArea => {
    if (!seekArea) return;
    seekArea.addEventListener('mousedown', (e) => {
      isDown = true;
      isDraggingScrubber = true;
      moveScrubber(e, seekArea);
    });
    
    window.addEventListener('mousemove', (e) => moveScrubber(e, seekArea));
    window.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        setTimeout(() => isDraggingScrubber = false, 100); // small delay to resume
      }
    });
    
    seekArea.addEventListener('touchstart', (e) => {
      isDown = true;
      isDraggingScrubber = true;
      moveScrubber(e, seekArea);
    });
    
    window.addEventListener('touchmove', (e) => moveScrubber(e, seekArea));
    window.addEventListener('touchend', () => {
      if (isDown) {
        isDown = false;
        setTimeout(() => isDraggingScrubber = false, 100);
      }
    });
  });
}


/* ─── Battery ─── */
function handleBatteryEvent(bat) {
  if (!bat.hasBattery) return;
  const plugChanged = wasCharging !== null && bat.isCharging !== wasCharging;
  const isLow = bat.percent <= 20 && !bat.isCharging;
  const hitLow = isLow && !showedLowBattery;
  const isFirst = wasCharging === null;

  if (plugChanged || hitLow || isFirst) showBatteryToast(bat);
  if (isLow) showedLowBattery = true;
  if (bat.isCharging || bat.percent > 20) showedLowBattery = false;
  wasCharging = bat.isCharging;
  batteryData = bat;

  const cBattery = document.getElementById('cBattery');
  const cBattPct = document.getElementById('cBattPct');
  const cBattInner = document.getElementById('cBattInner');
  const cBattZap = document.getElementById('cBattZap');
  
  const dashBattPctText = document.getElementById('dashBattPctText');
  const dashBattFill = document.getElementById('dashBattFill');
  if (dashBattPctText && dashBattFill) {
    dashBattPctText.textContent = bat.percent + '%';
    dashBattFill.setAttribute('width', Math.max(1, (bat.percent / 100) * 15));
    if (bat.isCharging) {
      dashBattPctText.style.color = 'var(--green)';
      dashBattFill.setAttribute('fill', 'var(--green)');
    } else if (bat.powerSaver) {
      dashBattPctText.style.color = '#fbbf24';
      dashBattFill.setAttribute('fill', '#fbbf24');
    } else if (bat.percent < 10) {
      dashBattPctText.style.color = 'var(--red)';
      dashBattFill.setAttribute('fill', 'var(--red)');
    } else if (bat.percent <= 20) {
      dashBattPctText.style.color = 'var(--red)';
      dashBattFill.setAttribute('fill', 'var(--red)');
    } else {
      dashBattPctText.style.color = '#fff';
      dashBattFill.setAttribute('fill', '#fff');
    }
  }
  
  if (cBattery && cBattPct && cBattInner) {
    cBattPct.textContent = bat.percent + '%';
    cBattery.className = 'c-batt';
    
    // update fill width
    cBattInner.setAttribute('width', Math.max(1, (bat.percent / 100) * 15));
    
    if (cBattZap) {
      cBattZap.style.display = bat.isCharging ? 'block' : 'none';
    }

    if (bat.isCharging) {
      cBattery.classList.add('charging');
    } else if (bat.powerSaver) {
      cBattery.classList.add('saver');
    } else if (bat.percent < 10) {
      cBattery.classList.add('low');
    } else if (bat.percent <= 20) {
      cBattery.classList.add('low');
    }
  }
}

function showBatteryToast(bat) {
  if (battToastTimeout) clearTimeout(battToastTimeout);

  // Don't interrupt startup animation
  if (currentState === 'startup') return;

  if (bat.isCharging) {
    document.getElementById('chargingPct').textContent = bat.percent + '%';
    document.getElementById('chargingBattFill').setAttribute('width', Math.max(1, (bat.percent/100)*15));
    // Don't interrupt startup animation
    if (currentState === 'startup') return;
    setState('charging'); expand();
    battToastTimeout = setTimeout(() => { battToastTimeout = null; collapse(); setTimeout(decideState, 400); }, 4000);
    return;
  }

  if (bat.percent <= 20) {
    document.getElementById('lowBattPct').textContent = bat.percent + '%';
    document.getElementById('lowBattFill').setAttribute('width', Math.max(1, (bat.percent/100)*15));
    // Don't interrupt startup animation
    if (currentState === 'startup') return;
    setState('low-battery'); expand();
    battToastTimeout = setTimeout(() => { battToastTimeout = null; collapse(); setTimeout(decideState, 400); }, 4000);
    return;
  }

  // Unplugged normal
  if (isExpanded) collapse();
  decideState();
}

/* ─── Bluetooth ─── */
function getAirPodsImage(name) {
  const n = name.toLowerCase();
  if (n.includes('airpods pro')) return 'airpods_pro.png';
  if (n.includes('airpods max')) return 'airpods_max.png';
  if (n.includes('airpod')) return 'airpods_gen.png';
  return 'airpods_gen.png';
}

function updateCircularRing(pct) {
  const circ = 2 * Math.PI * 15; // r=15
  const fill = document.getElementById('cBtRingFill');
  const text = document.getElementById('cBtRingText');
  if (!fill || !text) return;
  fill.setAttribute('stroke-dasharray', circ);
  fill.setAttribute('stroke-dashoffset', circ - (pct / 100) * circ);
  const color = pct <= 20 ? '#ef4444' : '#22c55e';
  fill.setAttribute('stroke', color);
  text.textContent = pct;
}

function startBtEq() {
  if (btEqInterval) clearInterval(btEqInterval);
  const spans = document.querySelectorAll('.c-bt-eq span');
  btEqInterval = setInterval(() => {
    spans.forEach(s => { s.style.height = Math.floor(Math.random() * 10 + 3) + 'px'; s.style.transition = 'height .12s ease'; });
  }, 150);
}

function showBluetoothToast(device) {
  const name = device.name || 'Bluetooth Device';
  const imgSrc = getAirPodsImage(name);
  const known = device.battery >= 0 && device.battery <= 100;

  // Store persistent connection
  btConnectedDevice = { name, battery: known ? device.battery : -1, imgSrc };

  // --- Expanded toast panel ---
  document.getElementById('cBtName').textContent = name;
  document.getElementById('btDeviceName').textContent = name;
  const img = document.getElementById('btProductImg');
  if (img) img.src = imgSrc;

  const leftPct = document.getElementById('btPctLeft');
  const rightPct = document.getElementById('btPctRight');
  const leftSvg = document.getElementById('btBattLeftSvg');
  const rightSvg = document.getElementById('btBattRightSvg');
  if (known) {
    const fillW = Math.max(1, (device.battery / 100) * 17);
    const color = device.battery <= 20 ? '#ef4444' : '#22c55e';
    document.getElementById('btBattFillLeft').setAttribute('width', fillW);
    document.getElementById('btBattFillLeft').setAttribute('fill', color);
    leftPct.textContent = device.battery + '%'; leftPct.style.display = 'block'; leftSvg.style.display = 'block';
    document.getElementById('btBattFillRight').setAttribute('width', fillW);
    document.getElementById('btBattFillRight').setAttribute('fill', color);
    rightPct.textContent = device.battery + '%'; rightPct.style.display = 'block'; rightSvg.style.display = 'block';
  } else {
    leftPct.style.display = 'none'; leftSvg.style.display = 'none';
    rightPct.style.display = 'none'; rightSvg.style.display = 'none';
  }

  // --- Collapsed BT bar ---
  document.getElementById('cBtSpinImg').src = imgSrc;
  document.getElementById('cBtLabel').textContent = name;
  if (known) updateCircularRing(device.battery);
  startBtEq();

  // --- Combined BT+Music panel ---
  document.getElementById('btmuImg').src = imgSrc;
  document.getElementById('btmuName').textContent = name;
  if (known) {
    document.getElementById('btmuBattFill').setAttribute('width', Math.max(1, (device.battery / 100) * 17));
    document.getElementById('btmuPct').textContent = device.battery + '%';
  }

  // Show expanded toast first
  if (btToastTimeout) clearTimeout(btToastTimeout);
  if (isExpanded) collapse();

  // Don't interrupt startup animation
  if (currentState === 'startup') return;

  setState('bluetooth'); expand();
  btToastTimeout = setTimeout(() => {
    btToastTimeout = null;
    collapse();
    setTimeout(decideState, 400); // will pick bt-connected or bt-music
  }, 5000);
}

/* ─── Unread Messages (swipeable carousel, shown in place of Quick Start) ─── */
let unreadList = [];
let unreadIndex = 0;
// Tracks who a reply in the expanded panel should go to (set when a live
// message arrives or an unread card is opened).
let activeReplyContext = null;

function openUnreadForReply(item) {
  activeReplyContext = { sender: item.sender || null, app: item.app || null };

  const nameEl = document.querySelectorAll('.msg-name');
  const textExpEl = document.querySelector('.msg-exp-text');
  const avatarEls = document.querySelectorAll('.msg-avatar');
  const appIconSmall = document.querySelector('.msg-app-icon-small');
  if (avatarEls && item.avatar) avatarEls.forEach(el => el.src = item.avatar);
  if (nameEl) nameEl.forEach(el => el.textContent = item.sender || 'Unknown Sender');
  if (textExpEl) textExpEl.textContent = item.text || '';
  if (appIconSmall) appIconSmall.style.background = item.app === 'gchat' ? '#00897B' : '#34c759';

  currentState = 'msg-expanded';
  notch.setAttribute('data-state', 'msg-expanded');
  if (!isExpanded) expand(); else showActivePanel();
  const replyInput = document.getElementById('msgReplyInput');
  if (replyInput) replyInput.focus();
}

function renderUnreadCard(item) {
  const card = document.createElement('div');
  card.className = 'unread-card';

  const avatar = document.createElement('img');
  avatar.className = 'unread-card-avatar';
  avatar.alt = '';
  avatar.src = item.avatar || ('https://i.pravatar.cc/150?u=' + encodeURIComponent(item.sender || 'unknown'));
  card.appendChild(avatar);

  const body = document.createElement('div');
  body.className = 'unread-card-body';

  const top = document.createElement('div');
  top.className = 'unread-card-top';
  const sender = document.createElement('span');
  sender.className = 'unread-card-sender';
  sender.textContent = item.sender || 'Unknown Sender';
  const time = document.createElement('span');
  time.className = 'unread-card-time';
  time.textContent = item.time || '';
  top.appendChild(sender);
  top.appendChild(time);

  const text = document.createElement('div');
  text.className = 'unread-card-text';
  text.textContent = item.text || '';

  body.appendChild(top);
  body.appendChild(text);
  card.appendChild(body);

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    openUnreadForReply(item);
  });

  return card;
}

function updateUnreadTransform() {
  const track = document.getElementById('unreadsTrack');
  if (track) track.style.transform = 'translateX(-' + (unreadIndex * 100) + '%)';
  const dots = document.querySelectorAll('#unreadsDots .unreads-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === unreadIndex));
}

function goToUnread(i) {
  if (unreadList.length === 0) return;
  unreadIndex = Math.max(0, Math.min(i, unreadList.length - 1));
  updateUnreadTransform();
}
function nextUnread() { goToUnread(unreadIndex + 1); }
function prevUnread() { goToUnread(unreadIndex - 1); }

function updateUnreadBadge(count) {
  const badge = document.getElementById('cUnreadBadge');
  if (badge) {
    if (count > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = count > 99 ? '99+' : String(count);
    } else {
      badge.style.display = 'none';
    }
  }
}

function renderUnreads(list) {
  unreadList = Array.isArray(list) ? list : [];
  const track = document.getElementById('unreadsTrack');
  const dots = document.getElementById('unreadsDots');
  const empty = document.getElementById('unreadsEmptyState');
  const carousel = document.getElementById('unreadsCarousel');

  updateUnreadBadge(unreadList.length);
  if (!track) { decideState(); return; }

  track.innerHTML = '';
  if (dots) dots.innerHTML = '';

  if (unreadList.length === 0) {
    if (carousel) carousel.style.display = 'none';
    if (dots) dots.style.display = 'none';
    if (empty) empty.style.display = 'block';
    decideState();
    return;
  }

  if (carousel) carousel.style.display = 'flex';
  if (empty) empty.style.display = 'none';

  unreadList.forEach((item, i) => {
    track.appendChild(renderUnreadCard(item));
    if (dots) {
      const dot = document.createElement('div');
      dot.className = 'unreads-dot' + (i === 0 ? ' active' : '');
      dots.appendChild(dot);
    }
  });
  if (dots) dots.style.display = unreadList.length > 1 ? 'flex' : 'none';

  unreadIndex = 0;
  updateUnreadTransform();

  // A fresh unread list just came in — let the notch surface it now
  // instead of waiting for the next unrelated state check.
  decideState();
}

function setupUnreads() {
  const vp = document.getElementById('unreadsViewport');
  if (!vp) return;
  let startX = 0, dragging = false, dx = 0;
  vp.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; dx = 0;
    try { vp.setPointerCapture(e.pointerId); } catch (_) {}
  });
  vp.addEventListener('pointermove', (e) => { if (dragging) dx = e.clientX - startX; });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const threshold = 40;
    if (dx <= -threshold) nextUnread();
    else if (dx >= threshold) prevUnread();
  };
  vp.addEventListener('pointerup', end);
  vp.addEventListener('pointercancel', () => { dragging = false; });
  vp.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      if (e.deltaX > 0) nextUnread(); else prevUnread();
    }
  }, { passive: false });
}
async function fetchRecording() {
  // Handled by external-timers now.
}

/* ─── Init ─── */
  document.addEventListener('DOMContentLoaded', () => {
  setupInteractions();
  setupQuickLaunch();
  updateClock();
  setInterval(updateClock, 1000);
  
  // Hook up Timer buttons
  const timerPauseBtn = document.getElementById('timerPauseBtn');
  const timerCancelBtn = document.getElementById('timerCancelBtn');
  if (timerPauseBtn) {
    timerPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isTimerActive) return; // nothing to pause during the "Time's up" hold
      isTimerPaused = !isTimerPaused;
      updateTimerUI();
    });
  }
  if (timerCancelBtn) {
    timerCancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelTimer();
    });
  }

  setupTasksPanel();
  setupTimerPicker();
  
  // Hook up Recording buttons (Visual & IPC)
  const recPauseBtn = document.getElementById('recPauseBtn');
  if (recPauseBtn) {
    recPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.notchAPI.setSysVal('toggleRec', 'true');
    });
  }
  const recStopBtn = document.getElementById('recStopBtn');
  if (recStopBtn) {
    recStopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.notchAPI.setSysVal('stopRec', 'true');
    });
  }

  fetchCalendar();
  setTimeout(fetchRecording, 2000);
  setInterval(fetchCalendar, 10000);
  setInterval(fetchRecording, 3000);
  updateMusicUI();

  if (window.notchAPI.onBatteryUpdate) {
    window.notchAPI.onBatteryUpdate(handleBatteryEvent);
    window.notchAPI.getBattery().then(bat => {
      if (bat && bat.hasBattery) handleBatteryEvent(bat);
    });
  }
  if (window.notchAPI.onBluetoothUpdate) window.notchAPI.onBluetoothUpdate(showBluetoothToast);
  if (window.notchAPI.onMediaUpdate) window.notchAPI.onMediaUpdate(handleMediaUpdate);
  // Face ID notch: shared by the lock screen (lock-monitor) and by the Windows
  // Hello passkey prompt / Face ID setup (hello-monitor).
  let faceScanSafety = null;
  let faceidLottieAnim = null;
  function faceScanStart() {
    clearTimeout(faceScanSafety);
    faceScanActive = true; // guard decideState() from stomping 'unlock'
    notch.classList.remove('success');
    if (faceidLottieAnim) faceidLottieAnim.goToAndStop(0, true);
    setState('unlock'); expand();
    // Stay in the scanning state for as long as the scan is running — Face ID
    // enrollment / "improve recognition" can take a while. The checkmark only
    // plays when we get the real "done" signal (FACE:STOP / UNLOCK). This long
    // timeout is only a last-resort safety so we never get stuck forever.
    faceScanSafety = setTimeout(faceScanSuccess, 5 * 60 * 1000);
  }
  function faceScanSuccess() {
    clearTimeout(faceScanSafety);
    if (!faceScanActive) return; // nothing to finish
    notch.classList.add('success');
    const finish = () => { faceScanActive = false; collapse(); notch.classList.remove('success'); setTimeout(decideState, 400); };
    const lottieEl = document.getElementById('faceidLottie');
    if (lottieEl && window.lottie) {
      if (!faceidLottieAnim) {
        faceidLottieAnim = window.lottie.loadAnimation({
          container: lottieEl,
          renderer: 'svg',
          loop: false,
          autoplay: false,
          path: '../assets/face-id-success.json'
        });
        faceidLottieAnim.addEventListener('complete', () => setTimeout(finish, 300));
      }
      faceidLottieAnim.goToAndPlay(0, true);
    } else {
      setTimeout(finish, 1200);
    }
  }

  if (window.notchAPI.onLockUpdate) {
    window.notchAPI.onLockUpdate(e => {
      if (e === 'LOCK') faceScanStart();
      else if (e === 'UNLOCK') faceScanSuccess();
    });
  }

  // Windows Hello passkey prompt / Face ID enrollment → same animation.
  if (window.notchAPI.onFaceIdScan) {
    window.notchAPI.onFaceIdScan(e => {
      if (e === 'START') faceScanStart();
      else if (e === 'STOP') faceScanSuccess();
    });
  }

  window.notchAPI.onAudioPeak((peak) => {
    updateVisualizerWithPeak(peak);
  });
  
  window.notchAPI.onMicPeak((peak) => {
    updateMicVisualizerWithPeak(peak);
  });

  // Unread messages carousel (paired device)
  setupUnreads();
  if (window.notchAPI.onUnreadsList) {
    window.notchAPI.onUnreadsList((list) => renderUnreads(list));
  }
  if (window.notchAPI.onUnreadCount) {
    window.notchAPI.onUnreadCount((count) => {
      if (typeof count === 'number' && count > 0) {
        messagesPaired = true;
        const login = document.getElementById('dashLoginContainer');
        if (login) login.style.display = 'none';
        updateUnreadBadge(count);
      }
    });
  }
});

let currentSliderType = 'vol';
let isDraggingSlider = false;
let sliderTimeout = null;

let sliderIconKind = null; // 'vol' | 'bright' — only rewrite the icon on change
function updateSliderUI(val, isBright, fromDrag = false) {
  const fill = document.getElementById('sliderFill');
  const p = document.getElementById('sliderPct');
  const i = document.getElementById('sliderIcon');
  if (!fill || !p || !i) return;

  if (!fromDrag) {
    currentSliderType = isBright ? 'bright' : 'vol';
  }

  // Hot path: only the fill + number update on every tick. Use a GPU-composited
  // transform (scaleX) instead of animating `width`, which avoids per-frame
  // layout and keeps the bar buttery under rapid volume/brightness changes.
  const clamped = Math.max(0, Math.min(100, val));
  fill.style.transform = 'scaleX(' + (clamped / 100) + ')';
  p.textContent = clamped;

  // Only touch the DOM-heavy icon markup when the kind actually changes.
  const kind = isBright ? 'bright' : 'vol';
  if (kind !== sliderIconKind) {
    sliderIconKind = kind;
    if (isBright) {
      // Brightness: sun icon replaces the volume/speaker icon.
      i.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3zm0-13l2.32 3.23h3.45v3.45L21 12l-3.23 2.32v3.45h-3.45L12 21l-2.32-3.23H6.23v-3.45L3 12l3.23-2.32V6.23h3.45L12 2z"/></svg>';
    } else {
      i.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    }
  }

  // Switch into the slider panel only once — subsequent value ticks skip the
  // heavy expand()/showActivePanel() layout pass entirely.
  if (!fromDrag) {
    forcedPanel = 'panelSlider';
    const alreadyShowing = isExpanded && notch.getAttribute('data-state') === 'slider';
    if (!alreadyShowing) {
      notch.setAttribute('data-state', 'slider');
      expand();
      showActivePanel();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sliderContainer = document.querySelector('.slider-bar-container');
  if (sliderContainer) {
    sliderContainer.addEventListener('mousedown', (e) => {
      isDraggingSlider = true;
      handleSliderDrag(e, true);
    });
    window.addEventListener('mousemove', (e) => {
      if (isDraggingSlider) handleSliderDrag(e, false);
    });
    window.addEventListener('mouseup', (e) => {
      if (isDraggingSlider) {
        isDraggingSlider = false;
        handleSliderDrag(e, true);
      }
    });
  }
});

function handleSliderDrag(e, commit = false) {
  const container = document.querySelector('.slider-bar-container');
  if (!container) return;
  const rect = container.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(x, rect.width));
  let val = Math.round((x / rect.width) * 100);
  updateSliderUI(val, currentSliderType === 'bright', true);
  // Keep the notch open while the user is dragging — reset the hide countdown
  // on every drag event so it only starts counting after they let go.
  scheduleSliderHide();
  if (commit && window.notchAPI.setSysVal) {
    window.notchAPI.setSysVal(currentSliderType, val);
  }
}

let dndTimeout = null;
let currentDndState = 0;
if (window.notchAPI.onSysDnd) {
  window.notchAPI.onSysDnd((val) => {
    currentDndState = val;
    if (val > 0) {
      document.getElementById('dndText').textContent = 'Silent';
      document.querySelector('.dnd-icon-bg').style.background = 'var(--red)';
    } else {
      document.getElementById('dndText').textContent = 'Ringer';
      document.querySelector('.dnd-icon-bg').style.background = 'gray';
    }
    // Don't interrupt startup animation
    if (currentState === 'startup') return;
    forcedPanel = 'panelDnd';
    notch.setAttribute('data-state', 'dnd');
    expand();
    showActivePanel();
    
    clearTimeout(dndTimeout);
    dndTimeout = setTimeout(() => {
      forcedPanel = null;
      collapse();
    }, 2000);
  });
}

// Restart the slider's auto-hide countdown. Called on first show and on every
// interaction (drag) so the notch never vanishes while you're actively using
// the control. If a drag is still in progress when it fires, it reschedules
// instead of collapsing.
function scheduleSliderHide() {
  clearTimeout(sliderTimeout);
  sliderTimeout = setTimeout(() => {
    if (isDraggingSlider) { scheduleSliderHide(); return; }
    forcedPanel = null;
    collapse();
  }, 1500);
}

function showSlider(val, isBright) {
  // Don't interrupt startup animation
  if (currentState === 'startup') return;

  // updateSliderUI handles the panel switch on first show and is a light
  // fill-only update on subsequent ticks — no redundant layout work here.
  updateSliderUI(val, isBright, false);
  scheduleSliderHide();
}

if (window.notchAPI.onSysVol) window.notchAPI.onSysVol(v => showSlider(v, false));
if (window.notchAPI.onSysBright) window.notchAPI.onSysBright(v => showSlider(v, true));

// Download indicator: a small ring in the collapsed pill (never expands the
// notch). Ring fill tracks real byte progress when known; falls back to a
// spinning indeterminate ring when the source (e.g. an external browser
// download) doesn't expose a total size.
let downloadActive = false;
let downloadCompleteTimeout = null;
const DL_RING_CIRC = 2 * Math.PI * 15;
if (window.notchAPI.onDownloadUpdate) {
  window.notchAPI.onDownloadUpdate((data) => {
    // Don't interrupt startup animation
    if (currentState === 'startup') return;

    const { state, filename, percent } = data;
    const cDlRingSvg = document.getElementById('cDlRingSvg');
    const cDlRingFill = document.getElementById('cDlRingFill');
    const cDlCheck = document.getElementById('cDlCheck');
    const cDlName = document.getElementById('cDlName');

    if (cDlName && filename) cDlName.textContent = filename;

    if (state === 'downloading') {
      clearTimeout(downloadCompleteTimeout);
      downloadActive = true;
      if (cDlCheck) cDlCheck.style.display = 'none';
      if (cDlRingSvg) cDlRingSvg.style.display = 'block';
      if (cDlRingFill) {
        cDlRingFill.setAttribute('stroke-dasharray', DL_RING_CIRC);
        if (typeof percent === 'number') {
          cDlRingFill.classList.remove('indeterminate');
          const pct = Math.max(0, Math.min(100, percent));
          cDlRingFill.setAttribute('stroke-dashoffset', DL_RING_CIRC - (pct / 100) * DL_RING_CIRC);
        } else {
          cDlRingFill.classList.add('indeterminate');
        }
      }
      decideState();
    } else if (state === 'complete') {
      downloadActive = true; // keep the pill slot showing the checkmark briefly
      if (cDlRingSvg) cDlRingSvg.style.display = 'none';
      if (cDlCheck) {
        cDlCheck.style.display = 'block';
        cDlCheck.classList.remove('dl-check-anim');
        void cDlCheck.offsetWidth; // trigger reflow
        cDlCheck.classList.add('dl-check-anim');
      }
      decideState();

      clearTimeout(downloadCompleteTimeout);
      downloadCompleteTimeout = setTimeout(() => {
        downloadActive = false;
        decideState();
      }, 2500);
    }
  });
}


const dashSearchInput = document.getElementById('dashSearchInput');
const searchGoogleIcon = document.getElementById('searchGoogleIcon');
const searchMicBtn = document.getElementById('searchMicBtn');

function executeSearch() {
  if (dashSearchInput && dashSearchInput.value.trim() !== '') {
    const val = dashSearchInput.value.trim();
    
    // Check for timer command
    if (val.toLowerCase().startsWith('timer ')) {
      const match = val.match(/^timer\s+(\d+)\s*(s|m|h)?/i);
      if (match) {
        let amt = parseInt(match[1]);
        const unit = match[2] ? match[2].toLowerCase() : 'm'; // Default to minutes if no unit
        if (unit === 'm') amt *= 60;
        else if (unit === 'h') amt *= 3600;
        startTimer(amt);
        dashSearchInput.value = '';
        collapse();
        return;
      }
    }
    
    const query = encodeURIComponent(val);
    const url = `https://www.google.com/search?q=${query}`;
    window.notchAPI.openUrl(url);
    dashSearchInput.value = '';
    collapse();
  } else {
    window.notchAPI.openUrl('https://www.google.com');
    collapse();
  }
}

if (dashSearchInput) {
  dashSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  });
}

if (searchGoogleIcon) {
  searchGoogleIcon.addEventListener('click', executeSearch);
}

// Duplicate mic listener removed to avoid overriding custom logic

async function fetchWeather() {
  try {
    const locRes = await fetch('http://ip-api.com/json/');
    const locData = await locRes.json();
    const city = locData.city;
    document.getElementById('weatherCity').textContent = city;
    
    const weatherData = await window.notchAPI.fetchWeather(city);
    if (!weatherData) throw new Error('No weather data');
    
    const temp = weatherData.current.temperature;
    const phrase = weatherData.current.skytext.toLowerCase();
    
    document.getElementById('weatherTemp').innerHTML = temp + '<span>°F</span>';
    
    const dashWeather = document.getElementById('dashWeather');
    dashWeather.className = 'dash-weather';
    
    let icon = '☀️';
    if (phrase.includes('sunny') || phrase.includes('clear')) {
      dashWeather.classList.add('weather-sunny');
      icon = '☀️';
    } else if (phrase.includes('rain') || phrase.includes('shower') || phrase.includes('storm')) {
      dashWeather.classList.add('weather-rainy');
      icon = '🌧️';
    } else if (phrase.includes('snow') || phrase.includes('ice')) {
      dashWeather.classList.add('weather-snowy');
      icon = '❄️';
    } else {
      dashWeather.classList.add('weather-cloudy');
      icon = phrase.includes('partly') ? '⛅' : '☁️';
    }
    
    document.getElementById('weatherIcon').textContent = icon;
    
  } catch(e) {
    console.error('Weather error:', e);
    document.getElementById('weatherCity').textContent = 'Location unavailable';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  fetchWeather();
  const weatherBtn = document.getElementById('weatherBtn');
  if (weatherBtn) {
    weatherBtn.addEventListener('click', () => {
      window.notchAPI.openUrl('https://weather.com/');
      collapse();
    });
  }
});
setInterval(fetchWeather, 3600000);

/* ─── Widgets: multi-select carousel + Stocks (market / watchlist) ─── */
const ALL_WIDGETS = ['weather', 'stocks'];

// Which widgets are on the dashboard (multi-select) and which one is showing.
let selectedWidgets = ['weather'];
try {
  const saved = JSON.parse(localStorage.getItem('dashWidgets') || 'null');
  if (Array.isArray(saved) && saved.length) {
    selectedWidgets = saved.filter(w => ALL_WIDGETS.includes(w));
  }
} catch (e) {}
if (!selectedWidgets.length) selectedWidgets = ['weather'];
let widgetIndex = 0;

// Stocks widget: 'market' (indices) or 'watchlist' (user-chosen symbols).
let stocksMode = 'market';
try { stocksMode = localStorage.getItem('stocksMode') || 'market'; } catch (e) {}
let watchlist = [];
try { watchlist = JSON.parse(localStorage.getItem('stocksWatchlist') || '[]') || []; } catch (e) {}
let stocksInterval = null;

// Builds the intraday line the way Google Finance draws it:
//  • x is scaled by REAL TIME, so a lull with no trades shows as a flat stretch
//    instead of being collapsed into evenly-spaced points.
//  • the previous close is kept inside the y-domain and returned as a baseline,
//    so how far the line sits above/below it is meaningful.
function sparkPoints(pts, prevClose, w = 100, h = 20) {
  if (!pts || pts.length < 2) return null;
  const vals = pts.map(p => p.c);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (prevClose != null) { min = Math.min(min, prevClose); max = Math.max(max, prevClose); }
  const range = (max - min) || 1;
  const pad = 1.5;
  const t0 = pts[0].t;
  const span = (pts[pts.length - 1].t - t0) || 1;
  const yOf = v => (h - pad) - ((v - min) / range) * (h - pad * 2);
  const line = pts
    .map(p => `${(((p.t - t0) / span) * w).toFixed(2)},${yOf(p.c).toFixed(2)}`)
    .join(' ');
  return { line, baseY: prevClose != null ? yOf(prevClose) : null };
}

async function fetchStocks() {
  const row = document.getElementById('stocksRow');
  if (!row) return;
  const watch = stocksMode === 'watchlist';
  if (watch && watchlist.length === 0) {
    row.innerHTML = '<div class="stocks-loading">Add symbols above to build your watchlist</div>';
    return;
  }
  try {
    const data = await window.notchAPI.getStocks(watch ? { symbols: watchlist } : undefined);
    if (!data || !data.length) throw new Error('no data');
    row.innerHTML = data.map(s => {
      const up = (s.changePct ?? 0) >= 0;
      const dir = up ? 'up' : 'down';
      const color = up ? '#16a34a' : '#dc2626';
      const price = (s.price != null)
        ? s.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '--';
      const pct = (s.changePct != null)
        ? `${up ? '+' : ''}${s.changePct.toFixed(2)}%`
        : '';
      const sp = sparkPoints(s.spark, s.prevClose, 100, 20);
      const baseline = (sp && sp.baseY != null)
        ? `<line x1="0" y1="${sp.baseY.toFixed(2)}" x2="100" y2="${sp.baseY.toFixed(2)}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>`
        : '';
      const spark = sp
        ? `<svg class="stock-spark" viewBox="0 0 100 20" preserveAspectRatio="none">${baseline}<polyline points="${sp.line}" fill="none" stroke="${color}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`
        : '';
      const prev = (s.prevClose != null)
        ? `<div class="stock-prev">Prev ${s.prevClose.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>`
        : '';
      const remove = watch
        ? `<button class="stock-remove" data-symbol="${s.symbol}" title="Remove">×</button>`
        : '';
      return `<div class="stock-item">
        ${remove}
        ${spark}
        <div class="stock-top">
          <span class="stock-name">${s.label}</span>
          <span class="stock-change ${dir}">${pct}</span>
        </div>
        <div class="stock-price">${price}</div>
        ${prev}
      </div>`;
    }).join('');
    if (watch) {
      row.querySelectorAll('.stock-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFromWatchlist(btn.dataset.symbol);
        });
      });
    }
  } catch (e) {
    row.innerHTML = '<div class="stocks-loading">Markets unavailable</div>';
  }
}

/* Watchlist persistence */
function saveWatchlist() {
  try { localStorage.setItem('stocksWatchlist', JSON.stringify(watchlist)); } catch (e) {}
}
function addToWatchlist(sym) {
  sym = (sym || '').trim().toUpperCase();
  if (!sym) return;
  if (!watchlist.includes(sym)) watchlist.push(sym);
  saveWatchlist();
  fetchStocks();
}
function removeFromWatchlist(sym) {
  watchlist = watchlist.filter(s => s !== sym);
  saveWatchlist();
  fetchStocks();
}

/* Sync the stocks widget's header + add-row to the current mode */
function syncStocksModeUI() {
  const title = document.getElementById('stocksTitle');
  if (title) title.textContent = stocksMode === 'watchlist' ? 'Watchlist' : 'Markets';
  const add = document.getElementById('watchlistAdd');
  if (add) add.style.display = stocksMode === 'watchlist' ? 'flex' : 'none';
  document.querySelectorAll('#stocksModeMenu .sm-item').forEach(it => {
    it.classList.toggle('selected', it.dataset.mode === stocksMode);
  });
}
function setStocksMode(mode) {
  stocksMode = mode;
  try { localStorage.setItem('stocksMode', mode); } catch (e) {}
  syncStocksModeUI();
  fetchStocks();
}

/* Carousel: show only the active widget; reveal the arrow + dots when 2+ chosen */
function renderWidgets() {
  if (widgetIndex >= selectedWidgets.length) widgetIndex = 0;
  const active = selectedWidgets[widgetIndex];
  const weatherEl = document.getElementById('dashWeather');
  const stocksEl = document.getElementById('dashStocks');
  if (weatherEl) weatherEl.style.display = active === 'weather' ? 'flex' : 'none';
  if (stocksEl) stocksEl.style.display = active === 'stocks' ? 'flex' : 'none';

  const multi = selectedWidgets.length > 1;
  const nav = document.getElementById('widgetNav');
  if (nav) nav.style.display = multi ? 'flex' : 'none';

  document.querySelectorAll('#widgetPicker .wp-item').forEach(it => {
    it.classList.toggle('selected', selectedWidgets.includes(it.dataset.widget));
  });

  clearInterval(stocksInterval);
  if (active === 'stocks') {
    syncStocksModeUI();
    fetchStocks();
    // Live refresh from Yahoo Finance — prices AND sparkline shapes
    stocksInterval = setInterval(fetchStocks, 15000);
  }
}

function nextWidget(dir) {
  if (selectedWidgets.length < 2) return;
  const n = selectedWidgets.length;
  widgetIndex = (widgetIndex + (dir || 1) + n) % n;
  renderWidgets();
}

function toggleWidget(w) {
  if (selectedWidgets.includes(w)) {
    if (selectedWidgets.length === 1) return; // always keep at least one
    selectedWidgets = selectedWidgets.filter(x => x !== w);
  } else {
    selectedWidgets.push(w);
  }
  try { localStorage.setItem('dashWidgets', JSON.stringify(selectedWidgets)); } catch (e) {}
  // Jump the carousel to the widget we just toggled (so it actually shows up),
  // otherwise land on a valid index.
  const idx = selectedWidgets.indexOf(w);
  widgetIndex = idx >= 0 ? idx : Math.min(widgetIndex, selectedWidgets.length - 1);
  renderWidgets();
}

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('addWidgetBtn');
  const picker = document.getElementById('widgetPicker');

  renderWidgets();

  // + button opens the multi-select widget picker
  if (addBtn && picker) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    });
    picker.querySelectorAll('.wp-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWidget(item.dataset.widget); // stays open so several can be toggled
      });
    });
    document.addEventListener('click', (e) => {
      if (picker.style.display !== 'none' && !picker.contains(e.target) && e.target !== addBtn && !addBtn.contains(e.target)) {
        picker.style.display = 'none';
      }
    });
  }

  // Carousel arrow → advance to the next selected widget
  const nav = document.getElementById('widgetNav');
  if (nav) nav.addEventListener('click', (e) => { e.stopPropagation(); nextWidget(1); });

  // Two-finger (trackpad) horizontal swipe over the widget area also carousels.
  const widgetsCol = document.getElementById('dashWidgetsCol');
  if (widgetsCol) {
    let swipeAccum = 0, swipeCooldown = false;
    widgetsCol.addEventListener('wheel', (e) => {
      if (selectedWidgets.length < 2) return;
      // Only treat clearly-horizontal gestures as a swipe.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      e.stopPropagation();
      if (swipeCooldown) return;
      swipeAccum += e.deltaX;
      if (Math.abs(swipeAccum) > 60) {
        nextWidget(swipeAccum > 0 ? 1 : -1);
        swipeAccum = 0;
        swipeCooldown = true;
        setTimeout(() => { swipeCooldown = false; }, 450);
      }
    }, { passive: false });
  }

  // Stocks: Market / Watchlist dropdown
  const modeBtn = document.getElementById('stocksModeBtn');
  const modeMenu = document.getElementById('stocksModeMenu');
  if (modeBtn && modeMenu) {
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = modeMenu.style.display !== 'none';
      modeMenu.style.display = open ? 'none' : 'flex';
      modeBtn.classList.toggle('open', !open);
    });
    modeMenu.querySelectorAll('.sm-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        setStocksMode(item.dataset.mode);
        modeMenu.style.display = 'none';
        modeBtn.classList.remove('open');
      });
    });
    document.addEventListener('click', (e) => {
      if (modeMenu.style.display !== 'none' && !modeMenu.contains(e.target) && !modeBtn.contains(e.target)) {
        modeMenu.style.display = 'none';
        modeBtn.classList.remove('open');
      }
    });
  }

  // Watchlist add row
  const wlInput = document.getElementById('watchlistInput');
  const wlAddBtn = document.getElementById('watchlistAddBtn');
  const submitWl = () => {
    if (!wlInput) return;
    addToWatchlist(wlInput.value);
    wlInput.value = '';
    wlInput.focus();
  };
  if (wlAddBtn) wlAddBtn.addEventListener('click', (e) => { e.stopPropagation(); submitWl(); });
  if (wlInput) {
    wlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitWl(); }
      e.stopPropagation();
    });
    wlInput.addEventListener('click', (e) => e.stopPropagation());
  }
});

// --- FILE TRAY LOGIC ---
let dragLeaveTimer;

async function renderFileTray() {
  const files = await window.notchAPI.getTrayFiles();
  const dropzone = document.getElementById('ftDropzone');
  const emptyText = document.getElementById('ftEmptyText');
  
  dropzone.querySelectorAll('.ft-file').forEach(el => el.remove());
  
  if (files.length > 0) {
    emptyText.style.display = 'none';
  } else {
    emptyText.style.display = 'flex';
  }
  
  files.forEach(file => {
    const el = document.createElement('div');
    el.className = 'ft-file';
    el.draggable = true;
    
    const ext = file.name.split('.').pop().substring(0, 4);
    const isImg = file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    
    let innerHtml = '';
    if (file.isDir) {
      innerHtml = `<img src="../assets/folder.png" />`;
    } else if (isImg) {
      innerHtml = `<img src="file://${file.path.replace(/\\/g, '/')}" />`;
    } else if (file.icon) {
      innerHtml = `<img src="${file.icon}" />`;
    } else {
      innerHtml = `<span class="ft-file-ext">${ext}</span>`;
    }
    
    el.innerHTML = `
      <div class="ft-file-thumb-container">
        ${innerHtml}
      </div>
      <div class="ft-file-del">×</div>
      <div class="ft-file-name-label" title="${file.name}">${file.name}</div>
    `;
    
    const delBtn = el.querySelector('.ft-file-del');
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      await window.notchAPI.removeTrayFile(file.path);
      renderFileTray();
    };
    
    el.ondragstart = (e) => {
      e.preventDefault();
      window.notchAPI.startDragOut(file.path);
    };
    
    dropzone.appendChild(el);
  });
}

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('Files')) {
    isDragActive = true;
    clearTimeout(dragLeaveTimer);
    if (currentState !== 'file-tray') {
      currentState = 'file-tray';
      notch.setAttribute('data-state', 'file-tray');
      if (!isExpanded) {
        expand();
      } else {
        showActivePanel();
      }
      renderFileTray();
    }
    document.getElementById('ftDropzone').classList.add('drag-over');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  clearTimeout(dragLeaveTimer);
  // Highlight Quick Share icon when hovering over it
  const qsIcon = document.getElementById('quickShareIcon');
  if (qsIcon) {
    if (qsIcon.contains(e.target) || qsIcon === e.target) {
      qsIcon.style.background = 'rgba(66, 133, 244, 0.4)';
      qsIcon.style.transform = 'scale(1.1)';
      qsIcon.style.transition = 'all 0.2s ease';
    } else {
      qsIcon.style.background = '';
      qsIcon.style.transform = '';
    }
  }
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  const dropzone = document.getElementById('ftDropzone');
  if(dropzone) dropzone.classList.remove('drag-over');
  const qsIcon = document.getElementById('quickShareIcon');
  if (qsIcon) {
    qsIcon.style.background = '';
    qsIcon.style.transform = '';
  }
  
  dragLeaveTimer = setTimeout(() => {
    isDragActive = false;
    if (currentState === 'file-tray') {
      collapse();
    }
  }, 300);
});

document.addEventListener('dragend', () => {
  isDragActive = false;
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  isDragActive = false;
  document.getElementById('ftDropzone').classList.remove('drag-over');
  const qsIcon = document.getElementById('quickShareIcon');
  if (qsIcon) {
    qsIcon.style.background = '';
    qsIcon.style.transform = '';
  }
  
  const files = [];
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    for (const f of e.dataTransfer.files) {
      files.push(f.path);
    }
  } else if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
    for (const item of e.dataTransfer.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f.path);
      }
    }
  }
  
  console.log('[App] Drop event detected! Files length:', files.length, 'Files:', files);
  
  // Check if drop landed on the Quick Share area
  const qsArea = document.querySelector('.ft-left');
  const isQuickShareDrop = qsArea && (qsArea.contains(e.target) || qsArea === e.target);
  console.log('[App] isQuickShareDrop:', isQuickShareDrop, 'Target:', e.target.className);
  
  // Handle routing based on drop target
  if (files.length > 0) {
    if (isQuickShareDrop) {
      console.log('[App] Sharing files via Quick Share (document listener):', files);
      // Store the file in the tray so they can drag it from the notch
      await window.notchAPI.storeFiles(files);
      renderFileTray();
      // Open Quick Share app
      await window.notchAPI.shareFiles(files);
    } else {
      console.log('[App] Storing files in file tray:', files);
      await window.notchAPI.storeFiles(files);
      renderFileTray();
    }
  }
  
  if (!isQuickShareDrop) {
    setTimeout(() => {
      if (currentState === 'file-tray') {
        collapse();
      }
    }, 2000);
  }
});

  // (Explicit quick share icon listeners removed to unify logic in the document drop handler)
if (window.notchAPI.onOpenFileTray) {
  window.notchAPI.onOpenFileTray(() => {
    console.log('[App] Tray icon clicked — opening file tray. Current state:', currentState, 'isExpanded:', isExpanded);
    if (currentState === 'file-tray' && isExpanded) {
      // Already showing file tray — toggle it closed
      collapse();
      return;
    }
    currentState = 'file-tray';
    notch.setAttribute('data-state', 'file-tray');
    if (!isExpanded) {
      expand();
    } else {
      showActivePanel();
    }
    renderFileTray();
  });
}

// Show toast when share is initiated
if (window.notchAPI.onShareInitiated) {
  window.notchAPI.onShareInitiated((paths) => {
    console.log('[App] Share initiated for:', paths);
    // Show a brief visual confirmation on the Quick Share icon
    const qsIcon = document.getElementById('quickShareIcon');
    if (qsIcon) {
      qsIcon.style.background = 'rgba(34, 197, 94, 0.4)';
      qsIcon.style.transform = 'scale(1.15)';
      qsIcon.style.transition = 'all 0.3s ease';
      setTimeout(() => {
        qsIcon.style.background = '';
        qsIcon.style.transform = '';
      }, 1500);
    }
  });
}




if (panelMsgMini) {
  panelMsgMini.addEventListener('click', (e) => {
    e.stopPropagation();
    currentState = 'msg-expanded';
    notch.setAttribute('data-state', 'msg-expanded');
    showActivePanel();
    document.getElementById('msgReplyInput').focus();
  });
}

if (window.notchAPI && window.notchAPI.onMockMessage) {
  window.notchAPI.onMockMessage(() => {
    // Don't interrupt startup animation
    if (currentState === 'startup') return;

    currentState = 'msg-mini';
    notch.setAttribute('data-state', 'msg-mini');
    ignoreMouseLeave = true;
    setTimeout(() => { ignoreMouseLeave = false; }, 300);
    if (!isExpanded) expand();
    else showActivePanel();
  });
}

if (window.notchAPI && window.notchAPI.onLiveMessage) {
    window.notchAPI.onLiveMessage((data) => {
      // Don't interrupt startup animation
      if (currentState === 'startup') return;

      // Update DOM with real message data
      const nameEl = document.querySelectorAll('.msg-name');
      const textEl = document.querySelector('.msg-text');
      const textExpEl = document.querySelector('.msg-exp-text');
      const appIcon = document.querySelector('.msg-app-icon');
      const appIconSmall = document.querySelector('.msg-app-icon-small');
      const avatarEls = document.querySelectorAll('.msg-avatar');
      if (avatarEls && data.avatar) {
        avatarEls.forEach(el => el.src = data.avatar);
      }
      
      if (nameEl) nameEl.forEach(el => el.textContent = data.sender || 'Unknown Sender');
      if (textEl) textEl.textContent = data.text || 'New message...';
      if (textExpEl) textExpEl.textContent = data.text || 'New message...';

      // A reply typed from here should go back to whoever just texted.
      activeReplyContext = { sender: data.sender || null, app: data.app || null };

      if (appIcon && data.app === 'gchat') {
        appIcon.style.background = '#00897B'; // Gchat green
        if (appIconSmall) appIconSmall.style.background = '#00897B';
      } else if (appIcon) {
        appIcon.style.background = '#34c759'; // Messages green
        if (appIconSmall) appIconSmall.style.background = '#34c759';
      }
      
      // Trigger UI
      currentState = 'msg-mini';
      notch.setAttribute('data-state', 'msg-mini');
      ignoreMouseLeave = true;
      setTimeout(() => { ignoreMouseLeave = false; }, 300);
      if (!isExpanded) expand();
      else showActivePanel();
      
      // Auto-collapse after 5 seconds if not hovered
      if (window.msgCollapseTimeout) clearTimeout(window.msgCollapseTimeout);
      window.msgCollapseTimeout = setTimeout(() => {
        if (!isMouseOverNotch && currentState === 'msg-mini') {
          collapse();
          setTimeout(decideState, 350);
        }
      }, 5000);
    });

    const replyInput = document.getElementById('msgReplyInput');
    const replyBtn = document.getElementById('msgReplySendBtn');
    const replyAttach = document.getElementById('msgReplyAttach');
    
    function handleSendReply() {
      if (replyInput && replyInput.value.trim() !== '') {
        const text = replyInput.value.trim();
        if (window.notchAPI && window.notchAPI.sendReply) {
          window.notchAPI.sendReply({
            text,
            sender: activeReplyContext ? activeReplyContext.sender : null,
            app: activeReplyContext ? activeReplyContext.app : null
          });
        }
        replyInput.value = '';
        if (window.msgCollapseTimeout) {
          clearTimeout(window.msgCollapseTimeout);
          window.msgCollapseTimeout = null;
        }
        collapse();
        setTimeout(decideState, 350);
      }
    }

    if (replyAttach) {
      replyAttach.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.notchAPI && window.notchAPI.selectAttachment) {
          const files = await window.notchAPI.selectAttachment();
          if (files && files.length > 0) {
            console.log('[App] Selected attachment:', files);
            if (window.notchAPI && window.notchAPI.sendReply) {
              window.notchAPI.sendReply({
                attachment: files[0],
                sender: activeReplyContext ? activeReplyContext.sender : null,
                app: activeReplyContext ? activeReplyContext.app : null
              });
            }
          }
        }
      });
    }

    if (replyInput) {
      replyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSendReply();
      });
    }
    if (replyBtn) {
      replyBtn.addEventListener('click', handleSendReply);
    }
  }

  /* ─── Quick Launch ─── */
  let quickLaunchItems = [];

  function renderQuickLaunch() {
    const squares = document.querySelectorAll('.ql-square');
    squares.forEach((sq, idx) => {
      const item = quickLaunchItems[idx];
      if (item && item.icon) {
        sq.innerHTML = `<img src="${item.icon}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; pointer-events: none;" />` +
          `<button class="ql-delete" title="Remove from Quick Start" aria-label="Remove from Quick Start"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
        sq.dataset.appPath = item.path || '';
        sq.dataset.hasApp = 'true';
      } else {
        sq.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        sq.dataset.appPath = '';
        sq.dataset.hasApp = 'false';
      }
    });
  }

  async function loadQuickLaunch() {
    if (window.notchAPI && window.notchAPI.loadQuickLaunch) {
      quickLaunchItems = await window.notchAPI.loadQuickLaunch();
      renderQuickLaunch();
    }
  }

  async function saveQuickLaunch() {
    if (window.notchAPI && window.notchAPI.saveQuickLaunch) {
      await window.notchAPI.saveQuickLaunch(quickLaunchItems);
    }
  }

  function resetQuickLaunchSquares() {
    quickLaunchItems = [];
    renderQuickLaunch();
  }

  function removeQuickLaunchItem(index) {
    quickLaunchItems[index] = null;
    saveQuickLaunch();
    renderQuickLaunch();
  }

  let appPickerModal = null;

  async function showAppPicker(targetIndex) {
    if (appPickerModal) return;
    
    let apps = [];
    if (window.notchAPI && window.notchAPI.getInstalledApps) {
      apps = await window.notchAPI.getInstalledApps();
    }
    
    if (!apps.length) return;

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'appPickerModal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(12px);
    `;
    
    const container = document.createElement('div');
    container.style.cssText = `
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 20px;
      padding: 20px;
      max-width: 90vw;
      max-height: 80vh;
      width: 520px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.1);
    `;
    
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    `;
    header.innerHTML = `<span style="color:#fff;font-weight:600;font-size:15px;letter-spacing:0.3px;">Select an App</span><div style="display:flex;align-items:center;gap:4px;"><button id="clearAppSlot" style="background:none;border:none;color:rgba(255,255,255,0.5);font-size:12px;font-weight:600;cursor:pointer;padding:4px 10px;border-radius:8px;transition:all 0.15s;" onmouseover="this.style.color='#ff453a';this.style.background='rgba(255,69,58,0.12)'" onmouseout="this.style.color='rgba(255,255,255,0.5)';this.style.background='none'">Clear</button><button id="closeAppPicker" style="background:none;border:none;color:rgba(255,255,255,0.6);font-size:22px;cursor:pointer;padding:4px 8px;line-height:1;border-radius:8px;transition:all 0.15s;" onmouseover="this.style.color='#fff';this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.color='rgba(255,255,255,0.6)';this.style.background='none'">×</button></div>`;
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search apps...';
    searchInput.style.cssText = `
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(0,0,0,0.3);
      color: #fff;
      font-size: 14px;
      margin-bottom: 16px;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    `;
    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = 'rgba(79,168,255,0.5)';
      searchInput.style.boxShadow = '0 0 0 3px rgba(79,168,255,0.2)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = 'rgba(255,255,255,0.1)';
      searchInput.style.boxShadow = 'none';
    });
    
    const list = document.createElement('div');
    list.id = 'appPickerList';
    list.style.cssText = `
      max-height: 55vh;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
      padding-right: 4px;
    `;
    
    function renderApps(filter = '') {
      list.innerHTML = '';
      const filtered = apps.filter(a => 
        a.name.toLowerCase().includes(filter.toLowerCase())
      ).slice(0, 120);
      
      filtered.forEach(app => {
        const item = document.createElement('div');
        item.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px 8px;
          border-radius: 12px;
          background: rgba(255,255,255,0.04);
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid rgba(255,255,255,0.05);
        `;
        item.innerHTML = `
          <div style="width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;overflow:hidden;">
            <img src="${app.icon || ''}" alt="" style="width:32px;height:32px;border-radius:8px;object-fit:contain;${!app.icon ? 'display:none' : ''}" onerror="this.style.display='none';this.parentElement.style.background='rgba(255,255,255,0.08)'">
          </div>
          <span style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.9);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;line-height:1.2;">${app.name}</span>
        `;
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(255,255,255,0.1)';
          item.style.borderColor = 'rgba(79,168,255,0.3)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'rgba(255,255,255,0.04)';
          item.style.borderColor = 'rgba(255,255,255,0.05)';
        });
        item.addEventListener('click', () => {
          closePicker();
          selectApp(app);
        });
        list.appendChild(item);
      });
    }
    
    function closePicker() {
      if (appPickerModal) {
        appPickerModal.remove();
        appPickerModal = null;
      }
    }
    
    function selectApp(app) {
      if (!app.path) return;
      let iconDataUrl = app.icon;
      if (!iconDataUrl && window.notchAPI.getAppIcon) {
        window.notchAPI.getAppIcon(app.path).then(icon => {
          if (icon) {
            quickLaunchItems[targetIndex] = { path: app.path, icon };
            saveQuickLaunch();
            renderQuickLaunch();
          }
        });
      } else {
        quickLaunchItems[targetIndex] = { path: app.path, icon: iconDataUrl };
        saveQuickLaunch();
        renderQuickLaunch();
      }
    }
    
    searchInput.addEventListener('input', (e) => renderApps(e.target.value));
    header.querySelector('#closeAppPicker').addEventListener('click', closePicker);
    header.querySelector('#clearAppSlot').addEventListener('click', () => {
      quickLaunchItems[targetIndex] = null;
      saveQuickLaunch();
      renderQuickLaunch();
      closePicker();
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closePicker(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { closePicker(); document.removeEventListener('keydown', esc); } });
    
    container.append(header, searchInput, list);
    modal.appendChild(container);
    document.body.appendChild(modal);
    appPickerModal = modal;
    searchInput.focus();
    renderApps();
  }

  async function handleQuickLaunchClick(sq) {
    const hasApp = sq.dataset.hasApp === 'true';
    const appPath = sq.dataset.appPath;
    const index = parseInt(sq.dataset.index, 10);

    if (hasApp && appPath) {
      // Bring the already-running app back to the front if it has one,
      // otherwise start it fresh — "exactly where you left off".
      if (window.notchAPI && window.notchAPI.focusOrLaunchApp) {
        await window.notchAPI.focusOrLaunchApp(appPath);
      } else if (window.notchAPI && window.notchAPI.launchApp) {
        await window.notchAPI.launchApp(appPath);
      }
      return;
    }

    await pinCurrentAppToSquare(index, sq);
  }

  // Pins whatever app the user was on right before clicking the notch
  // into this square. Relies on main.js tracking the last foreground
  // window (the notch itself is non-focusable so it never steals that).
  async function pinCurrentAppToSquare(index, sq) {
    if (!window.notchAPI || !window.notchAPI.getForegroundApp) return;

    sq.classList.add('ql-pinning');
    try {
      const current = await window.notchAPI.getForegroundApp();
      if (!current || !current.path) return;

      const icon = window.notchAPI.getAppIcon ? await window.notchAPI.getAppIcon(current.path) : null;
      if (!icon) return;

      quickLaunchItems[index] = { path: current.path, icon, name: current.name || '' };
      saveQuickLaunch();
      renderQuickLaunch();
    } finally {
      sq.classList.remove('ql-pinning');
    }
  }

  function setupQuickLaunch() {
    const squares = document.querySelectorAll('.ql-square');
    squares.forEach(sq => {
      sq.addEventListener('click', (e) => {
        e.stopPropagation();
        // Clicking the red X removes the pinned app instead of launching it.
        if (e.target.closest('.ql-delete')) {
          const index = parseInt(sq.dataset.index, 10);
          removeQuickLaunchItem(index);
          return;
        }
        handleQuickLaunchClick(sq);
      });
      // Right-click still opens the full searchable app picker, in case
      // the app you want pinned isn't the one currently in front.
      sq.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(sq.dataset.index, 10);
        showAppPicker(index);
      });
    });

    loadQuickLaunch();
  }

// ═══ APPLE BOOT CHIME ═══
function playAppleBootChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const duration = 4.0;
    
    // Apple Mac startup sound is a synthesized F# Major chord with a lot of depth
    const freqs = [
      46.25,  // F#1
      92.50,  // F#2
      138.59, // C#3
      185.00, // F#3
      233.08, // A#3
      277.18, // C#4
      369.99  // F#4
    ];
    
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    
    // Quick attack, long decay
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.1);
    masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      // Mix of sine and triangle for that organ-like depth
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      
      const panner = ctx.createStereoPanner();
      panner.pan.value = (i % 2 === 0) ? -0.3 : 0.3; // spread out the sound
      
      osc.connect(panner);
      panner.connect(masterGain);
      
      osc.start();
      osc.stop(ctx.currentTime + duration);
    });
  } catch (e) {
    console.warn("Audio chime failed:", e);
  }
}

// ═══ STARTUP SEQUENCE ═══
function runStartupSequence() {
  currentState = 'startup';
  notch.setAttribute('data-state', 'startup');

  // Hide the collapsed bar so it doesn't peek through
  const collapsedView = document.getElementById('collapsedView');
  if (collapsedView) collapsedView.style.display = 'none';

  // Warm the hello animation now — it isn't needed until phase 4, and fetching
  // it cold there stalled the morph on slow starts.
  fetch('../assets/hello-white.json').catch(() => {});

  // Get references
  const panel = document.getElementById('panelStartup');
  const intro = document.getElementById('startupIntro');
  const hello = document.getElementById('startupHello');

  // Hide all other panels first
  hideAllPanels();

  // Show startup panel manually (don't use showActivePanel — it resets height)
  if (panel) {
    panel.style.display = 'flex';
    panel.style.opacity = '1';
  }

  // Phase 1: Expand notch to banner size for the image
  notch.classList.remove('collapsed');
  notch.classList.add('expanded');
  isExpanded = true;
  window.notchAPI.setIgnoreMouse(false);

  // Force the banner dimensions directly
  requestAnimationFrame(() => {
    notch.style.width = '800px';
    notch.style.height = '200px';
    notch.style.borderRadius = '0 0 32px 32px';

    // Phase 2: After a beat, play boot sound and fade in image
    setTimeout(() => {
      playAppleBootChime();
      if (intro) intro.style.opacity = '1';
    }, 320);

    // Phase 3: Fade out image
    setTimeout(() => {
      if (intro) intro.style.opacity = '0';
    }, 3100);

    // Phase 4: Shrink notch and play hello animation
    setTimeout(() => {
      if (intro) intro.style.display = 'none';

      // Morph to widget-shaped notch for hello (wide and short)
      notch.style.width = '520px';
      notch.style.height = '140px';
      notch.style.borderRadius = '0 0 32px 32px';

      // Show hello after the morph transition settles
      setTimeout(() => {
        if (hello) hello.style.opacity = '1';

        const lottieContainer = document.getElementById('lottieContainer');
        if (lottieContainer && window.lottie) {
          window.lottie.loadAnimation({
            container: lottieContainer,
            renderer: 'svg',
            loop: false,
            autoplay: true,
            path: '../assets/hello-white.json'
          });
        }
      }, 420);
    }, 3900);

    // Phase 5: Fade out hello, then show normal expanded notch
    setTimeout(() => {
      if (hello) hello.style.opacity = '0';

      setTimeout(() => {
        // Clean up startup state
        currentState = 'idle';
        notch.classList.remove('boot');
        notch.setAttribute('data-state', 'idle');
        notch.style.width = '';
        notch.style.height = '';
        notch.style.borderRadius = '';

        // Hide startup panel
        if (panel) {
          panel.style.opacity = '0';
          panel.style.display = 'none';
        }

        // Restore collapsed bar
        if (collapsedView) collapsedView.style.display = '';

        // Show normal expanded notch
        forcedPanel = null;
        showActivePanel();
        decideState();
      }, 520);
    }, 7100);
  });
}

document.addEventListener('DOMContentLoaded', runStartupSequence);

