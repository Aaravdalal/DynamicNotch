/* ═══════════════════════════════════════
   Dynamic Notch — Core Logic (Rebuild)
   ═══════════════════════════════════════ */

let isExpanded = false;
let hoverTimeout = null;
let currentState = 'idle';
let mediaData = { playing: false };
let wasCharging = null;
let showedLowBattery = false;
let battToastTimeout = null;
let battToastState = null; // which battery pill the toast is showing
let calendarOffset = 0;
let progressInterval = null;
let fakePct = 0;
let visualizerInterval = null;
let forcedPanel = null; // override for expansion
let isDragActive = false;
let isMouseOverNotch = false;
let ignoreMouseLeave = false;
let reenterGuard = false; // brief lockout so collapsing doesn't instantly re-expand
let collapseTimeout = null; // hover-intent buffer so a quick mouse flick-out doesn't collapse
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

/* ─── Panel map ─── */
const panelMap = {
  idle:            'panelIdle',
  hover:           'panelHoverToggles',
  music:           'panelMusic',
  timer:           'panelTimer',
  charging:        'panelCharging',
  unplugged:       'panelUnplugged',
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

  // A title set while its panel was hidden couldn't be measured; now that the
  // panel is shown, re-check whether it needs to scroll.
  requestAnimationFrame(refreshMarquees);
}

function setState(s) {
  console.log('[App] Setting State:', s);
  currentState = s;
  notch.dataset.state = s;
  if (isExpanded) showActivePanel(); else hideAllPanels();
}

function decideState() {
  if (forcedPanel === 'panelSlider' || forcedPanel === 'panelDnd') return; // Don't override forced state
  if (forcedPanel === 'panelTimer') return; // "Time's up" hold owns the notch
  if (currentState === 'file-tray' || currentState === 'video' || currentState === 'camera') return; // Don't override active states
  if (currentState === 'tasks' || currentState === 'timer-setup') return; // User is editing tasks / picking a duration
  if (currentState === 'msg-mini' || currentState === 'msg-expanded' || currentState === 'unreads' || currentState === 'startup') return; // Protect message and startup states

  let s = 'idle';
  if (isTimerActive) s = 'timer';
  // Only take over the collapsed pill — never hijack an already-expanded panel.
  else if (downloadActive && !isExpanded) s = 'download';
  // Use the specific toast state — a generic 'battery' has no panel in
  // panelMap, so a background poll mid-toast would blank the notch.
  else if (battToastTimeout) s = battToastState || 'charging';
  else if (mediaData.playing || mediaData.paused) s = 'music';
  else if (unreadList.length > 0) s = 'unreads';
  
  setState(s);

  // A running timer keeps its full panel (pause / ✕ / countdown) on screen.
  if (s === 'timer') {
    if (!isExpanded) expand();
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
  decideState();
}

function collapse() {
  if (!isExpanded) return;
  if (currentState === 'startup') return; // Force keep expanded
  if (alarmActive) return; // Ringing timer stays open so the ✕ is always reachable
  if (currentState === 'timer' && isTimerActive) return; // Running timer keeps its full panel
  // A widget mid-turn has a card lifted to position:absolute with pending timers
  // up to ~600ms out. Collapsing under that left the pinned card hanging out of
  // the shrunken notch — the "big laggy black notch" — until the timers fired.
  // Snap the carousel back to rest so the notch collapses clean.
  resetWidgetTurn();
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
  
  decideState();
}

// ─── Hover-intent collapse ───
// A quick flick of the cursor off the notch and straight back used to fire a
// full collapse→expand cycle mid-transition, so wiggling in/out a few times made
// the notch jitter between sizes. Instead of collapsing the instant the mouse
// leaves, arm a short timer; any re-entry cancels it, so a genuine exit still
// collapses (~70ms later, imperceptible) but a wiggle just keeps it open.
function cancelPendingCollapse() {
  if (collapseTimeout) { clearTimeout(collapseTimeout); collapseTimeout = null; }
}

function commitCollapse() {
  collapseTimeout = null;
  if (!isExpanded) return;
  // If we expanded from msg-mini state, return to msg-mini instead of idle
  if (currentState === 'msg-expanded' && wasMsgMiniBeforeExpand) {
    currentState = 'msg-mini';
    wasMsgMiniBeforeExpand = false;
  }
  if (currentState === 'unreads') currentState = 'idle';
  collapse();
  if (currentState === 'idle') {
    reenterGuard = true;
    setTimeout(() => { reenterGuard = false; }, 80);
  }
}

function scheduleCollapse() {
  if (collapseTimeout) return;
  collapseTimeout = setTimeout(commitCollapse, 70);
}

// ─── Wide music dashboard (opened from the mini-player caret) ───
// Opening/closing it springs the notch between the compact 370px player and the
// 820px dashboard. The incoming panel is laid out at the full width, so if it's
// revealed while the notch is still narrow its contents reflow and "stretch" as
// the notch grows. Hide the panels for the length of the resize (via .resizing-full)
// and fade the correct one in once the notch has essentially reached its size.
let fullRevealTimer = null;
function setMusicDashboard(open) {
  if (open) { forcedPanel = 'panelIdle'; notch.classList.add('forced-full'); }
  else { forcedPanel = null; notch.classList.remove('forced-full'); }
  notch.classList.add('resizing-full');
  showActivePanel();
  clearTimeout(fullRevealTimer);
  fullRevealTimer = setTimeout(() => notch.classList.remove('resizing-full'), 300);
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
  // The mouse is back over the notch — kill any pending collapse from a flick-out.
  cancelPendingCollapse();
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
  // Keep the notch open while the user is actively typing, even if the mouse
  // drifts off. Only half-written text earns that though — an input that was
  // merely clicked and left empty used to hold focus forever, which is why the
  // notch would refuse to collapse until you clicked somewhere else.
  const holdsFocus = (el) => {
    if (!el || document.activeElement !== el) return false;
    if (el.value.trim() !== '') return true;
    el.blur();
    return false;
  };
  if (holdsFocus(document.getElementById('dashSearchInput'))) return;
  if (holdsFocus(document.getElementById('msgReplyInput'))) return;
  if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
  if (currentState === 'file-tray' && isDragActive) return;
  if (currentState === 'camera') return; // Camera stays open until explicitly closed
  if (alarmActive) return; // Ringing timer stays open until dismissed
  // Tasks / timer picker close via their own buttons — a stray mouse drift while
  // typing a task or spinning a wheel must not throw the panel away.
  if (currentState === 'tasks' || currentState === 'timer-setup') return;
  if (isDraggingSlider) return; // Don't collapse while dragging the vol/bright slider
  // The volume/brightness HUD and the DND toast own the notch and dismiss
  // themselves on a timer. Expanding the slider makes the notch interactive, so
  // a stray mouse-leave here used to collapse it a frame after it appeared —
  // the flicker where the HUD vanished instead of holding over the song.
  if (forcedPanel === 'panelSlider' || forcedPanel === 'panelDnd') return;
  if (ignoreMouseLeave) return;

  if (isExpanded) {
    // Debounced so a quick out-and-back-in cancels the collapse (see
    // scheduleCollapse) instead of firing a full collapse→expand cycle.
    scheduleCollapse();
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
    // Any movement that lands inside the notch cancels a pending collapse, so a
    // wiggle that never fully leaves keeps the panel open (see scheduleCollapse).
    if (inBounds) cancelPendingCollapse();
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

  // Safety net for the collapse. mousemove and mouseleave are not delivered
  // reliably once the pointer crosses out of the window — flick the cursor away
  // fast, or move it into another app, and the last event the page sees is
  // still inside the notch, so it never learns the mouse left and stays open.
  // Main polls the real cursor and pushes it here; we run the same hit test the
  // mousemove path does, so a leave can't be missed regardless of event delivery.
  if (window.notchAPI.onCursorPos) {
    window.notchAPI.onCursorPos(({ x, y }) => {
      if (!isExpanded) return;
      lastMouseX = x;
      lastMouseY = y;
      if (isMouseOverNotchBounds({ clientX: x, clientY: y }, true)) {
        isMouseOverNotch = true;
        cancelPendingCollapse();
      } else {
        handleNotchLeave();
      }
    });
  }
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

  const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let isLocalPaused = false;
  function handleMediaAction(action, e) {
    if (e) e.stopPropagation();
    
    let controlledIframe = false;
    if (typeof mediaData !== 'undefined' && mediaData && mediaData.source === 'YouTube') {
      const iframes = ['mainYtIframe'];
      for (let id of iframes) {
        const iframe = document.getElementById(id);
        if (iframe && iframe.src && iframe.style.display !== 'none' && iframe.contentWindow) {
          if (action === 'playpause') {
            // Ask the player what it is doing rather than toggling a local
            // flag, which drifted every time playback changed behind our back
            // (a video ending, an ad, or the PiP controls being used instead).
            const func = pipState.playing ? 'pauseVideo' : 'playVideo';
            isLocalPaused = pipState.playing;
            iframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: func}), '*');
            setTimeout(pipSubscribe, 60);
          } else if (action === 'next' || action === 'prev') {
            const delta = action === 'next' ? 10 : -10;
            const target = Math.max(0, pipState.duration
              ? Math.min(pipState.duration, pipState.time + delta)
              : pipState.time + delta);
            iframe.contentWindow.postMessage(JSON.stringify({
              event: 'command', func: 'seekTo', args: [target, true]
            }), '*');
            pipState.time = target;
            pipPaint();
            setTimeout(pipSubscribe, 60);
          }
          controlledIframe = true;
          break; // only control the visible one
        }
      }
    }
    
    if (!controlledIframe) {
      const isYouTube = typeof mediaData !== 'undefined' && mediaData && mediaData.source === 'YouTube';
      if (isYouTube && (action === 'next' || action === 'prev')) {
        // A YouTube video isn't a playlist — skip-track makes no sense, so the
        // "prev/next" buttons scrub ±10 seconds instead (matching the PiP player).
        const delta = action === 'next' ? 10 : -10;
        let target = currentElapsed() + delta;
        if (target < 0) target = 0;
        const durSec = (mediaData.durationMs || 0) / 1000;
        if (durSec > 0) target = Math.min(durSec, target);
        window.notchAPI.seekMedia(Math.round(target * 1000));
        // Move the scrubber optimistically; it re-syncs on the next SMTC tick.
        posBaseSec = target;
        posBaseAt = Date.now();
        const dur = musicDuration > 0 ? musicDuration : durSec;
        updateScrubberUI(dur > 0 ? (target / dur) * 100 : 0, target, dur);
      } else {
        // Spotify / background browser tabs, and YouTube play/pause: control the
        // real SMTC session (reliable, targets the exact player).
        window.notchAPI.controlMedia(action);
        if (action === 'playpause') isLocalPaused = !isLocalPaused;
      }
    }
    
    if (action === 'playpause') {
      if (typeof mediaData !== 'undefined' && mediaData) mediaData.paused = isLocalPaused;
      const playSvg = document.querySelector('#playBtn svg');
      const dashPlayBtnSvg = document.querySelector('#dashPlayBtn svg');
      if (isLocalPaused) {
        if(typeof stopVisualizer === 'function') stopVisualizer();
        if (playSvg) playSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
        if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      } else {
        if(typeof startVisualizer === 'function') startVisualizer();
        if (playSvg) playSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
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
      setMusicDashboard(true);
    });
  }





  const closeVideoBtn = document.getElementById('closeVideoBtn');
  if (closeVideoBtn) {
    closeVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePipVideo();
      
      // Return to music panel (or idle depending on if music is playing)
      currentState = mediaData.playing ? 'music' : 'idle';
      notch.setAttribute('data-state', currentState);
      showActivePanel();
    });
  }

  // Star buttons: the icon (star vs PiP glyph) and the saved-state fill are
  // driven by the module-level updateStarButtons(); the click handlers below
  // save to Liked Songs (music) or open PiP (YouTube video).

  const pStar = document.getElementById('shuffleBtn'); // panelMusic star
  if(pStar) pStar.addEventListener('click', (e) => {
    e.stopPropagation();
    const hasVideo = hasPipVideo();
    if (hasVideo) {
      // Open PiP Notch Player
      forcedPanel = null;
      notch.classList.remove('forced-full');
      currentState = 'video';
      notch.setAttribute('data-state', 'video');
      showActivePanel();
      openPipVideo(mediaData.videoId, mediaData.track || mediaData.title, mediaData.artist, mediaData.artUrl);
    } else {
      // Music (no video): save/unsave the song in the Liked Songs playlist.
      const liked = toggleLikedSong();
      applyStarFill(document.getElementById('shuffleBtn'), liked);
      applyStarFill(document.getElementById('dashStarBtn'), liked);
    }
  });

  const dStar = document.getElementById('dashStarBtn'); // dashMusic star
  if(dStar) dStar.addEventListener('click', (e) => {
    e.stopPropagation();
    const hasVideo = hasPipVideo();
    if (hasVideo) {
      // Open PiP Notch Player
      forcedPanel = null;
      notch.classList.remove('forced-full');
      currentState = 'video';
      notch.setAttribute('data-state', 'video');
      showActivePanel();
      openPipVideo(mediaData.videoId, mediaData.track || mediaData.title, mediaData.artist, mediaData.artUrl);
    } else {
      // Music (no video): save/unsave the song in the Liked Songs playlist.
      const liked = toggleLikedSong();
      applyStarFill(document.getElementById('shuffleBtn'), liked);
      applyStarFill(document.getElementById('dashStarBtn'), liked);
    }
  });

  // Call updateStarButtons initially and whenever mediaData changes
  // We'll call it from updateMusicUI

  setupScrubberDrag();

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
        // Music playing: collapse the wide dashboard back to the compact player
        // without the reverse reflow-stretch.
        setMusicDashboard(false);
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

const newTaskId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);

// One checklist row. Apple Notes edits in place — every line is a live text
// field rather than something you retype in a separate box — so the row owns
// its own input and writes straight back to the task.
function buildTaskRow(task) {
  const row = document.createElement('div');
  row.className = 'task-row' + (task.done ? ' done' : '');
  row.dataset.id = task.id;

  const check = document.createElement('button');
  check.className = 'task-check';
  check.type = 'button';
  check.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
  check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  check.addEventListener('click', e => {
    e.stopPropagation();
    task.done = !task.done;
    saveTasks();
    row.classList.toggle('done', task.done);
    check.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
    updateTasksCount();
  });

  const text = document.createElement('input');
  text.className = 'task-text';
  text.type = 'text';
  text.value = task.text;
  text.maxLength = 120;
  text.spellcheck = false;
  text.addEventListener('input', () => { task.text = text.value; saveTasks(); });
  text.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      // Enter opens a fresh line right below, as it does in Notes.
      e.preventDefault();
      const at = tasks.findIndex(t => t.id === task.id);
      const fresh = { id: newTaskId(), text: '', done: false };
      tasks.splice(at + 1, 0, fresh);
      saveTasks();
      renderTasks();
      focusTask(fresh.id);
    } else if (e.key === 'Backspace' && text.value === '') {
      // Backspace on an empty line deletes it and puts the caret on the one
      // above, so a row added by mistake takes one keystroke to undo.
      e.preventDefault();
      const at = tasks.findIndex(t => t.id === task.id);
      const prev = tasks[at - 1];
      tasks.splice(at, 1);
      saveTasks();
      renderTasks();
      if (prev) focusTask(prev.id, true); else focusDraft();
    } else if (e.key === 'Escape') {
      closeTasksPanel();
    }
  });

  const del = document.createElement('button');
  del.className = 'task-del';
  del.type = 'button';
  del.title = 'Delete';
  del.setAttribute('aria-label', 'Delete item');
  del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  del.addEventListener('click', e => {
    e.stopPropagation();
    tasks = tasks.filter(t => t.id !== task.id);
    saveTasks();
    renderTasks();
  });

  row.append(check, text, del);
  return row;
}

// The always-present empty line at the bottom of a Notes checklist: its hollow
// circle and caret are what invite the next item, so there's no "add" button.
function buildDraftRow() {
  const row = document.createElement('div');
  row.className = 'task-row task-draft';

  const check = document.createElement('span');
  check.className = 'task-check';

  const input = document.createElement('input');
  input.className = 'task-text';
  input.id = 'taskDraftInput';
  input.type = 'text';
  input.placeholder = tasks.length ? '' : 'Add an item';
  input.maxLength = 120;
  input.spellcheck = false;
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (!text) return;
      tasks.push({ id: newTaskId(), text, done: false });
      input.value = '';
      saveTasks();
      renderTasks();
      focusDraft();   // stay put so items can be typed one after another
    } else if (e.key === 'Backspace' && input.value === '' && tasks.length) {
      e.preventDefault();
      focusTask(tasks[tasks.length - 1].id, true);
    } else if (e.key === 'Escape') {
      closeTasksPanel();
    }
  });

  row.append(check, input);
  return row;
}

function focusTask(id, caretToEnd) {
  const el = document.querySelector('.task-row[data-id="' + id + '"] .task-text');
  if (!el) return;
  el.focus();
  if (caretToEnd) el.setSelectionRange(el.value.length, el.value.length);
}

function focusDraft() {
  const el = document.getElementById('taskDraftInput');
  if (el) el.focus();
}

function updateTasksCount() {
  const count = document.getElementById('tasksCount');
  if (!count) return;
  const left = tasks.filter(t => !t.done).length;
  count.textContent = left === 1 ? '1 left' : left + ' left';
}

function renderTasks() {
  const list = document.getElementById('tasksList');
  const panel = document.getElementById('panelTasks');
  if (!list || !panel) return;

  list.innerHTML = '';
  tasks.forEach(task => list.appendChild(buildTaskRow(task)));
  list.appendChild(buildDraftRow());

  panel.classList.toggle('is-empty', tasks.length === 0);
  updateTasksCount();
  layoutTasksPanel();
}

// The notch hugs its content: header, plus one row per item and the trailing
// empty line. Beyond TASKS_MAX_ROWS the list scrolls instead of growing.
const TASKS_BASE_H = 74;    // panel padding + header
const TASKS_ROW_H = 30;
const TASKS_ROW_GAP = 2;
const TASKS_MAX_ROWS = 6;   // includes the draft row

function layoutTasksPanel() {
  if (currentState !== 'tasks') return;
  const rows = Math.min(tasks.length + 1, TASKS_MAX_ROWS);
  notch.style.height = (TASKS_BASE_H + rows * TASKS_ROW_H + (rows - 1) * TASKS_ROW_GAP) + 'px';
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

function setupTasksPanel() {
  const closeBtn = document.getElementById('tasksCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); closeTasksPanel(); });

  // Clicking empty space below the list drops the caret on the next line, the
  // way tapping under a note's last row does.
  const list = document.getElementById('tasksList');
  if (list) {
    list.addEventListener('click', e => { if (e.target === list) focusDraft(); });
  }

  renderTasks();
}

function openTasksPanel() {
  forcedPanel = 'panelTasks';
  currentState = 'tasks';
  notch.setAttribute('data-state', 'tasks');
  renderTasks();
  if (!isExpanded) expand(); else showActivePanel();
  setTimeout(focusDraft, 260);
}

function closeTasksPanel() {
  const draft = document.getElementById('taskDraftInput');
  if (draft) { draft.value = ''; draft.blur(); }
  // Lines left blank (an Enter that was never typed into) shouldn't persist.
  const before = tasks.length;
  tasks = tasks.filter(t => t.text.trim());
  if (tasks.length !== before) saveTasks();
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

// A PiP video only exists for YouTube. Other sources (Spotify, local players)
// report a track but nothing embeddable, so they keep the star.
function hasPipVideo() {
  // Any YouTube source is a video → it always gets the PiP button, never the
  // Liked-Songs star, even before we've resolved its videoId. (Previously this
  // required videoId, so a slow/failed scrape left a star sitting on a video.)
  return !!(mediaData && mediaData.source === 'YouTube');
}

/* ─── Liked Songs playlist ───
   The star (shown for non-video music) saves the current song to a single
   "Liked Songs" list persisted in localStorage, and fills solid when the
   playing song is already saved. YouTube videos keep the PiP button instead. */
function songKey(m) {
  if (!m) return '';
  const t = (m.track || m.title || '').trim().toLowerCase();
  const a = (m.artist || '').trim().toLowerCase();
  return t ? (t + '|' + a) : '';
}
function getLikedSongs() {
  try { return JSON.parse(localStorage.getItem('likedSongs') || '[]'); } catch (e) { return []; }
}
function isSongLiked(m) {
  const k = songKey(m || mediaData);
  return k ? getLikedSongs().some(s => s.key === k) : false;
}
function toggleLikedSong(m) {
  m = m || mediaData;
  const k = songKey(m);
  if (!k) return false;
  const list = getLikedSongs();
  const idx = list.findIndex(s => s.key === k);
  let liked;
  if (idx >= 0) { list.splice(idx, 1); liked = false; }
  else {
    list.push({ key: k, track: m.track || m.title || '', artist: m.artist || '',
                artUrl: m.artUrl || '', videoId: m.videoId || null,
                source: m.source || '', added: Date.now() });
    liked = true;
  }
  try { localStorage.setItem('likedSongs', JSON.stringify(list)); } catch (e) {}
  return liked;
}
// Paint a star button to match saved state: filled green when liked, outline otherwise.
function applyStarFill(btn, liked) {
  if (!btn) return;
  const svg = btn.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('fill', liked ? 'currentColor' : 'none');
  btn.style.color = liked ? '#22c55e' : 'rgba(255,255,255,0.5)';
  btn.title = liked ? 'Remove from Liked Songs' : 'Add to Liked Songs';
}

function updateStarButtons() {
    const hasVideo = hasPipVideo();
    const starSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    const pipSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><rect x="12" y="12" width="8" height="8" rx="2" ry="2" fill="currentColor"></rect></svg>';

    const liked = isSongLiked();
    [document.getElementById('shuffleBtn'), document.getElementById('dashStarBtn')].forEach(btn => {
      if (!btn) return;
      const svg = btn.querySelector('svg');
      if (!svg) return;
      if (hasVideo) {
        svg.outerHTML = pipSvg;
        btn.style.color = 'rgba(255,255,255,0.5)';
        btn.title = 'Play in Notch PiP';
      } else {
        svg.outerHTML = starSvg;
        applyStarFill(btn, liked); // fills if the current song is saved
      }
    });
  }
  
  // The prev/next buttons mean "skip track" for a playlist source (Spotify) but
  // "seek ±10s" for a single YouTube video, so swap the glyphs to match what the
  // press will actually do — rewind-10 / forward-10 for YouTube, skip arrows else.
  const SKIP_PREV_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>';
  const SKIP_NEXT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
  const BACK10_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><path d="M10.86 15.94v-4.27h-.09l-1.77.63v.69l1.01-.31v3.26h.85zm2.68-4.27c-.29 0-.55.06-.75.18-.2.12-.37.28-.5.48-.13.2-.22.44-.28.7-.06.26-.09.53-.09.81v.71c0 .28.03.55.09.81.06.26.15.5.28.7.13.2.3.36.51.48.21.12.46.18.75.18s.55-.06.76-.18c.21-.12.37-.28.5-.48.13-.2.22-.44.28-.7.06-.26.09-.53.09-.81v-.71c0-.28-.03-.55-.09-.81-.06-.26-.15-.5-.28-.7-.13-.2-.3-.36-.51-.48-.21-.12-.46-.18-.76-.18zm.85 2.87c0 .17-.01.32-.04.45-.03.13-.07.24-.12.33-.05.09-.12.15-.2.2-.08.05-.19.06-.3.06s-.22-.02-.3-.06c-.08-.05-.15-.11-.21-.2-.05-.09-.09-.2-.12-.33-.03-.13-.04-.28-.04-.45v-1.07c0-.17.01-.32.04-.45.03-.13.06-.24.12-.32.05-.09.12-.15.21-.19.08-.05.19-.06.3-.06s.22.02.3.06c.08.05.15.11.2.19.06.08.09.19.12.32.03.13.04.28.04.45v1.07z"/></svg>';
  const FWD10_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4 13c0 4.4 3.6 8 8 8s8-3.6 8-8h-2c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6v4l5-5-5-5v4c-4.4 0-8 3.6-8 8z"/><path d="M10.86 15.94v-4.27h-.09l-1.77.63v.69l1.01-.31v3.26h.85zm2.68-4.27c-.29 0-.55.06-.75.18-.2.12-.37.28-.5.48-.13.2-.22.44-.28.7-.06.26-.09.53-.09.81v.71c0 .28.03.55.09.81.06.26.15.5.28.7.13.2.3.36.51.48.21.12.46.18.75.18s.55-.06.76-.18c.21-.12.37-.28.5-.48.13-.2.22-.44.28-.7.06-.26.09-.53.09-.81v-.71c0-.28-.03-.55-.09-.81-.06-.26-.15-.5-.28-.7-.13-.2-.3-.36-.51-.48-.21-.12-.46-.18-.76-.18zm.85 2.87c0 .17-.01.32-.04.45-.03.13-.07.24-.12.33-.05.09-.12.15-.2.2-.08.05-.19.06-.3.06s-.22-.02-.3-.06c-.08-.05-.15-.11-.21-.2-.05-.09-.09-.2-.12-.33-.03-.13-.04-.28-.04-.45v-1.07c0-.17.01-.32.04-.45.03-.13.06-.24.12-.32.05-.09.12-.15.21-.19.08-.05.19-.06.3-.06s.22.02.3.06c.08.05.15.11.2.19.06.08.09.19.12.32.03.13.04.28.04.45v1.07z"/></svg>';
  function updateTransportIcons() {
    const isYouTube = mediaData && mediaData.source === 'YouTube';
    const prevSvg = isYouTube ? BACK10_SVG : SKIP_PREV_SVG;
    const nextSvg = isYouTube ? FWD10_SVG : SKIP_NEXT_SVG;
    [['prevBtn', prevSvg], ['dashPrevBtn', prevSvg], ['nextBtn', nextSvg], ['dashNextBtn', nextSvg]].forEach(([id, svg]) => {
      const btn = document.getElementById(id);
      if (btn && btn.innerHTML !== svg) btn.innerHTML = svg;
      if (btn) btn.title = isYouTube ? (id.includes('prev') || id.includes('Prev') ? 'Back 10s' : 'Forward 10s') : (id.toLowerCase().includes('prev') ? 'Previous' : 'Next');
    });
  }

  function updateMusicUI() {
  const coverImg = document.getElementById('coverImg');
  const placeholder = document.getElementById('albumPlaceholder');
  const cAlbum = document.getElementById('cAlbumImg');

  // Update star/PiP buttons based on whether a YouTube video is available
  updateStarButtons();
  updateTransportIcons();

  if (mediaData.playing || mediaData.paused) {
    console.log('[ARTDBG] source=' + mediaData.source + ' artUrl=[' + (mediaData.artUrl || '') + '] videoId=' + mediaData.videoId);
    const track = mediaData.track || mediaData.title;
    setScrollingTitle(document.getElementById('songTitle'), track);
    const songArtist = document.getElementById('songArtist');
    if (songArtist) songArtist.textContent = mediaData.artist ? `By: ${mediaData.artist}` : '';
    setScrollingTitle(document.getElementById('cSongTitle'), mediaData.artist ? `${track} - By: ${mediaData.artist}` : track);
    setScrollingTitle(document.getElementById('dashSongTitle'), track);
    const dashSongArtist = document.getElementById('dashSongArtist');
    if (dashSongArtist) dashSongArtist.textContent = mediaData.artist ? `By: ${mediaData.artist}` : '';
    const dashSongAlbum = document.getElementById('dashSongAlbum');
    if (dashSongAlbum) dashSongAlbum.textContent = mediaData.album || '';

    // Show music column on dashboard
    document.getElementById('dashMusicCol').classList.remove('hidden');
    document.getElementById('dashMusicSep').classList.remove('hidden');
    const cal = document.querySelector('.dash-cal');
    if (cal) cal.style.justifyContent = 'flex-end';

    const playSvg = document.querySelector('#playBtn svg');
    const dashPlayBtnSvg = document.querySelector('#dashPlayBtn svg');

    if (mediaData.paused) {
      stopVisualizer();
      if (playSvg) playSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
    } else {
      startVisualizer();
      if (playSvg) playSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    }
    animateProgress();

    // Show scrubber for YouTube now that we parse duration correctly
    const seekBars = document.querySelectorAll('.mu-seek, .dash-seek');
    seekBars.forEach(bar => {
      bar.style.display = 'flex';
    });

    if (mediaData.artUrl) {
      // SMTC thumbnails come through as file:// URLs, which have no CORS response
      // — tagging them crossorigin=anonymous would make the browser refuse to
      // load them (the blank-thumbnail bug). Only remote art gets the CORS tag
      // (which also lets getAverageRGB read its colour for the accent).
      const isLocal = /^file:/i.test(mediaData.artUrl);
      const setArt = (img) => {
        if (!img) return;
        if (isLocal) img.removeAttribute('crossorigin'); else img.crossOrigin = 'Anonymous';
        img.src = mediaData.artUrl;
      };
      coverImg.onload = () => { console.log('[ARTDBG] coverImg LOADED w=' + coverImg.naturalWidth); document.documentElement.style.setProperty('--eq', getAverageRGB(coverImg)); };
      coverImg.onerror = (ev) => { console.log('[ARTDBG] coverImg ERROR loading ' + coverImg.src); };
      setArt(coverImg);
      coverImg.style.display = 'block';
      placeholder.style.display = 'none';
      setArt(cAlbum);
      cAlbum.style.display = 'block';
      const dashImg = document.getElementById('dashCoverImg');
      const dashPh = document.getElementById('dashArtPlaceholder');

      if (dashImg) { setArt(dashImg); dashImg.style.display = 'block'; }
      if (dashPh) { dashPh.style.display = 'none'; }
      
      // A video used to black out the album art behind a "Click to play"
      // overlay. Video belongs to the PiP player now, so art stays art.
    } else {
      document.documentElement.style.setProperty('--eq', '#FA233B'); // Apple Red
      coverImg.style.display = 'none';
      placeholder.style.display = 'flex';
      cAlbum.style.display = 'none';
      const dashImg = document.getElementById('dashCoverImg');
      if (dashImg) dashImg.style.display = 'none';
      const dashPh = document.getElementById('dashArtPlaceholder');
      if (dashPh) dashPh.style.display = 'flex';
    }
  } else {
    setScrollingTitle(document.getElementById('songTitle'), 'Not Playing');
    const songArtist = document.getElementById('songArtist');
    if (songArtist) songArtist.textContent = 'No active media';
    setScrollingTitle(document.getElementById('cSongTitle'), '');
    setScrollingTitle(document.getElementById('dashSongTitle'), 'Not Playing');
    const dashSongArtist = document.getElementById('dashSongArtist');
    if (dashSongArtist) dashSongArtist.textContent = 'No active media';
    const dashSongAlbum = document.getElementById('dashSongAlbum');
    if (dashSongAlbum) dashSongAlbum.textContent = '';

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

// The bars are driven by the real system-audio peak (WASAPI, via audio-meter.ps1
// → onAudioPeak → updateVisualizerWithPeak). lastKnownPeak is the latest peak in
// 0..100; the loop turns it into per-bar heights with a fast attack / slow release
// so it reads like a live meter — silence stays flat, loud passages jump.
let lastKnownPeak = 0;
let visualizerFrame = null;
let barLevels = [];

function startVisualizer() {
  if (visualizerFrame) return; // already running — don't stack rAF loops
  visualizerFrame = requestAnimationFrame(visualizerLoop);
}

function stopVisualizer() {
  if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  visualizerFrame = null;
  lastKnownPeak = 0;
  barLevels = [];
  document.querySelectorAll('.equalizer span, .c-eq span').forEach(s => {
    s.style.transition = 'height 0.12s ease';
    s.style.height = s.parentElement.classList.contains('equalizer') ? '4px' : '3px';
  });
}

function visualizerLoop() {
  if (!mediaData.playing) { stopVisualizer(); return; }

  const spans = document.querySelectorAll('.equalizer span, .c-eq span');
  // Normalize the real peak to 0..1, with a gentle curve so quiet passages still
  // register instead of sitting flat until something loud hits.
  const level = Math.min(1, Math.pow(Math.max(0, lastKnownPeak) / 100, 0.6));
  const t = Date.now() / 1000;

  spans.forEach((s, idx) => {
    const isBig = s.parentElement.classList.contains('equalizer');
    const maxH = isBig ? 22 : 11;
    const minH = isBig ? 4 : 3;
    // A quick wobble so neighbouring bars aren't one flat block, all scaled by
    // the real audio level — the movement is the music, not a fake animation.
    const wobble = 0.55 + 0.45 * Math.sin(t * 9 + idx * 1.7);
    const target = level * wobble;
    if (barLevels[idx] == null) barLevels[idx] = 0;
    // Fast attack, slower release.
    const k = target > barLevels[idx] ? 0.6 : 0.16;
    barLevels[idx] += (target - barLevels[idx]) * k;
    s.style.height = (minH + barLevels[idx] * (maxH - minH)).toFixed(1) + 'px';
    s.style.transition = 'height 0.04s linear';
  });

  // Decay the held peak so a transient doesn't stick until the next sample.
  lastKnownPeak *= 0.90;
  visualizerFrame = requestAnimationFrame(visualizerLoop);
}

function updateVisualizerWithPeak(peak) {
  // Keep the loudest recent sample; the loop decays it between updates.
  if (peak > lastKnownPeak) lastKnownPeak = peak;
}

let musicDuration = 0;
let musicElapsed = 0;
let isDraggingScrubber = false;
// Ground truth from SMTC: real position sampled at a real moment. The scrubber
// interpolates forward from here while playing, and re-syncs on every update, so
// it's both smooth and accurate (no more guessed counter).
let posBaseSec = 0;   // SMTC position in seconds
let posBaseAt = 0;    // Date.now() when that position was sampled (renderer clock)

// Real elapsed seconds right now: the sampled position plus the wall-clock time
// that has passed since, but only while actually playing.
function currentElapsed() {
  if (musicDuration <= 0) return 0;
  let e = posBaseSec;
  if (mediaData.playing && !isDraggingScrubber) e += (Date.now() - posBaseAt) / 1000;
  return Math.max(0, Math.min(musicDuration, e));
}

function animateProgress() {
  if (progressInterval) clearInterval(progressInterval);

  musicDuration = (mediaData.durationMs && mediaData.durationMs > 0)
    ? mediaData.durationMs / 1000
    : (mediaData.duration && mediaData.duration > 0 ? mediaData.duration / 1000 : 0);

  // Re-sync the interpolation base to SMTC's real position. posAt is a main-
  // process timestamp on the same machine clock, so it lines up with Date.now().
  if (!isDraggingScrubber) {
    posBaseSec = (mediaData.positionMs || 0) / 1000;
    posBaseAt = mediaData.posAt || Date.now();
    lastTrack = mediaData.track;
    const el = currentElapsed();
    musicElapsed = el;
    updateScrubberUI(musicDuration > 0 ? (el / musicDuration) * 100 : 0, el, musicDuration);
  }

  progressInterval = setInterval(() => {
    if (!mediaData.playing || isDraggingScrubber || musicDuration <= 0) return;
    musicElapsed = currentElapsed();
    updateScrubberUI((musicElapsed / musicDuration) * 100, musicElapsed, musicDuration);
  }, 250);
}

/* ─── Scrolling song titles ─── */
const MQ_TITLE_IDS = ['songTitle', 'dashSongTitle', 'cSongTitle'];

// Decide whether a title element's text overflows its box and, if so, arm the
// CSS scroll with a distance/duration matched to how much is hidden. Hidden
// elements (clientWidth 0) are skipped and re-measured later when shown.
function measureMarquee(el) {
  if (!el) return;
  const inner = el.querySelector('.mq-inner');
  if (!inner) return;
  if (el.clientWidth === 0) return; // not visible yet
  const overflow = inner.scrollWidth - el.clientWidth;
  if (overflow > 6) {
    const dur = Math.min(16, Math.max(7, 5 + overflow / 25)); // seconds, longer text scrolls longer
    el.style.setProperty('--mq-shift', (-overflow - 4) + 'px');
    el.style.setProperty('--mq-dur', dur + 's');
    el.classList.add('mq-scroll');
  } else {
    el.classList.remove('mq-scroll');
    el.style.removeProperty('--mq-shift');
    el.style.removeProperty('--mq-dur');
  }
}

// Re-measure every title — used after a layout change (expand / panel swap) so a
// title that was hidden when set now scrolls if it needs to.
function refreshMarquees() {
  MQ_TITLE_IDS.forEach(id => measureMarquee(document.getElementById(id)));
}

// Set a title's text and (re)arm its scroll. Skips the DOM rebuild when the text
// is unchanged so the scroll animation isn't restarted on every media poll.
function setScrollingTitle(el, text) {
  if (!el) return;
  const str = text == null ? '' : String(text);
  if (el.dataset.mqText === str && el.querySelector('.mq-inner')) {
    measureMarquee(el);
    return;
  }
  el.dataset.mqText = str;
  el.classList.add('mq');
  el.classList.remove('mq-scroll');
  const inner = document.createElement('span');
  inner.className = 'mq-inner';
  inner.textContent = str;
  el.innerHTML = '';
  el.appendChild(inner);
  requestAnimationFrame(() => measureMarquee(el));
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
  
  let pendingSeekPct = null;

  const moveScrubber = (e, area) => {
    if (!isDown) return;
    const rect = area.getBoundingClientRect();
    let x = e.clientX || (e.touches && e.touches[0].clientX);
    if (x === undefined) return;

    let pct = ((x - rect.left) / rect.width) * 100;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;

    pendingSeekPct = pct;
    if (musicDuration > 0) {
      musicElapsed = (pct / 100) * musicDuration;
      updateScrubberUI(pct, musicElapsed, musicDuration);
    }
  };

  // On release, commit the seek: tell SMTC to jump there and move the local
  // interpolation base so the bar stays put instead of snapping back until the
  // next SMTC tick confirms.
  const commitSeek = () => {
    if (pendingSeekPct == null || musicDuration <= 0) { pendingSeekPct = null; return; }
    const targetSec = (pendingSeekPct / 100) * musicDuration;
    posBaseSec = targetSec;
    posBaseAt = Date.now();
    if (window.notchAPI && window.notchAPI.seekMedia) {
      window.notchAPI.seekMedia(Math.round(targetSec * 1000));
    }
    pendingSeekPct = null;
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
        commitSeek();
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
        commitSeek();
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

  if (plugChanged || hitLow || isFirst) showBatteryToast(bat, isFirst);
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

function showBatteryToast(bat, isFirstReading) {
  if (battToastTimeout) { clearTimeout(battToastTimeout); battToastTimeout = null; }

  // Don't interrupt startup animation
  if (currentState === 'startup') return;

  const runToast = (state) => {
    battToastState = state;
    // Arm the timeout BEFORE expanding: expand() ends with decideState(), which
    // reads battToastTimeout to decide the notch stays on the battery pill.
    // Assigning it afterwards (as the original code did) meant decideState saw
    // no toast in progress and immediately reset the notch back to idle — which
    // is why the charging pill never actually showed up.
    battToastTimeout = setTimeout(() => {
      battToastTimeout = null;
      battToastState = null;
      collapse();
      setTimeout(decideState, 400);
    }, 4000);
    setState(state);
    if (!isExpanded) expand(); else showActivePanel();
  };

  if (bat.isCharging) {
    document.getElementById('chargingPct').textContent = bat.percent + '%';
    document.getElementById('chargingBattFill').setAttribute('width', Math.max(1, (bat.percent/100)*15));
    runToast('charging');
    return;
  }

  if (bat.percent <= 20) {
    document.getElementById('lowBattPct').textContent = bat.percent + '%';
    document.getElementById('lowBattFill').setAttribute('width', Math.max(1, (bat.percent/100)*15));
    runToast('low-battery');
    return;
  }

  // Unplugged and healthy — say so, rather than silently collapsing. Skip it on
  // the very first reading, or the notch would announce this at every launch.
  if (isFirstReading) {
    if (isExpanded) collapse();
    decideState();
    return;
  }

  const pct = document.getElementById('unpluggedPct');
  const fill = document.getElementById('unpluggedBattFill');
  if (pct) pct.textContent = bat.percent + '%';
  if (fill) {
    fill.setAttribute('width', Math.max(1, (bat.percent/100)*15));
    fill.setAttribute('fill', bat.powerSaver ? '#fbbf24' : '#fff');
  }
  runToast('unplugged');
}

/* ─── Unread Messages (swipeable carousel, shown in place of Quick Start) ─── */
let unreadList = [];
let unreadIndex = 0;
// Tracks who a reply in the expanded panel should go to (set when a live
// message arrives or an unread card is opened).
let activeReplyContext = null;
let pendingAttachment = null; // file path staged by the + button, sent with the reply

// Name + avatar for whoever the notch is currently showing. Google Messages
// only supplies an avatar URL for some contacts; without a fallback the panel
// keeps the previous sender's photo and labels the message with the wrong face.
function setMsgSender(sender, avatar) {
  const name = sender || 'Unknown Sender';
  document.querySelectorAll('.msg-name').forEach(el => el.textContent = name);
  document.querySelectorAll('.msg-avatar').forEach(el => {
    if (avatar) el.setAttribute('src', avatar);
    else el.removeAttribute('src');
  });
  const initials = name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('') || '?';
  document.querySelectorAll('.msg-avatar-initials').forEach(el => el.textContent = initials);
}

function openUnreadForReply(item) {
  activeReplyContext = { sender: item.sender || null, app: item.app || null };

  const textExpEl = document.querySelector('.msg-exp-text');
  const appIconSmall = document.querySelector('.msg-app-icon-small');
  setMsgSender(item.sender, item.avatar);
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

  fetchCalendar();
  setInterval(fetchCalendar, 10000);
  updateMusicUI();

  if (window.notchAPI.onBatteryUpdate) {
    window.notchAPI.onBatteryUpdate(handleBatteryEvent);
    window.notchAPI.getBattery().then(bat => {
      if (bat && bat.hasBattery) handleBatteryEvent(bat);
    });
  }
  if (window.notchAPI.onMediaUpdate) window.notchAPI.onMediaUpdate((data) => {
    handleMediaUpdate(data);
    // Swap the star for the PiP glyph when the track has a video behind it.
    try { updateStarButtons(); } catch (e) {}
  });
  window.notchAPI.onAudioPeak((peak) => {
    updateVisualizerWithPeak(peak);
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
    }, { passive: false });
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
    // Collapse first so the notch reacts on the same frame as the keypress
    // instead of waiting on the IPC round trip.
    dashSearchInput.value = '';
    collapse();
    window.notchAPI.openUrl(url);
  } else {
    collapse();
    window.notchAPI.openUrl('https://www.google.com');
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


/* --- PiP YouTube player ------------------------------------------------
   The embed is driven through the IFrame API's postMessage protocol rather
   than a wrapper library: the panel needs real position and duration to draw
   the scrub bar, and those only come back from the player itself. Commands go
   out as {event:'command'}; the player answers with 'infoDelivery' payloads
   carrying currentTime, duration and playerState. */
let pipState = { time: 0, duration: 0, playing: false, muted: false, loop: false, videoId: null };
let pipPoll = null;
let pipTick = null;

// The player reports roughly once a second, so between reports the scrub bar
// sat frozen and then jumped. Advance it against the wall clock locally and let
// each incoming report snap it back to the truth.
function pipStartTick() {
  clearInterval(pipTick);
  let last = Date.now();
  pipTick = setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    if (pipState.playing && pipState.duration > 0) {
      pipState.time = Math.min(pipState.duration, pipState.time + dt);
      pipPaint();
    }
  }, 100);
}

// The music and dashboard panels have their own play buttons; they must show
// what the player is really doing, not what someone last clicked.
function syncPlayIcons() {
  const playSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const pauseSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>';
  ['playBtn', 'dashPlayBtn'].forEach(id => {
    const btn = document.getElementById(id);
    const svg = btn && btn.querySelector('svg');
    if (svg) svg.outerHTML = pipState.playing ? pauseSvg : playSvg;
  });
}

function pipCmd(func, args) {
  const frame = document.getElementById('mainYtIframe');
  if (!frame || !frame.contentWindow || !frame.src) return;
  frame.contentWindow.postMessage(JSON.stringify({
    event: 'command', func: func, args: args || []
  }), '*');
}

function pipFmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), r = Math.floor(sec % 60);
  return m + ':' + String(r).padStart(2, '0');
}

function pipPaint() {
  const t = document.getElementById('pipTime');
  const fill = document.getElementById('pipFill');
  const dot = document.getElementById('pipDot');
  const icon = document.getElementById('pipPlayIcon');
  if (t) t.textContent = pipFmt(pipState.time) + ' / ' + pipFmt(pipState.duration);
  const pct = pipState.duration > 0
    ? Math.max(0, Math.min(100, (pipState.time / pipState.duration) * 100)) : 0;
  if (fill) fill.style.width = pct + '%';
  if (dot) dot.style.left = pct + '%';
  // Pause bars while playing, play triangle while stopped.
  if (icon) icon.innerHTML = pipState.playing
    ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

// The player only reports back to listeners that have announced themselves.
function pipSubscribe() {
  const frame = document.getElementById('mainYtIframe');
  if (!frame || !frame.contentWindow || !frame.src) return;
  frame.contentWindow.postMessage(JSON.stringify({
    event: 'listening', id: 1, channel: 'widget'
  }), '*');
}

function pipIsYouTubeOrigin(origin) {
  try {
    const host = new URL(origin).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtube-nocookie.com';
  } catch (e) { return false; }
}

window.addEventListener('message', (e) => {
  if (!pipIsYouTubeOrigin(e.origin)) return;
  let data;
  try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
  if (!data || data.event !== 'infoDelivery' || !data.info) return;
  const i = data.info;
  if (typeof i.currentTime === 'number') pipState.time = i.currentTime;
  if (typeof i.duration === 'number' && i.duration > 0) pipState.duration = i.duration;
  if (typeof i.muted === 'boolean') pipState.muted = i.muted;
  if (typeof i.playerState === 'number') {
    pipState.playing = i.playerState === 1;
    // One source of truth: the panel buttons follow the player.
    isLocalPaused = !pipState.playing;
    if (typeof mediaData !== 'undefined' && mediaData) mediaData.paused = isLocalPaused;
    syncPlayIcons();
    // 0 = ended; the loop toggle in the footer restarts it.
    if (i.playerState === 0 && pipState.loop) pipCmd('seekTo', [0, true]);
  }
  pipPaint();
});

// Open a video in the PiP panel. Everything that used to assign iframe.src
// directly now routes through here, so the chrome is always filled in.
function openPipVideo(videoId, title, channel, art) {
  const frame = document.getElementById('mainYtIframe');
  if (!frame || !videoId) return;
  pipState = { time: 0, duration: 0, playing: true, muted: false, loop: pipState.loop, videoId: videoId };

  const t = document.getElementById('pipTitle');
  const c = document.getElementById('pipChannel');
  const a = document.getElementById('pipAvatar');
  if (t) t.textContent = title || 'YouTube';
  if (c) c.textContent = channel || 'YouTube';
  if (a) {
    if (art) { a.style.backgroundImage = 'url("' + art + '")'; a.textContent = ''; }
    else { a.style.backgroundImage = ''; a.textContent = (channel || 'Y').trim().charAt(0).toUpperCase(); }
  }
  pipPaint();

  frame.src = 'https://www.youtube-nocookie.com/embed/' + videoId +
    '?autoplay=1&enablejsapi=1&rel=0&modestbranding=1&playsinline=1';
  frame.onload = () => { pipSubscribe(); setTimeout(pipSubscribe, 600); };

  clearInterval(pipPoll);
  // The player pushes updates while playing but goes quiet when paused or
  // buffering; a slow poll keeps the bar honest without spamming the frame.
  pipPoll = setInterval(pipSubscribe, 1000);
  pipStartTick();
}

function closePipVideo() {
  const frame = document.getElementById('mainYtIframe');
  if (frame) { frame.onload = null; frame.src = ''; }
  clearInterval(pipPoll);
  clearInterval(pipTick);
  pipPoll = pipTick = null;
  pipState.playing = false;
}

document.addEventListener('DOMContentLoaded', () => {
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (ev) => { ev.stopPropagation(); fn(el, ev); });
  };
  on('pipPlayBtn', () => {
    pipCmd(pipState.playing ? 'pauseVideo' : 'playVideo');
    // Flip optimistically so the button answers instantly, then ask the player
    // right away — its reply overrides this within a frame or two.
    pipState.playing = !pipState.playing;
    pipPaint();
    setTimeout(pipSubscribe, 60);
  });
  on('pipPrevBtn', () => pipCmd('seekTo', [Math.max(0, pipState.time - 10), true]));
  on('pipNextBtn', () => pipCmd('seekTo', [pipState.time + 10, true]));
  on('pipMuteBtn', (el) => {
    pipState.muted = !pipState.muted;
    pipCmd(pipState.muted ? 'mute' : 'unMute');
    el.classList.toggle('active', pipState.muted);
  });
  on('pipLoopBtn', (el) => {
    pipState.loop = !pipState.loop;
    el.classList.toggle('active', pipState.loop);
  });
  on('pipOpenBtn', () => {
    if (pipState.videoId && window.notchAPI) {
      window.notchAPI.openUrl('https://www.youtube.com/watch?v=' + pipState.videoId);
    }
  });

  // Scrub: map the click position along the track to a time.
  const track = document.getElementById('pipTrack');
  if (track) {
    track.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!pipState.duration) return;
      const r = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      pipState.time = ratio * pipState.duration;
      pipCmd('seekTo', [pipState.time, true]);
      pipPaint();
    });
  }
});

// ─── Weather glyphs ───
// Flat two-tone icons in the style of the reference sheet: a warm yellow sun,
// neutral grey cloud, blue precipitation. Emoji were the wrong look and, worse,
// render differently per platform. Drawn on a 24x24 grid so they stay legible
// down to the 14px used in the hourly strip.
const WX_SUN = '#FFD23F', WX_CLOUD = '#D2D6DB', WX_CLOUD_DARK = '#AEB4BC',
      WX_MOON = '#F1F4F8', WX_RAIN = '#4FC0F0', WX_SNOW = '#EAF0F6';

const CLOUD_PATH = 'M7.2 19h10a3.8 3.8 0 0 0 .3-7.58 5.4 5.4 0 0 0-10.35-.72A3.9 3.9 0 0 0 7.2 19z';
const SMALL_CLOUD = 'M9.4 18.6h7.9a3.1 3.1 0 0 0 .25-6.2 4.4 4.4 0 0 0-8.45-.6 3.2 3.2 0 0 0 .3 6.8z';

const WX_ICONS = {
  sun: `<circle cx="12" cy="12" r="5" fill="${WX_SUN}"/>
    <g stroke="${WX_SUN}" stroke-width="2" stroke-linecap="round">
      <path d="M12 1.6v2.6M12 19.8v2.6M1.6 12h2.6M19.8 12h2.6M4.4 4.4l1.9 1.9M17.7 17.7l1.9 1.9M19.6 4.4l-1.9 1.9M6.3 17.7l-1.9 1.9"/>
    </g>`,

  sunCloud: `<circle cx="9" cy="8.2" r="3.5" fill="${WX_SUN}"/>
    <g stroke="${WX_SUN}" stroke-width="1.7" stroke-linecap="round">
      <path d="M9 1.9v1.7M2.7 8.2h1.7M4.5 3.7l1.2 1.2M13.5 3.7l-1.2 1.2M4.5 12.7l1.2-1.2"/>
    </g>
    <path d="${SMALL_CLOUD}" fill="${WX_CLOUD}"/>`,

  cloud: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD}"/>`,

  overcast: `<path d="M5.6 15.2a3.4 3.4 0 0 1 .9-6.4 4.9 4.9 0 0 1 9.2-.7 3.4 3.4 0 0 1 .3 6.6" fill="${WX_CLOUD_DARK}" opacity="0.75"/>
    <path d="${CLOUD_PATH}" fill="${WX_CLOUD_DARK}"/>`,

  moon: `<path d="M20.5 15.2A8.6 8.6 0 0 1 9.3 4a8.6 8.6 0 1 0 11.2 11.2z" fill="${WX_MOON}"/>`,

  moonStars: `<path d="M20.9 14.6A7.9 7.9 0 0 1 10.4 4.1a7.9 7.9 0 1 0 10.5 10.5z" fill="${WX_MOON}"/>
    <path d="M18.4 3.2l.62 1.68 1.68.62-1.68.62-.62 1.68-.62-1.68-1.68-.62 1.68-.62z" fill="${WX_MOON}"/>
    <path d="M21.7 8.4l.38 1.03 1.03.38-1.03.38-.38 1.03-.38-1.03-1.03-.38 1.03-.38z" fill="${WX_MOON}"/>`,

  moonCloud: `<path d="M16.6 3.4A6.2 6.2 0 0 1 8.4 11.6 6.2 6.2 0 1 0 16.6 3.4z" fill="${WX_MOON}"/>
    <path d="${SMALL_CLOUD}" fill="${WX_CLOUD}"/>`,

  rain: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD}" transform="translate(0,-2.2)"/>
    <g stroke="${WX_RAIN}" stroke-width="1.9" stroke-linecap="round">
      <path d="M8.7 18.4l-1.1 2.9M12.6 18.4l-1.1 2.9M16.5 18.4l-1.1 2.9"/>
    </g>`,

  drizzle: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD}" transform="translate(0,-2.2)"/>
    <g stroke="${WX_RAIN}" stroke-width="1.8" stroke-linecap="round">
      <path d="M9.4 18.7l-.7 1.8M15.1 18.7l-.7 1.8"/>
    </g>`,

  thunder: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD_DARK}" transform="translate(0,-2)"/>
    <path d="M13.4 15.2l-4.5 5.3h3l-1 4 4.7-5.6h-3.1l.9-3.7z" fill="${WX_SUN}"/>`,

  snow: `<g stroke="${WX_SNOW}" stroke-width="1.9" stroke-linecap="round">
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>
      <path d="M12 6.6l-2.2-2.2M12 6.6l2.2-2.2M12 17.4l-2.2 2.2M12 17.4l2.2 2.2"/>
      <path d="M7.3 9.3l-3-.5M7.3 9.3l-.8-2.9M16.7 14.7l3 .5M16.7 14.7l.8 2.9"/>
      <path d="M7.3 14.7l-3 .5M7.3 14.7l-.8 2.9M16.7 9.3l3-.5M16.7 9.3l.8-2.9"/>
    </g>`,

  snowCloud: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD}" transform="translate(0,-2.4)"/>
    <g fill="${WX_SNOW}">
      <circle cx="8.8" cy="19.6" r="1.15"/><circle cx="12.6" cy="20.9" r="1.15"/><circle cx="16.2" cy="19.6" r="1.15"/>
    </g>`,

  sleet: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD}" transform="translate(0,-2.4)"/>
    <circle cx="9.2" cy="19.9" r="1.15" fill="${WX_SNOW}"/>
    <circle cx="15.8" cy="19.9" r="1.15" fill="${WX_SNOW}"/>
    <path d="M12.5 18.6l-1 2.9" stroke="${WX_RAIN}" stroke-width="1.8" stroke-linecap="round"/>`,

  fog: `<path d="${CLOUD_PATH}" fill="${WX_CLOUD}" transform="translate(0,-3)"/>
    <g stroke="${WX_CLOUD_DARK}" stroke-width="1.9" stroke-linecap="round">
      <path d="M6.4 18.2h11.2M8.2 21.2h7.6"/>
    </g>`,
};

// isDay picks the night variant where one exists — a clear night is a moon.
function wxIcon(name, size) {
  const body = WX_ICONS[name] || WX_ICONS.cloud;
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
         '" fill="none" aria-hidden="true">' + body + '</svg>';
}

// WMO weather codes, as returned by Open-Meteo. Each maps to the label Apple
// shows and a day/night glyph pair — a clear night is a moon, not a sun.
const WMO = {
  0:  ['Clear',            'sun', 'moonStars', 'sunny'],
  1:  ['Mostly Clear',     'sunCloud', 'moonCloud', 'sunny'],
  2:  ['Partly Cloudy',    'sunCloud',  'moonCloud', 'cloudy'],
  3:  ['Cloudy',           'cloud', 'cloud', 'cloudy'],
  45: ['Fog',              'fog', 'fog', 'cloudy'],
  48: ['Freezing Fog',     'fog', 'fog', 'cloudy'],
  51: ['Light Drizzle',    'drizzle', 'drizzle', 'rainy'],
  53: ['Drizzle',          'drizzle', 'drizzle', 'rainy'],
  55: ['Heavy Drizzle',    'rain', 'rain', 'rainy'],
  56: ['Freezing Drizzle', 'sleet', 'sleet', 'rainy'],
  57: ['Freezing Drizzle', 'sleet', 'sleet', 'rainy'],
  61: ['Light Rain',       'drizzle', 'drizzle', 'rainy'],
  63: ['Rain',             'rain', 'rain', 'rainy'],
  65: ['Heavy Rain',       'rain', 'rain', 'rainy'],
  66: ['Freezing Rain',    'sleet', 'sleet', 'rainy'],
  67: ['Freezing Rain',    'sleet', 'sleet', 'rainy'],
  71: ['Light Snow',       'snowCloud', 'snowCloud', 'snowy'],
  73: ['Snow',             'snow', 'snow', 'snowy'],
  75: ['Heavy Snow',       'snow', 'snow', 'snowy'],
  77: ['Snow Grains',      'snowCloud', 'snowCloud', 'snowy'],
  80: ['Showers',          'drizzle', 'drizzle', 'rainy'],
  81: ['Showers',          'rain', 'rain', 'rainy'],
  82: ['Heavy Showers',    'thunder', 'thunder', 'rainy'],
  85: ['Snow Showers',     'snowCloud', 'snowCloud', 'snowy'],
  86: ['Snow Showers',     'snow', 'snow', 'snowy'],
  95: ['Thunderstorms',    'thunder', 'thunder', 'rainy'],
  96: ['Thunderstorms',    'thunder', 'thunder', 'rainy'],
  99: ['Thunderstorms',    'thunder', 'thunder', 'rainy'],
};
const wmo = code => WMO[code] || ['—', 'cloud', 'cloud', 'cloudy'];

const WX_HOURS = 6;
let weatherPlace = null;

function hourLabel(date) {
  const h = date.getHours();
  const suffix = h < 12 ? 'AM' : 'PM';
  return ((h % 12) || 12) + ' ' + suffix;
}

async function fetchWeather() {
  const el = id => document.getElementById(id);
  try {
    // Cache the location: the IP lookup is rate-limited and the city doesn't
    // change between the hourly refreshes.
    if (!weatherPlace) {
      const loc = await (await fetch('http://ip-api.com/json/')).json();
      if (!loc || loc.lat == null) throw new Error('No location');
      weatherPlace = { city: loc.city || 'Here', lat: loc.lat, lon: loc.lon };
    }
    const { city, lat, lon } = weatherPlace;

    // Open-Meteo needs no API key and, unlike the previous source, returns an
    // hourly series and the day's high/low — both of which the widget shows.
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lon
      + '&current=temperature_2m,weather_code,is_day'
      + '&hourly=temperature_2m,weather_code'
      + '&daily=temperature_2m_max,temperature_2m_min'
      + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=2';
    const wx = await (await fetch(url)).json();
    if (!wx || !wx.current) throw new Error('No weather data');

    const isDay = wx.current.is_day !== 0;
    const [label, dayGlyph, nightGlyph, sky] = wmo(wx.current.weather_code);

    el('weatherCity').textContent = city;
    el('weatherTemp').textContent = Math.round(wx.current.temperature_2m) + '°';
    el('weatherIcon').innerHTML = wxIcon(isDay ? dayGlyph : nightGlyph, 20);
    el('weatherCond').textContent = label;

    if (wx.daily) {
      el('weatherHL').textContent = 'H:' + Math.round(wx.daily.temperature_2m_max[0]) + '°'
        + '  L:' + Math.round(wx.daily.temperature_2m_min[0]) + '°';
    }

    const card = el('dashWeather');
    card.className = 'dash-weather weather-' + (isDay ? sky : (sky === 'sunny' ? 'night' : sky));

    // Hourly strip, starting from the next hour.
    const strip = el('weatherHourly');
    strip.innerHTML = '';
    if (wx.hourly && wx.hourly.time) {
      const now = Date.now();
      let start = wx.hourly.time.findIndex(t => new Date(t).getTime() > now);
      if (start < 0) start = 0;
      for (let i = start; i < start + WX_HOURS && i < wx.hourly.time.length; i++) {
        const when = new Date(wx.hourly.time[i]);
        const hr = when.getHours();
        const [, dg, ng] = wmo(wx.hourly.weather_code[i]);
        const col = document.createElement('div');
        col.className = 'wx-hour';
        col.innerHTML =
          '<span class="wx-hour-time"></span>' +
          '<span class="wx-hour-glyph"></span>' +
          '<span class="wx-hour-temp"></span>';
        col.children[0].textContent = hourLabel(when);
        col.children[1].innerHTML = wxIcon((hr >= 6 && hr < 20) ? dg : ng, 16);
        col.children[2].textContent = Math.round(wx.hourly.temperature_2m[i]) + '°';
        strip.appendChild(col);
      }
    }
  } catch (e) {
    console.error('Weather error:', e);
    if (el('weatherCity')) el('weatherCity').textContent = 'Unavailable';
    if (el('weatherCond')) el('weatherCond').textContent = 'No connection';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fetchWeather();
  // The whole card opens the forecast now that the button is gone.
  const card = document.getElementById('dashWeather');
  if (card) {
    card.addEventListener('click', () => {
      const place = weatherPlace ? encodeURIComponent(weatherPlace.city) : '';
      window.notchAPI.openUrl('https://weather.com/weather/today/l/' + place);
      collapse();
    });
  }
});
setInterval(fetchWeather, 900000);

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
const STOCK_SLOTS = 3; // watchlist keeps the Markets grid: three cards wide
let stocksMode = 'market';
try { stocksMode = localStorage.getItem('stocksMode') || 'market'; } catch (e) {}
let watchlist = [];
try { watchlist = JSON.parse(localStorage.getItem('stocksWatchlist') || '[]') || []; } catch (e) {}
let stocksInterval = null;

// Plots the price line honestly on both axes. The data itself was always real
// Yahoo intraday data; the drawing was what misrepresented it:
//
//  • x used to span first bar → last bar, so a half-finished session was
//    stretched edge to edge and 30 minutes of trading filled the whole card.
//    It now spans the real session (open → close), so the line reaches only as
//    far as the time of day it actually got to.
//  • y used to be exactly the day's min → max, so the line hit the top and
//    bottom of the strip whether the stock moved 0.05% or 5% — every chart
//    looked like the same dramatic rollercoaster. The previous close is now
//    kept inside the domain (without drawing it), which is how a 1D chart is
//    scaled: a flat day looks flat and a big move looks big.
// The card is ~113px wide but a session carries ~390 one-minute bars, so more
// than three points land in every pixel column. Drawn as-is they overplot into
// a smeared band that reads nothing like Google Finance's line. Reduce to one
// column per pixel, keeping each column's high AND low in the order they
// happened — that preserves the true envelope (a spike stays a spike) while
// removing the overdraw.
// Roughly the on-screen width of one stock card's sparkline, in device
// pixels: three cards across a 368px widget. Bucketing to this many columns
// is what keeps the drawn line at one point per pixel.
const SPARK_PX_W = 113;

function downsampleSpark(pts, buckets, t0, span) {
  if (pts.length <= buckets) return pts;
  const groups = new Map();
  for (const p of pts) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor(((p.t - t0) / span) * buckets)));
    const g = groups.get(b);
    if (!g) groups.set(b, { lo: p, hi: p });
    else {
      if (p.c < g.lo.c) g.lo = p;
      if (p.c > g.hi.c) g.hi = p;
    }
  }
  const out = [];
  Array.from(groups.keys()).sort((a, b) => a - b).forEach(b => {
    const g = groups.get(b);
    const pair = g.lo.t <= g.hi.t ? [g.lo, g.hi] : [g.hi, g.lo];
    for (const p of pair) {
      if (!out.length || out[out.length - 1].t !== p.t) out.push(p);
    }
  });
  // The final bar is the live price the card displays; it must end the line
  // even if its column's extremes fell elsewhere.
  const last = pts[pts.length - 1];
  if (out.length && out[out.length - 1].t !== last.t) out.push(last);
  return out;
}

function sparkPoints(pts, prevClose, sessionStart, sessionEnd, w = 100, h = 20) {
  if (!pts || pts.length < 2) return null;
  const vals = pts.map(p => p.c);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (prevClose != null) { min = Math.min(min, prevClose); max = Math.max(max, prevClose); }
  const range = (max - min) || 1;
  const pad = 2;

  const t0 = (sessionStart != null) ? sessionStart : pts[0].t;
  const t1 = (sessionEnd != null) ? sessionEnd : pts[pts.length - 1].t;
  const span = (t1 - t0) || 1;

  const drawn = downsampleSpark(pts, SPARK_PX_W, t0, span);
  const yOf = v => (h - pad) - ((v - min) / range) * (h - pad * 2);
  const xOf = t => Math.max(0, Math.min(w, ((t - t0) / span) * w));
  const xy = drawn.map(p => [xOf(p.t), yOf(p.c)]);
  const line = xy.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const last = xy[xy.length - 1];
  // Percentages, so the "now" marker can be a real circle: the SVG is drawn
  // with preserveAspectRatio="none", which would squash a <circle> into an
  // ellipse.
  return {
    line,
    area: `${xy[0][0].toFixed(2)},${h} ${line} ${last[0].toFixed(2)},${h}`,
    dotLeft: (last[0] / w) * 100,
    dotTop: (last[1] / h) * 100,
  };
}

async function fetchStocks() {
  const row = document.getElementById('stocksRow');
  if (!row) return;
  const watch = stocksMode === 'watchlist';
  // The watchlist always shows three slots in the same grid as Markets: filled
  // ones hold the stock, the rest are empty squares you click to add.
  const emptySlot = '<div class="stock-item stock-slot" title="Add a symbol">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
    '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>';
  const padSlots = (html, filled) =>
    html + emptySlot.repeat(Math.max(0, STOCK_SLOTS - filled));
  const wireSlots = () => {
    row.querySelectorAll('.stock-slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = document.getElementById('watchlistInput');
        if (input) input.focus();
      });
    });
  };

  if (watch && watchlist.length === 0) {
    row.innerHTML = padSlots('', 0);
    wireSlots();
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
      const sp = sparkPoints(s.spark, s.prevClose, s.sessionStart, s.sessionEnd, 100, 20);
      const fillId = `sf${s.symbol.replace(/[^a-z0-9]/gi, '')}`;
      const spark = sp
        ? `<div class="stock-spark-wrap">
             <svg class="stock-spark" viewBox="0 0 100 20" preserveAspectRatio="none">
               <defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
                 <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
                 <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
               </linearGradient></defs>
               <polygon points="${sp.area}" fill="url(#${fillId})"/>
               <polyline points="${sp.line}" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
             </svg>
             <span class="stock-dot" style="left:${sp.dotLeft.toFixed(2)}%;top:${sp.dotTop.toFixed(2)}%;background:${color}"></span>
           </div>`
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
      </div>`;
    }).join('');
    if (watch) {
      row.innerHTML = padSlots(row.innerHTML, data.length);
      wireSlots();
      row.querySelectorAll('.stock-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFromWatchlist(btn.dataset.symbol);
        });
      });
    }
  } catch (e) {
    if (watch) {
      row.innerHTML = padSlots('', 0);
      wireSlots();
    } else {
      row.innerHTML = '<div class="stocks-loading">Markets unavailable</div>';
    }
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
  ['widgetNav', 'widgetNavPrev'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = multi ? 'flex' : 'none';
  });

  document.querySelectorAll('#widgetPicker .wp-item').forEach(it => {
    it.classList.toggle('selected', selectedWidgets.includes(it.dataset.widget));
  });

  // Only re-arm the feed when the visible widget actually changed. This used to
  // run on every renderWidgets() call, so a burst of swipes fired a Yahoo
  // request and rebuilt three sparkline cards per swipe, on top of an animation
  // that is already compositing on the CPU.
  if (active !== lastWidgetRendered) {
    lastWidgetRendered = active;
    clearInterval(stocksInterval);
    if (active === 'stocks') {
      syncStocksModeUI();
      fetchStocks();
      // Live refresh from Yahoo Finance — prices AND sparkline shapes
      stocksInterval = setInterval(fetchStocks, 15000);
    }
  }
}

// The drum takes .52s to swing a face away; the next one starts its own swing
// part-way through, so you read it as one continuous turn rather than a
// cross-fade of two cards sitting on top of each other.
// Curve out, THEN place in. The stagger is nearly the full swing, so the
// outgoing card has almost finished rotating away before the next one starts —
// the two barely overlap, which is both the look asked for and cheaper to
// composite, since only one card is animating at a time for most of the turn.
const WGT_SWING_MS = 340;
const WGT_STAGGER_MS = 250;
let widgetTurning = false;
let wgtTimers = [];
let lastWidgetRendered = null;

function widgetEl(name) {
  return document.getElementById(name === 'weather' ? 'dashWeather' : 'dashStocks');
}

// Abort an in-progress carousel turn and snap both cards back to rest. Called
// when the notch collapses so a half-finished swing can't leave a card pinned
// (position:absolute) outside the shrunken notch.
function resetWidgetTurn() {
  if (!widgetTurning && wgtTimers.length === 0) return;
  wgtTimers.forEach(clearTimeout);
  wgtTimers = [];
  ['weather', 'stocks'].forEach(name => {
    const el = widgetEl(name);
    if (!el) return;
    el.classList.remove('wgt-turning', 'wgt-leaving', 'wgt-instant',
                        'wgt-off-left', 'wgt-off-right', 'wgt-settled');
    el.style.position = el.style.left = el.style.top = '';
    el.style.width = el.style.height = el.style.zIndex = '';
  });
  widgetTurning = false;
  renderWidgets(); // restore just the current widget, visible and settled
}

// Turn the carousel one step. dir > 0 advances (current exits left, next enters
// from the right); dir < 0 mirrors that.
function nextWidget(dir) {
  if (selectedWidgets.length < 2) return;
  // Ignore anything that arrives mid-turn. Queueing them let a burst of swipes
  // stack turns faster than they could run; this check sits BEFORE widgetIndex
  // moves, so a dropped swipe cannot desync the index from what is on screen.
  if (widgetTurning) return;

  const n = selectedWidgets.length;
  const step = (dir || 1) > 0 ? 1 : -1;
  const outgoing = widgetEl(selectedWidgets[widgetIndex]);
  widgetIndex = (widgetIndex + step + n) % n;
  const incoming = widgetEl(selectedWidgets[widgetIndex]);

  if (!outgoing || !incoming || outgoing === incoming) {
    renderWidgets();
    return;
  }
  widgetTurning = true;

  // Any timers still pending from an earlier turn would fire into this one and
  // hide the wrong card.
  wgtTimers.forEach(clearTimeout);
  wgtTimers = [];

  const outTo = step > 0 ? 'wgt-off-left' : 'wgt-off-right';
  const inFrom = step > 0 ? 'wgt-off-right' : 'wgt-off-left';

  // 1. Lift the outgoing card out of the flex flow, pinned over the slot it
  //    already occupies. Both cards are visible during the turn, and while they
  //    are both in flow the column stacks them and the layout jumps.
  const col = document.getElementById('dashWidgetsCol');
  const colRect = col.getBoundingClientRect();
  const outRect = outgoing.getBoundingClientRect();
  outgoing.style.position = 'absolute';
  outgoing.style.left = (outRect.left - colRect.left) + 'px';
  outgoing.style.top = (outRect.top - colRect.top) + 'px';
  outgoing.style.width = outRect.width + 'px';
  outgoing.style.height = outRect.height + 'px';
  outgoing.style.zIndex = '2';

  // 2. Park the next face off-stage and let it paint BEFORE anything moves.
  //    It has been display:none until now, so its first layout and paint are
  //    expensive — a weather card is six SVG columns, a stocks card three
  //    sparklines. Doing that on the same frame the swing starts is what the
  //    stutter was: the animation's opening frames were competing with a full
  //    paint of a card that had never been rendered.
  incoming.classList.remove('wgt-settled');
  incoming.classList.add('wgt-turning', 'wgt-instant', inFrom);
  incoming.style.display = 'flex';
  void incoming.offsetWidth;                 // force layout now, not mid-swing

  requestAnimationFrame(() => {
    // The parked card has been painted by this point, so the swing below only
    // has to re-composite two existing layers.
    outgoing.classList.remove('wgt-settled');
    outgoing.classList.add('wgt-turning', 'wgt-leaving');
    requestAnimationFrame(() => outgoing.classList.add(outTo));

    // 3. Release the arriving card once the outgoing one has nearly finished,
    //    so for most of the turn only a single card is animating.
    wgtTimers.push(setTimeout(() => {
      incoming.classList.remove('wgt-instant');
      requestAnimationFrame(() => {
        incoming.classList.remove(inFrom);
        incoming.classList.add('wgt-settled');
      });
    }, WGT_STAGGER_MS));

    wgtTimers.push(setTimeout(() => {
      outgoing.style.display = 'none';
      outgoing.classList.remove(outTo, 'wgt-leaving', 'wgt-turning');
      // Hand the card back to the flex flow for its next turn.
      outgoing.style.position = outgoing.style.left = outgoing.style.top = '';
      outgoing.style.width = outgoing.style.height = outgoing.style.zIndex = '';
      widgetTurning = false;
      // Drop the layer hints a beat later so a static dashboard isn't holding
      // promoted layers, and keep the data resync off the final frame.
      setTimeout(() => {
        incoming.classList.remove('wgt-turning');
        renderWidgets();
      }, 50);
    }, WGT_SWING_MS + WGT_STAGGER_MS));
  });
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
  const navPrev = document.getElementById('widgetNavPrev');
  if (navPrev) navPrev.addEventListener('click', (e) => { e.stopPropagation(); nextWidget(-1); });

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
        // Match the turn length (590ms) — a shorter window let gestures
        // arrive faster than the carousel could run them, and every one that
        // landed mid-turn was thrown away anyway.
        setTimeout(() => { swipeCooldown = false; }, 620);
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

// A native file drag never delivers mousemove, so the hover machinery that
// normally opens the notch and turns OFF click-through can't see it. We drive
// the whole drag as one explicit "session": enter once → disable click-through
// (otherwise the OS routes the drag straight past the notch and nothing can
// land) and open the tray; leave for real → collapse. A drag-depth counter
// makes crossing between child elements a no-op instead of an expand/collapse
// storm — dragenter/dragleave both bubble from every child.
let dragDepth = 0;
let qsHot = false;

function setQsHighlight(on) {
  const qsIcon = document.getElementById('quickShareIcon');
  if (!qsIcon || qsHot === on) return;   // only write on change — no per-frame reflow
  qsHot = on;
  qsIcon.style.background = on ? 'rgba(66, 133, 244, 0.4)' : '';
  qsIcon.style.transform = on ? 'scale(1.1)' : '';
  qsIcon.style.transition = 'background 0.15s ease, transform 0.15s ease';
}

function beginDragSession() {
  isDragActive = true;
  clearTimeout(dragLeaveTimer);
  window.notchAPI.setIgnoreMouse(false);   // make the notch a real drop surface
  if (currentState !== 'file-tray') {
    currentState = 'file-tray';
    notch.setAttribute('data-state', 'file-tray');
    if (!isExpanded) expand(); else showActivePanel();
    renderFileTray();
  }
  const dz = document.getElementById('ftDropzone');
  if (dz) dz.classList.add('drag-over');
}

function endDragSession() {
  dragDepth = 0;
  isDragActive = false;
  setQsHighlight(false);
  const dz = document.getElementById('ftDropzone');
  if (dz) dz.classList.remove('drag-over');
  // Grace period: a fast drag back in (or the layout shift from expanding)
  // cancels the collapse instead of flickering it shut.
  clearTimeout(dragLeaveTimer);
  dragLeaveTimer = setTimeout(() => {
    if (!isMouseOverNotch && currentState === 'file-tray') collapse();
  }, 400);
}

document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  if (dragDepth === 1) beginDragSession();
});

document.addEventListener('dragover', (e) => {
  if (!isDragActive) return;
  e.preventDefault();                    // required for 'drop' to fire
  e.dataTransfer.dropEffect = 'copy';
  const qsIcon = document.getElementById('quickShareIcon');
  setQsHighlight(!!(qsIcon && (qsIcon.contains(e.target) || qsIcon === e.target)));
});

document.addEventListener('dragleave', (e) => {
  if (!isDragActive) return;
  dragDepth--;
  if (dragDepth <= 0) endDragSession();   // only fires on a true window exit
});

document.addEventListener('dragend', () => {
  if (isDragActive) endDragSession();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  isDragActive = false;
  setQsHighlight(false);
  const dz = document.getElementById('ftDropzone');
  if (dz) dz.classList.remove('drag-over');

  // Electron 32+ dropped File.path — resolve the real path via webUtils instead,
  // otherwise every dropped file came through as undefined and nothing shared.
  const pathFor = (f) => {
    try { return f && window.notchAPI.getPathForFile ? window.notchAPI.getPathForFile(f) : (f && f.path); }
    catch (err) { return f && f.path; }
  };
  const files = [];
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    for (const f of e.dataTransfer.files) {
      const p = pathFor(f);
      if (p) files.push(p);
    }
  } else if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
    for (const item of e.dataTransfer.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        const p = pathFor(f);
        if (p) files.push(p);
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
      const textEl = document.querySelector('.msg-text');
      const textExpEl = document.querySelector('.msg-exp-text');
      const appIcon = document.querySelector('.msg-app-icon');
      const appIconSmall = document.querySelector('.msg-app-icon-small');
      setMsgSender(data.sender, data.avatar);
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
    
    // The reply stays on screen until the extension confirms it landed, so a
    // failed send is visible instead of silently vanishing.
    function setReplyStatus(text, kind) {
      const el = document.getElementById('msgReplyStatus');
      if (!el) return;
      el.textContent = text || '';
      el.className = 'msg-reply-status' + (kind ? ' ' + kind : '');
    }

    function clearPendingAttachment() {
      pendingAttachment = null;
      const chip = document.getElementById('msgAttachChip');
      if (chip) chip.classList.remove('visible');
    }

    function handleSendReply() {
      const text = replyInput ? replyInput.value.trim() : '';
      if (!text && !pendingAttachment) return;
      if (!(window.notchAPI && window.notchAPI.sendReply)) return;

      window.notchAPI.sendReply({
        text,
        attachment: pendingAttachment,
        sender: activeReplyContext ? activeReplyContext.sender : null,
        app: activeReplyContext ? activeReplyContext.app : null
      });

      if (replyInput) replyInput.value = '';
      clearPendingAttachment();
      setReplyStatus('Sending…', 'pending');
      if (window.msgCollapseTimeout) {
        clearTimeout(window.msgCollapseTimeout);
        window.msgCollapseTimeout = null;
      }
    }

    if (window.notchAPI && window.notchAPI.onReplyStatus) {
      window.notchAPI.onReplyStatus((status) => {
        if (status && status.ok) {
          setReplyStatus('Sent', 'ok');
          setTimeout(() => {
            setReplyStatus('');
            if (currentState === 'msg-expanded' && !isMouseOverNotch) {
              collapse();
              setTimeout(decideState, 350);
            }
          }, 1200);
        } else {
          setReplyStatus((status && status.error) || 'Could not send', 'err');
        }
      });
    }

    if (replyAttach) {
      replyAttach.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(window.notchAPI && window.notchAPI.selectAttachment)) return;
        const files = await window.notchAPI.selectAttachment();
        if (!files || !files.length) return;

        // Attach it to the pending reply instead of firing it off immediately,
        // so a caption can go with the picture.
        pendingAttachment = files[0];
        const chip = document.getElementById('msgAttachChip');
        const thumb = document.getElementById('msgAttachThumb');
        const name = document.getElementById('msgAttachName');
        const fileName = pendingAttachment.split(/[\\/]/).pop();
        if (name) name.textContent = fileName;
        if (thumb) {
          const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName);
          thumb.style.display = isImage ? 'block' : 'none';
          if (isImage) thumb.src = 'file:///' + pendingAttachment.replace(/\\/g, '/');
        }
        if (chip) chip.classList.add('visible');
        setReplyStatus('');
        if (replyInput) replyInput.focus();
      });
    }

    const attachRemove = document.getElementById('msgAttachRemove');
    if (attachRemove) {
      attachRemove.addEventListener('click', e => { e.stopPropagation(); clearPendingAttachment(); });
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
  const introImg = document.getElementById('introImage');

  // Hide all other panels first
  hideAllPanels();

  // Compose the banner while the notch is still invisible (`.boot` => opacity 0)
  // so the first thing the user sees is the intro image — never an empty black
  // notch. Size it with transitions off so it doesn't visibly grow from the
  // collapsed pill; the reveal is a single clean opacity fade below.
  if (panel) {
    panel.style.display = 'flex';
    panel.style.opacity = '1';
  }
  notch.classList.remove('collapsed');
  notch.classList.add('expanded');
  isExpanded = true;
  window.notchAPI.setIgnoreMouse(false);

  notch.style.transition = 'none';
  notch.style.width = '800px';
  notch.style.height = '200px';
  notch.style.borderRadius = '0 0 32px 32px';
  if (intro) { intro.style.transition = 'none'; intro.style.opacity = '1'; }
  void notch.offsetHeight; // flush layout before re-enabling transitions
  notch.style.transition = '';
  if (intro) intro.style.transition = '';

  let started = false;
  const startTimeline = () => {
    if (started) return;
    started = true;

    // Phase 1: reveal the fully-composed banner in one clean fade — this is the
    // first thing on screen, with the boot chime.
    notch.classList.remove('boot');
    playAppleBootChime();

    // Phase 2: hold, then fade the intro image out.
    setTimeout(() => { if (intro) intro.style.opacity = '0'; }, 2800);

    // Phase 3: morph to the hello widget and play the hello animation.
    setTimeout(() => {
      if (intro) intro.style.display = 'none';
      notch.style.width = '520px';
      notch.style.height = '140px';
      notch.style.borderRadius = '0 0 32px 32px';

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
    }, 3600);

    // Phase 4: fade hello out, then collapse down to the mini notch.
    setTimeout(() => {
      if (hello) hello.style.opacity = '0';

      setTimeout(() => {
        if (panel) { panel.style.opacity = '0'; panel.style.display = 'none'; }
        if (collapsedView) collapsedView.style.display = '';
        notch.style.width = '';
        notch.style.height = '';
        notch.style.borderRadius = '';

        // Leave startup state and collapse to the mini (collapsed) notch so the
        // app settles into its resting pill, not the full dashboard.
        forcedPanel = null;
        currentState = 'idle';
        notch.setAttribute('data-state', 'idle');
        isExpanded = true; // ensure collapse() actually runs
        collapse();
      }, 520);
    }, 6800);
  };

  // Don't reveal until the intro image is actually painted, otherwise the fade
  // shows through to black. Fall back on a timer if load never fires.
  if (introImg && !introImg.complete) {
    introImg.addEventListener('load', () => requestAnimationFrame(startTimeline), { once: true });
    setTimeout(() => requestAnimationFrame(startTimeline), 500);
  } else {
    requestAnimationFrame(startTimeline);
  }
}

document.addEventListener('DOMContentLoaded', runStartupSequence);

