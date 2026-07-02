/* ═══════════════════════════════════════
   Dynamic Notch — Core Logic (Rebuild)
   ═══════════════════════════════════════ */

let isExpanded = false;
let hoverTimeout = null;
let currentState = 'idle';
let mediaData = { playing: false };
let recordingData = { recording: false };
let batteryData = { percent: 100, isCharging: false };
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

// Timer state
let isTimerActive = false;
let isTimerPaused = false;
let localTimerTotal = 0;
let localTimerElapsed = 0;
let localTimerInterval = null;

const notch = document.getElementById('notch');
const collapsedView = document.getElementById('collapsedView');

// --- External Timers Sync ---
let lastExternalSyncTime = 0;
window.notchAPI.onExternalTimerUpdate((data) => {
  const now = Date.now();
  if (data.type === 'chrome' || data.type === 'focus') {
    if (data.seconds > 0) {
      if (!isTimerActive) {
        startTimer(data.seconds);
      } else {
        const currentRemaining = localTimerTotal - Math.floor(localTimerElapsed / 1000);
        if (Math.abs(currentRemaining - data.seconds) > 1 || isTimerPaused !== (data.state === 'PAUSED')) {
          localTimerTotal = data.seconds;
          localTimerElapsed = 0;
          isTimerPaused = (data.state === 'PAUSED');
          updateTimerUI();
        }
      }
      lastExternalSyncTime = now;
    }
  } else if (data.type === 'none_timer') {
    if (isTimerActive && (now - lastExternalSyncTime > 1500)) {
      isTimerActive = false;
      clearInterval(localTimerInterval);
      decideState();
    }
  } else if (data.type === 'mic_active') {
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
  download:        'panelDownload',
  dnd:             'panelDnd'
};

function hideAllPanels() {
  Object.values(panelMap).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.style.opacity = '0'; }
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
        }
        el.style.opacity = '1';
      } else {
        el.style.display = 'none';
        el.style.opacity = '0';
      }
    }
  });
  
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
    const battSpan = document.getElementById('cNoteBattery');
    if (battSpan) {
        if (device.battery > -1) {
            battSpan.textContent = device.battery + '%';
            battSpan.style.display = 'inline-block';
            battSpan.classList.toggle('low', device.battery <= 20);
        } else {
            battSpan.style.display = 'none';
        }
    }

    if (!btToastTimeout) {
        showBluetoothToast(device);
    }
  } else {
    btConnectedDevice = null;
    const battSpan = document.getElementById('cNoteBattery');
    if (battSpan) battSpan.style.display = 'none';
    decideState();
  }
}

function decideState() {
  if (forcedPanel === 'panelSlider' || forcedPanel === 'panelDnd') return; // Don't override forced state
  if (currentState === 'file-tray' || currentState === 'video') return; // Don't override active states

  let s = 'idle';
  if (recordingData.recording) s = 'recording';
  else if (isTimerActive) s = 'timer';
  else if (battToastTimeout) s = 'battery';
  else if (btToastTimeout) s = 'bluetooth';
  else if (btConnectedDevice && (mediaData.playing || mediaData.paused)) s = 'bt-music';
  else if (btConnectedDevice) s = 'bt-connected';
  else if (mediaData.playing || mediaData.paused) s = 'music';
  
  setState(s);

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
  if (currentState === 'recording' || currentState === 'timer') return; // Force keep expanded
  isExpanded = false;
  forcedPanel = null; // Reset pin
  if (currentState === 'file-tray') currentState = 'idle';
  hideAllPanels();
  notch.classList.remove('expanded');
  notch.classList.add('collapsed');
  notch.classList.remove('forced-full'); // Remove forced size
  window.notchAPI.setIgnoreMouse(true);
  decideState(); // Refresh sub-notch
}

let isMicRecording = false;

/* ─── Interactions ─── */
function setupInteractions() {
  notch.addEventListener('mouseenter', () => {
    isMouseOverNotch = true;
    window.notchAPI.setIgnoreMouse(false);
    if (!isExpanded) hoverTimeout = setTimeout(() => {
        expand();
    }, 180);
  });
  notch.addEventListener('mouseleave', () => {
    isMouseOverNotch = false;
    const searchInput = document.getElementById('dashSearchInput');
    if (searchInput && document.activeElement === searchInput) return;
    if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
    if (currentState === 'file-tray' && isDragActive) return; // Do not collapse when actively dragging files
    if (currentState === 'recording') return; // Do not collapse during recording
    if (ignoreMouseLeave) return; // Ignore collapse during transition cooldown
    if (isExpanded) {
        collapse();
    }
    window.notchAPI.setIgnoreMouse(true);
  });
  collapsedView.addEventListener('click', e => { 
    e.stopPropagation(); 
    if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; } 
    expand(); 
  });

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
  const pStar = document.getElementById('shuffleBtn'); // panelMusic star
  if(pStar) pStar.addEventListener('click', (e) => {
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
    } else {
      toggleStar(pStar);
    }
  });

  const dStar = document.getElementById('dashStarBtn'); // dashMusic star
  if(dStar) dStar.addEventListener('click', (e) => {
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
    } else {
      toggleStar(dStar);
    }
  });

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
          searchMicBtn.innerHTML = originalMicSvg;
          dashSearchInput.placeholder = 'Search Google...';
          if (activeMicStop) activeMicStop();
          if (processRecording) processRecording();
          return;
        }
        
        try {
          isMicRecording = true;
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
            }
          };
          
        } catch (err) {
          console.error('Speech recognition error:', err);
          dashSearchInput.placeholder = 'Mic error!';
          isMicRecording = false;
          searchMicBtn.innerHTML = originalMicSvg;
          setTimeout(() => dashSearchInput.placeholder = 'Search Google...', 2000);
        }
    });
  }
  
  // Dashboard calendar view horizontal swipe navigation
  const dashCal = document.querySelector('.dash-cal');

  if (dashCal) {
    let lastScrollTime = 0;
    
    dashCal.addEventListener('wheel', e => {
      e.stopPropagation();
      // Vertical swipe to change days with throttle
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const now = Date.now();
        if (now - lastScrollTime > 300) { // 300ms cooldown
          if (e.deltaY > 0) calendarOffset++;
          else calendarOffset--;
          updateClock();
          lastScrollTime = now;
        }
      }
    });
  }
}

/* ─── Clock / Calendar ─── */
function updateClock() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('cTime').textContent = `${h % 12 || 12}:${m}`;
  document.getElementById('cPeriod').textContent = h >= 12 ? 'Pm' : 'Am';

  const target = new Date(); target.setDate(now.getDate() + calendarOffset);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fullMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  
  document.getElementById('dashMonth').textContent = months[target.getMonth()];

  const shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const fullDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  
  const cDateEl = document.getElementById('cDate');
  const dateStr = `${shortDays[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
  if (cDateEl) cDateEl.textContent = dateStr;

  const bigTime = document.getElementById('bigTime');
  const bigDate = document.getElementById('bigDate');
  if (bigTime) bigTime.textContent = `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
  if (bigDate) bigDate.textContent = dateStr;

  const strip = document.getElementById('dashDays');
  if (strip) {
    strip.innerHTML = '';
    // Render past 7 days and future 14 days to allow scrolling
    for (let i = -7; i <= 14; i++) {
      const d = new Date(target); d.setDate(target.getDate() + i);
      const name = shortDays[d.getDay()];
      const num = d.getDate().toString().padStart(2, '0');
      // Ensure the 'active' day is when i === 0
      strip.innerHTML += `<div class="day${i===0?' active':''}"><span>${name}</span><span>${num}</span></div>`;
    }
    // Set scroll position to center the active item (roughly)
    setTimeout(() => {
      const activeEl = strip.querySelector('.active');
      if (activeEl) {
        strip.scrollLeft = activeEl.offsetLeft - strip.offsetWidth / 2 + activeEl.offsetWidth / 2;
      }
    }, 0);

    // Fetch and display events for the current target date
    fetchCalendar();
  }
}

/* ─── Media ─── */
function handleMediaUpdate(data) {
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
        decideState();
      } else {
        updateTimerUI();
      }
    }
  }, 1000);
  decideState();
}

function updateTimerUI() {
  const rem = localTimerTotal - localTimerElapsed;
  const mm = Math.floor(rem / 60);
  const ss = (rem % 60).toString().padStart(2, '0');
  const txt = document.getElementById('timerText');
  if (txt) txt.textContent = `${mm}:${ss}`;
  
  const cTxt = document.getElementById('cTimerTime');
  if (cTxt) cTxt.textContent = `${mm}:${ss}`;

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
      } else {
        footer.querySelector('span').textContent = 'Nothing for today';
        footer.style.color = 'rgba(255,255,255,0.35)';
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

function updateMusicUI() {
  const coverImg = document.getElementById('coverImg');
  const placeholder = document.getElementById('albumPlaceholder');
  const cAlbum = document.getElementById('cAlbumImg');

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
    } else if (bat.percent < 10) {
      dashBattPctText.style.color = 'var(--red)';
      dashBattFill.setAttribute('fill', 'var(--red)');
    } else if (bat.powerSaver) {
      dashBattPctText.style.color = '#fbbf24';
      dashBattFill.setAttribute('fill', '#fbbf24');
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
    } else if (bat.percent < 10) {
      cBattery.classList.add('low');
    } else if (bat.powerSaver) {
      cBattery.classList.add('saver');
    } else if (bat.percent <= 20) {
      cBattery.classList.add('low');
    }
  }
}

function showBatteryToast(bat) {
  if (battToastTimeout) clearTimeout(battToastTimeout);

  if (bat.isCharging) {
    document.getElementById('chargingPct').textContent = bat.percent + '%';
    document.getElementById('chargingBattFill').setAttribute('width', Math.max(1, (bat.percent/100)*15));
    setState('charging'); expand();
    battToastTimeout = setTimeout(() => { battToastTimeout = null; collapse(); setTimeout(decideState, 400); }, 4000);
    return;
  }

  if (bat.percent <= 20) {
    document.getElementById('lowBattPct').textContent = bat.percent + '%';
    document.getElementById('lowBattFill').setAttribute('width', Math.max(1, (bat.percent/100)*15));
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
  setState('bluetooth'); expand();
  btToastTimeout = setTimeout(() => {
    btToastTimeout = null;
    collapse();
    setTimeout(decideState, 400); // will pick bt-connected or bt-music
  }, 5000);
}

/* ─── Recording ─── */
async function fetchRecording() {
  // Handled by external-timers now.
}

/* ─── Init ─── */
  document.addEventListener('DOMContentLoaded', () => {
  setupInteractions();
  updateClock();
  setInterval(updateClock, 1000);
  
  // Hook up Timer buttons
  const timerPauseBtn = document.getElementById('timerPauseBtn');
  const timerCancelBtn = document.getElementById('timerCancelBtn');
  if (timerPauseBtn) {
    timerPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.notchAPI.setSysVal('toggleChromeTimer', 'true');
      isTimerPaused = !isTimerPaused;
      updateTimerUI();
    });
  }
  if (timerCancelBtn) {
    timerCancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isTimerActive = false;
      clearInterval(localTimerInterval);
      decideState();
    });
  }
  
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
  if (window.notchAPI.onLockUpdate) {
    window.notchAPI.onLockUpdate(e => {
      if (e === 'LOCK') {
        notch.classList.remove('success');
        setState('unlock'); expand();
      } else if (e === 'UNLOCK') {
        notch.classList.add('success');
        setTimeout(() => { collapse(); notch.classList.remove('success'); setTimeout(decideState, 400); }, 1200);
      }
    });
  }

  window.notchAPI.onAudioPeak((peak) => {
    updateVisualizerWithPeak(peak);
  });
  
  window.notchAPI.onMicPeak((peak) => {
    updateMicVisualizerWithPeak(peak);
  });
});

let currentSliderType = 'vol';
let isDraggingSlider = false;
let sliderTimeout = null;

function updateSliderUI(val, isBright, fromDrag = false) {
  const d = document.getElementById('sliderDashes');
  const p = document.getElementById('sliderPct');
  const i = document.getElementById('sliderIcon');
  if (!d || !p || !i) return;

  if (!fromDrag) {
    currentSliderType = isBright ? 'bright' : 'vol';
  }

  d.innerHTML = '';
  const maxDashes = 34;
  const activeDashes = Math.round((val / 100) * maxDashes);
  for (let j = 0; j < maxDashes; j++) {
    const dash = document.createElement('div');
    dash.className = 'slider-dash' + (j < activeDashes ? ' active' : '');
    d.appendChild(dash);
  }
  p.textContent = val + '%';

  if (isBright) {
    i.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3zm0-13l2.32 3.23h3.45v3.45L21 12l-3.23 2.32v3.45h-3.45L12 21l-2.32-3.23H6.23v-3.45L3 12l3.23-2.32V6.23h3.45L12 2z"/></svg>';
  } else {
    i.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  }

  if (!fromDrag) {
    forcedPanel = 'panelSlider';
    notch.setAttribute('data-state', 'slider');
    expand();
    showActivePanel();
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

function showSlider(val, isBright) {
  updateSliderUI(val, isBright, false);
  forcedPanel = 'panelSlider';
  notch.setAttribute('data-state', 'slider');
  expand();
  showActivePanel();
  
  clearTimeout(sliderTimeout);
  sliderTimeout = setTimeout(() => {
    forcedPanel = null;
    collapse();
  }, 2000);
}

if (window.notchAPI.onSysVol) window.notchAPI.onSysVol(v => showSlider(v, false));
if (window.notchAPI.onSysBright) window.notchAPI.onSysBright(v => showSlider(v, true));

let downloadTimeout = null;
if (window.notchAPI.onDownloadUpdate) {
  window.notchAPI.onDownloadUpdate((data) => {
    const { state, filename } = data;
    const dlArrow = document.getElementById('dlArrow');
    const dlCheck = document.getElementById('dlCheck');
    const dlTitle = document.getElementById('dlTitle');
    const dlFilename = document.getElementById('dlFilename');
    
    if (dlFilename) dlFilename.textContent = filename || '';
    
    if (state === 'downloading') {
      dlTitle.textContent = 'Downloading...';
      dlTitle.style.color = '#fff';
      dlArrow.style.display = 'block';
      dlCheck.style.display = 'none';
      dlArrow.classList.add('dl-anim-bounce');
      dlCheck.classList.remove('dl-check-anim');
      
      forcedPanel = 'panelDownload';
      notch.setAttribute('data-state', 'download');
      expand();
      showActivePanel();
      
      clearTimeout(downloadTimeout);
    } else if (state === 'complete') {
      dlTitle.textContent = 'Download Complete';
      dlTitle.style.color = '#0a84ff';
      dlCheck.style.stroke = '#0a84ff';
      dlArrow.style.display = 'none';
      dlCheck.style.display = 'block';
      dlArrow.classList.remove('dl-anim-bounce');
      
      dlCheck.classList.remove('dl-check-anim');
      void dlCheck.offsetWidth; // trigger reflow
      dlCheck.classList.add('dl-check-anim');
      
      forcedPanel = 'panelDownload';
      notch.setAttribute('data-state', 'download');
      expand();
      showActivePanel();
      
      clearTimeout(downloadTimeout);
      downloadTimeout = setTimeout(() => {
        if (forcedPanel === 'panelDownload') {
          forcedPanel = null;
          collapse();
        }
      }, 3000);
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


