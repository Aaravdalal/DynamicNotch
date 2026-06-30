const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getMediaInfo, controlMedia } = require('./modules/media');
const googleCalendar = require('./modules/google-calendar');
const { startBluetoothMonitor } = require('./modules/bluetooth');
const { getRecordingStatus } = require('./modules/recording');
const { startBatteryMonitor, getBatteryStatus } = require('./modules/battery');
const { initFileTray } = require('./modules/file-tray');
const { spawn } = require('child_process');

// ─── Global crash prevention ───
process.on('uncaughtException', (err) => {
  console.error('[CRASH PREVENTED] uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH PREVENTED] unhandledRejection:', reason);
});

let mainWindow;
let tray;
let alwaysOnTopInterval = null;
const userDataPath = app.getPath('userData');
const profileImageStore = path.join(userDataPath, 'profileImage.json');

// ─── Track all child processes for cleanup ───
const childProcesses = [];

function spawnTracked(...args) {
  const proc = spawn(...args);
  childProcesses.push(proc);
  proc.on('error', (err) => {
    console.error(`[Child Process Error] ${args[0]}:`, err.message);
  });
  proc.on('close', () => {
    const idx = childProcesses.indexOf(proc);
    if (idx > -1) childProcesses.splice(idx, 1);
  });
  return proc;
}

function killAllChildren() {
  for (const proc of childProcesses) {
    try { proc.kill(); } catch (e) {}
  }
  childProcesses.length = 0;
}

function safeSend(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, data);
    } catch (e) {}
  }
}

const WIN_WIDTH = 1100;
const WIN_HEIGHT = 450; 

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x: Math.round((screenWidth - WIN_WIDTH) / 2),
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    thickFrame: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  // ─── Re-assert always-on-top periodically (prevents z-order loss) ───
  alwaysOnTopInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (e) {}
    }
  }, 2000);

  // Re-assert on focus events
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (e) {}
    }
  });

  mainWindow.on('show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (e) {}
    }
  });

  // Clean up on window close
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (alwaysOnTopInterval) {
      clearInterval(alwaysOnTopInterval);
      alwaysOnTopInterval = null;
    }
  });

  startBatteryMonitor((batState) => {
    safeSend('battery-update', batState);
  });

  startBluetoothMonitor((device) => {
    safeSend('bluetooth-update', device);
  });

  try {
    const lockMonitorProcess = spawnTracked(path.join(__dirname, 'scripts', 'lock-monitor.exe'), [], { windowsHide: true });
    lockMonitorProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const str = line.trim();
        if (str.startsWith('EVENT:')) {
          safeSend('lock-update', str.substring(6));
        }
      }
    });

    // Start Audio Peak Meter
    const audioMeterProc = spawnTracked('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'audio-meter.ps1')], { windowsHide: true });
    let audioBuffer = '';
    audioMeterProc.stdout.on('data', (data) => {
      audioBuffer += data.toString();
      const lines = audioBuffer.split(/\r?\n/);
      audioBuffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('PEAK:')) {
          const val = parseInt(trimmed.substring(5));
          safeSend('audio-peak', val);
        }
      }
    });

    // Start Sys Monitor (Volume & Brightness)
    const sysMonitorProc = spawnTracked(path.join(__dirname, 'scripts', 'sys-monitor.exe'), [], { windowsHide: true });
    let sysBuffer = '';
    sysMonitorProc.stdout.on('data', (data) => {
      sysBuffer += data.toString();
      const lines = sysBuffer.split(/\r?\n/);
      sysBuffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('VOL|')) {
          safeSend('sys-vol', parseInt(trimmed.substring(4)));
        } else if (trimmed.startsWith('BRIGHT|')) {
          safeSend('sys-bright', parseInt(trimmed.substring(7)));
        } else if (trimmed.startsWith('DND|')) {
          safeSend('sys-dnd', parseInt(trimmed.substring(4)));
        }
      }
    });
  } catch(e) {
    console.error('[Child Process Setup Error]', e.message);
  }
}

function createTray() {
  const iconB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABVSURBVFhH7ZHRBgAgEATv/3+6no6zOaLaJTvMS2JWRZgzRlGCB3gAdUCN7fgEjHQ+BWMoBYxS44k0nkjj/4J/e9sWvMhQGk89YDlgq38BD1COMMbEBAPBZqj6ppdVAAAAAElFTkSuQmCC';
  const icon = nativeImage.createFromDataURL(iconB64);
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Notch', click: () => mainWindow && mainWindow.show() },
    { label: 'Open Saved Files', click: () => {
        const fileTrayPath = path.join(app.getPath('userData'), 'file-tray');
        if (!fs.existsSync(fileTrayPath)) {
            fs.mkdirSync(fileTrayPath, { recursive: true });
        }
        shell.openPath(fileTrayPath);
    }},
    { label: 'Test AirPods', click: () => {
        safeSend('bluetooth-update', {name: "AirPods", connected: true, battery: 72, type: "earbuds"});
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Dynamic Notch');

  tray.on('click', () => {
    safeSend('open-file-tray');
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });
}

ipcMain.handle('control-media', async (_, action) => {
  try {
    await controlMedia(action);
  } catch (e) {
    console.error('[control-media error]', e.message);
  }
});

ipcMain.handle('set-sys-val', async (_, type, val) => {
  try {
    spawnTracked(path.join(__dirname, 'scripts', 'sys-monitor.exe'), [type, val.toString()]);
  } catch (e) {}
  return true;
});

ipcMain.handle('simulate-win-h', async () => {
  try {
    require('child_process').execFile(path.join(__dirname, 'scripts', 'sys-monitor.exe'), ['winH']);
  } catch (e) {}
  return true;
});

ipcMain.handle('get-bluetooth', async () => []);
ipcMain.handle('get-recording', async () => {
  try { return await getRecordingStatus(); } catch (e) { return { recording: false }; }
});

ipcMain.handle('start-speech-recognition', async () => {
  return new Promise((resolve) => {
    try {
      const proc = spawnTracked('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'speech-recognizer.ps1')], { windowsHide: true });
      
      let resultText = '';
      proc.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('RESULT:')) {
          const text = output.split('RESULT:')[1].trim();
          resultText = text;
          resolve(text);
        }
      });
      
      proc.on('close', () => {
        if (!resultText) resolve('');
      });

      // Timeout safety — don't hang forever
      setTimeout(() => { if (!resultText) resolve(''); }, 15000);
    } catch (e) {
      resolve('');
    }
  });
});

ipcMain.handle('transcribe-audio', async (e, pcmData) => {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const url = 'https://www.google.com/speech-api/v2/recognize?client=chromium&lang=en-US&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw';
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/l16; rate=16000'
        }
      }, (res) => {
        let resultText = '';
        res.on('data', chunk => resultText += chunk.toString());
        res.on('end', () => {
          try {
            const lines = resultText.split('\n').filter(l => l.trim().length > 0);
            const result = JSON.parse(lines[lines.length - 1]);
            if (result.result && result.result.length > 0 && result.result[0].alternative) {
              resolve(result.result[0].alternative[0].transcript);
            } else {
              resolve('');
            }
          } catch(err) {
            resolve('');
          }
        });
      });
      req.on('error', () => resolve(''));
      req.write(Buffer.from(pcmData));
      req.end();
    } catch (e) {
      resolve('');
    }
  });
});

ipcMain.handle('get-battery', async () => {
  try { return await getBatteryStatus(); } catch (e) { return { hasBattery: false, percent: 100, isCharging: false }; }
});
ipcMain.handle('get-calendar', async (_, targetDate) => {
  try { return await googleCalendar.getEvents(targetDate); } catch (e) { return []; }
});
ipcMain.handle('google-calendar-connect', async (e, config) => {
    try { googleCalendar.saveConfig({ ...config, connected: true }); } catch (e) {}
    return { success: true };
});

ipcMain.handle('open-calendar', () => {
  try { require('child_process').exec('start outlookcal:'); } catch (e) {}
});

ipcMain.handle('load-profile-image', async () => {
  try {
    if (fs.existsSync(profileImageStore)) {
      const data = fs.readFileSync(profileImageStore, 'utf8');
      const json = JSON.parse(data);
      return json.imagePath || null;
    }
  } catch (e) {}
  return null;
});

ipcMain.handle('select-profile-image', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Profile Picture',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const imagePath = result.filePaths[0];
      fs.writeFileSync(profileImageStore, JSON.stringify({ imagePath }));
      return imagePath;
    }
  } catch (e) {}
  return null;
});

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
        mainWindow.setFocusable(!ignore);
      } catch (e) {}
    }
  });

  ipcMain.on('focus-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setFocusable(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (e) {}
    }
  });

app.whenReady().then(() => {
  initFileTray();
  const { session } = require('electron');
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return true;
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setDevicePermissionHandler((details) => {
    return true;
  });

  ipcMain.handle('open-url', (_, url) => {
    require('child_process').exec(`powershell -NoProfile -Command "Start-Process chrome -ArgumentList '${url}'"`, (err) => {
      if (err) require('electron').shell.openExternal(url);
    });
  });
  createWindow();
  createTray();

  ipcMain.handle('get-media', async () => {
    try { return getMediaInfo(); } catch (e) { return { playing: false }; }
  });
  
  const weather = require('weather-js');
  ipcMain.handle('fetch-weather', async (_, city) => {
    return new Promise((resolve, reject) => {
      try {
        weather.find({search: city, degreeType: 'F'}, function(err, result) {
          if(err) resolve(null);
          else resolve(result[0] || null);
        });
      } catch (e) { resolve(null); }
    });
  });

  const { onMediaUpdate } = require('./modules/media');
  onMediaUpdate((data) => {
    safeSend('media-update', data);
  });
});

// ─── Clean shutdown ───
app.on('before-quit', () => {
  killAllChildren();
  try {
    const { destroyMediaMonitor } = require('./modules/media');
    if (destroyMediaMonitor) destroyMediaMonitor();
  } catch (e) {}
  if (alwaysOnTopInterval) {
    clearInterval(alwaysOnTopInterval);
    alwaysOnTopInterval = null;
  }
});

app.on('window-all-closed', () => app.quit());
