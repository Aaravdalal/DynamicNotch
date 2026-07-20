const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell, globalShortcut } = require('electron');

// Disable hardware acceleration to prevent GPU crashes on Windows power-saver mode (fixes blank QR codes)
app.disableHardwareAcceleration();

const path = require('path');
const fs = require('fs');
const { getMediaInfo, controlMedia } = require('./modules/media');
const googleCalendar = require('./modules/google-calendar');
const { startBluetoothMonitor } = require('./modules/bluetooth');
const { getRecordingStatus } = require('./modules/recording');
const { startBatteryMonitor, getBatteryStatus } = require('./modules/battery');
const { initFileTray } = require('./modules/file-tray');
const { startExternalTimersMonitor } = require('./modules/external-timers');
const { startDownloadsMonitor } = require('./modules/downloads');
const { startHeartbeat } = require('./modules/heartbeat');
const { startForegroundMonitor, getLastForegroundApp } = require('./modules/foreground-app');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

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
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required'
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube-nocookie.com/embed/*', '*://*.youtube.com/embed/*'] },
    (details, callback) => {
      if (details.resourceType === 'subFrame') {
        details.requestHeaders['Referer'] = 'http://localhost/';
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

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
    console.log('[DEBUG] Battery State received from monitor:', batState);
    safeSend('battery-update', batState);
  });

  startBluetoothMonitor((device) => {
    safeSend('bluetooth-update', device);
  });

  startExternalTimersMonitor((data) => {
    safeSend('external-timer-update', data);
  });

  startDownloadsMonitor((data) => {
    safeSend('download-update', data);
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
          const parts = trimmed.split('|');
          for (const p of parts) {
            if (p.startsWith('PEAK:')) {
              safeSend('audio-peak', parseInt(p.substring(5)));
            } else if (p.startsWith('MIC_PEAK:')) {
              safeSend('mic-peak', parseInt(p.substring(9)));
            }
          }
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
        if (trimmed.startsWith('VOL_FLYOUT|')) {
          // Only a real volume-key press (Windows flyout) shows the notch.
          safeSend('sys-vol', parseInt(trimmed.substring(11)));
        } else if (trimmed.startsWith('VOL|')) {
          // Volume changed by some other means (app/programmatic) — ignore so
          // the slider notch only appears when the user presses a volume key.
        } else if (trimmed.startsWith('BRIGHT|')) {
          safeSend('sys-bright', parseInt(trimmed.substring(7)));
        } else if (trimmed.startsWith('DND|')) {
          safeSend('sys-dnd', parseInt(trimmed.substring(4)));
        } else if (trimmed.startsWith('DEBUG_VOL_CLASS|')) {
          console.log('[DEBUG_VOL]', trimmed.substring(16));
        } else if (trimmed.startsWith('ERR|')) {
          console.log('[SYS_MON_ERR]', trimmed.substring(4));
        }
      }
    });

    // Python Message Interceptor removed

    // --- NEW: Local Notification API Server ---
    try {
      const http = require('http');
      const server = http.createServer((req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }

        if (req.method === 'POST' && req.url === '/notify') {
          let body = '';
          req.on('data', chunk => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body);
              if (payload.sender || payload.text) {
                console.log(`[LocalAPI] New Message from ${payload.sender}: ${payload.text}`);
                safeSend('live-message', {
                  app: payload.app || 'messages',
                  sender: payload.sender || 'Unknown',
                  text: payload.text || '',
                  time: payload.time || 'now'
                });
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        } else if (req.method === 'POST' && req.url === '/unreads') {
          let body = '';
          req.on('data', chunk => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body);
              if (Array.isArray(payload.list)) {
                safeSend('unreads-list', payload.list);
                safeSend('unread-count', payload.list.length);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(8080, '0.0.0.0', () => {
        console.log('[LocalAPI] Listening for notifications on port 8080 (0.0.0.0)');
      });
    } catch(e) {
      console.error('[LocalAPI Error]', e.message);
    }
    // ----------------------------------------

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
    { label: 'Login to Google Messages', click: () => showMessagesLogin() },
    { label: 'Login to Gchat', click: () => hiddenGchat && hiddenGchat.show() },
    { label: 'Reset Messages Login (blank QR fix)', click: () => resetMessagesSession() },
    { type: 'separator' },
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
    if (type === 'toggleRec') {
      const scriptPath = path.join(__dirname, 'scripts', 'control-recorder.ps1');
      spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-WindowStyle', 'Hidden', '-File', scriptPath, 'Pause'], { windowsHide: true });
    } else if (type === 'stopRec') {
      const scriptPath = path.join(__dirname, 'scripts', 'control-recorder.ps1');
      spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-WindowStyle', 'Hidden', '-File', scriptPath, 'Stop'], { windowsHide: true });
    } else if (type === 'toggleChromeTimer') {
      const { sendTimerCommand } = require('./modules/external-timers');
      sendTimerCommand('toggleChrome');
    } else {
      spawnTracked(path.join(__dirname, 'scripts', 'sys-monitor.exe'), [type, val.toString()]);
    }
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

ipcMain.handle('select-attachment', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Attachment',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths;
    }
  } catch (e) {}
  return [];
});

const quickLaunchStore = path.join(app.getPath('userData'), 'quick-launch.json');

function readQuickLaunch() {
  try {
    if (fs.existsSync(quickLaunchStore)) {
      return JSON.parse(fs.readFileSync(quickLaunchStore, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function writeQuickLaunch(items) {
  try {
    fs.writeFileSync(quickLaunchStore, JSON.stringify(items, null, 2));
  } catch (e) {}
}

ipcMain.handle('select-app', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Application',
      properties: ['openFile'],
      filters: [
        { name: 'Applications', extensions: ['exe', 'lnk', 'appref-ms', 'bat', 'cmd', 'ps1'] }
      ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      let appPath = result.filePaths[0];
      try {
        const shortcut = shell.readShortcutLink(appPath);
        if (shortcut.target) appPath = shortcut.target;
      } catch (e) {}
      return appPath;
    }
  } catch (e) {}
  return null;
});

ipcMain.handle('get-app-icon', async (_, appPath) => {
  try {
    const icon = await app.getFileIcon(appPath, { size: 'large' });
    return icon.toDataURL();
  } catch (e) {
    console.error('[QuickLaunch] Failed to get icon for', appPath, e);
  }
  return null;
});

ipcMain.handle('launch-app', async (_, appPath) => {
  try {
    await shell.openPath(appPath);
    return true;
  } catch (e) {
    console.error('[QuickLaunch] Failed to launch', appPath, e);
  }
  return false;
});

ipcMain.handle('get-foreground-app', async () => {
  return getLastForegroundApp();
});

// Brings an already-running instance of appPath to the front instead of
// spawning a duplicate, so Quick Start picks up "where you left off".
ipcMain.handle('focus-or-launch-app', async (_, appPath) => {
  try {
    const scriptPath = path.join(__dirname, 'scripts', 'focus-or-launch.ps1');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Path', appPath], { timeout: 5000, windowsHide: true });
    if (stdout && stdout.includes('FOCUSED')) return true;
  } catch (e) {}

  try {
    await shell.openPath(appPath);
    return true;
  } catch (e) {
    console.error('[QuickLaunch] Failed to launch', appPath, e);
  }
  return false;
});

ipcMain.handle('load-quick-launch', async () => {
  return readQuickLaunch();
});

ipcMain.handle('save-quick-launch', async (_, items) => {
  writeQuickLaunch(items);
  return true;
});

ipcMain.handle('get-installed-apps', async () => {
  try {
    const psScript = `
$apps = @()

# 64-bit uninstall key
$uninstall64 = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
# 32-bit uninstall key on 64-bit Windows
$uninstall32 = "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
# Current user uninstall key
$uninstallCU = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"

$paths = @($uninstall64, $uninstall32, $uninstallCU)

foreach ($path in $paths) {
  Get-ItemProperty $path | Where-Object { $_.DisplayName -and $_.DisplayIcon -and $_.SystemComponent -ne 1 } | ForEach-Object {
    $name = $_.DisplayName
    $iconPath = $_.DisplayIcon
    $exePath = $_.InstallLocation + "\\" + $_.DisplayName + ".exe"
    
    # Try to find actual executable
    $actualPath = $null
    if ($_.UninstallString) {
      if ($_.UninstallString -match '"([^"]+)"') {
        $actualPath = $matches[1]
      }
    }
    
    # If no uninstall string path, try DisplayIcon
    if (-not $actualPath -and $iconPath) {
      if ($iconPath -match '"([^"]+)"') {
        $actualPath = $matches[1]
      } else {
        $actualPath = $iconPath
      }
    }
    
    # Clean up path
    if ($actualPath) {
      $actualPath = $actualPath.Trim('"')
      if (Test-Path $actualPath) {
        # If it's an .lnk, resolve it
        if ($actualPath -like "*.lnk") {
          try {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($actualPath)
            $actualPath = $shortcut.TargetPath
          } catch {}
        }
      }
    }
    
    $apps += @{
      name = $name
      path = $actualPath
      icon = $iconPath
    }
  }
}

# Also get Start Menu shortcuts
$startMenuPaths = @(
  "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\*",
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\*"
)

foreach ($smPath in $startMenuPaths) {
  Get-ChildItem $smPath -Recurse -Filter "*.lnk" | ForEach-Object {
    try {
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($_.FullName)
      $target = $shortcut.TargetPath
      if ($target -and (Test-Path $target)) {
        $apps += @{
          name = $_.BaseName
          path = $target
          icon = $target
        }
      }
    } catch {}
  }
}

# Deduplicate by path
$unique = $apps | Group-Object path | ForEach-Object { $_.Group[0] }
$unique | Select-Object name, path, icon | ConvertTo-Json -Depth 3
`

    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 15000, windowsHide: true });
    if (stdout) {
      const apps = JSON.parse(stdout);
      // Fetch icons for each app
      const appsWithIcons = await Promise.all(apps.map(async (app) => {
        let iconDataUrl = null;
        if (app.path) {
          try {
            const icon = await app.getFileIcon(app.path, { size: 'large' });
            iconDataUrl = icon.toDataURL();
          } catch (e) {}
        }
        return { name: app.name, path: app.path, icon: iconDataUrl };
      }));
      return appsWithIcons.filter(a => a.path);
    }
  } catch (e) {
    console.error('[QuickLaunch] Failed to get installed apps:', e);
  }
  return [];
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


// ===== HIDDEN WEBVIEWS =====
let hiddenMessages;
let hiddenGchat;

function createHiddenWindows() {
  const { session } = require('electron');
  const sess = session.fromPartition('persist:messenger');

  // Grant ALL permissions — the Notification interceptor in webview-preload.js
  // catches messages before they become native toasts.
  sess.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  sess.setPermissionCheckHandler(() => true);

  // Use a plain Chrome user agent (strip Electron's "Electron/xx" token, which
  // makes Google treat us as unsupported and skip the QR). Keep the version in
  // sync with the bundled Chromium (Electron 34 = Chromium 132).
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

  const commonOptions = {
    width: 1000, height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.js'),
      nodeIntegration: false,
      contextIsolation: false,       // Needed so preload can inject script tags into page
      backgroundThrottling: false,
      partition: 'persist:messenger'
    }
  };

  // --- Google Messages ---
  hiddenMessages = new BrowserWindow(commonOptions);
  hiddenMessages.webContents.setUserAgent(chromeUA);

  hiddenMessages.webContents.on('did-finish-load', () => {
    const url = hiddenMessages.webContents.getURL();
    console.log('[Messages] Page loaded:', url);

    // Inject the Notification interceptor via executeJavaScript().
    // This bypasses Google's Trusted Types CSP that blocks script.textContent.
    hiddenMessages.webContents.executeJavaScript(`
      (function() {
        if (window.__dynamicNotchInstalled) return;
        window.__dynamicNotchInstalled = true;

        const OriginalNotification = window.Notification;
        if (!OriginalNotification) return;

        function getBase64Image(url, callback) {
          if (!url) return callback('');
          let done = false;
          const finish = (res) => {
            if (done) return;
            done = true;
            callback(res);
          };
          setTimeout(() => finish(''), 500); // 500ms fallback so notifications never get stuck
          
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            try {
              finish(canvas.toDataURL('image/png'));
            } catch(e) { finish(url); }
          };
          img.onerror = function() { finish(url); };
          img.src = url;
        }

        class InterceptedNotification extends OriginalNotification {
          constructor(title, options) {
            super(title, options);
            try {
              getBase64Image(options ? options.icon : '', (base64Icon) => {
                window.postMessage({
                  type: '__DYNAMIC_NOTCH_MSG__',
                  title: title,
                  body: options ? options.body : '',
                  icon: base64Icon
                }, '*');
              });
            } catch(e) {}
          }
        }

        InterceptedNotification.requestPermission = function(cb) {
          if (cb) cb('granted');
          return Promise.resolve('granted');
        };
        Object.defineProperty(InterceptedNotification, 'permission', {
          get() { return 'granted'; },
          configurable: true
        });

        window.Notification = InterceptedNotification;
        console.log('[DynamicNotch] Notification interceptor installed with avatar support.');
      })();
    `).catch(err => console.error('[Messages] Failed to inject interceptor:', err));
  });

  hiddenMessages.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error('[Messages] Load failed:', url, code, desc);
  });

  hiddenMessages.loadURL('https://messages.google.com/web/authentication');
  hiddenMessages.on('close', (e) => {
    e.preventDefault();
    hiddenMessages.hide();
  });

  // --- Google Chat ---
  hiddenGchat = new BrowserWindow(commonOptions);
  hiddenGchat.webContents.setUserAgent(chromeUA);
  hiddenGchat.loadURL('https://chat.google.com/');
  hiddenGchat.on('close', (e) => {
    e.preventDefault();
    hiddenGchat.hide();
  });

}

ipcMain.on('hidden-live-message', (event, data) => {
  console.log('[HiddenMessage] Intercepted from', data.app, data.sender);
  safeSend('live-message', data);
});

// Surfaces the hidden Google Messages window so the user can scan the QR
// pairing code. Shared by the tray menu, the "open-login-window" IPC call,
// and the reply pipeline's not-signed-in fallback below.
function showMessagesLogin() {
  if (!hiddenMessages) return;
  hiddenMessages.setOpacity(1);
  hiddenMessages.show();
  hiddenMessages.setSkipTaskbar(false);
  hiddenMessages.focus();

  // The window is created hidden (show:false), and Chromium skips painting the
  // QR <canvas> while a window is occluded — so it can come up blank. Now that
  // the window is actually visible, reload the auth page so Google regenerates
  // and paints a fresh QR. Only do this when we're not already signed in.
  try {
    const url = hiddenMessages.webContents.getURL();
    if (!url || url.includes('/authentication')) {
      hiddenMessages.webContents.reload();
    }
  } catch (e) {}

  hiddenMessages.removeAllListeners('close');
  hiddenMessages.on('close', (e) => {
    e.preventDefault();
    hiddenMessages.hide();
    hiddenMessages.setSkipTaskbar(true);
    hiddenMessages.setOpacity(0);
  });
}

// Nuclear option for a genuinely corrupt persisted session: wipe the
// messenger partition's storage, then reopen login with a clean slate.
async function resetMessagesSession() {
  if (!hiddenMessages || hiddenMessages.isDestroyed()) return;
  try {
    await hiddenMessages.webContents.session.clearStorageData();
  } catch (e) {
    console.error('[Messages] Failed to clear session:', e.message);
  }
  try {
    await hiddenMessages.loadURL('https://messages.google.com/web/authentication');
  } catch (e) {}
  showMessagesLogin();
}

ipcMain.on('send-reply', (event, payload) => {
  const data = typeof payload === 'string' ? { text: payload } : (payload || {});
  console.log('[HiddenMessage] Sending reply:', data);

  const notSignedIn = hiddenMessages && !hiddenMessages.isDestroyed() &&
    hiddenMessages.webContents.getURL().includes('/authentication');
  if (notSignedIn) {
    console.log('[HiddenMessage] Not signed into Google Messages yet — opening login.');
    showMessagesLogin();
    return;
  }

  if (hiddenMessages && !hiddenMessages.isDestroyed()) {
    hiddenMessages.webContents.send('hidden-send-reply', data);
  }
  if (hiddenGchat && !hiddenGchat.isDestroyed()) {
    hiddenGchat.webContents.send('hidden-send-reply', data);
  }
});

// =============================================

app.whenReady().then(() => {
  initFileTray();
  createHiddenWindows();
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

  startHeartbeat();
  startForegroundMonitor(process.pid);

  globalShortcut.register('CommandOrControl+M', () => {
    safeSend('mock-message');
  });

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

  // ─── Stocks (realtime market data via Yahoo Finance) ───
  let _yf = null;
  const getYF = () => {
    if (!_yf) {
      const YahooFinance = require('yahoo-finance2').default;
      _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    }
    return _yf;
  };
  ipcMain.handle('get-stocks', async (_e, opts) => {
    const DEFAULT = [
      { symbol: '^GSPC', label: 'S&P 500' },
      { symbol: '^DJI',  label: 'DOW' },
      { symbol: '^IXIC', label: 'NASDAQ' },
    ];
    // Watchlist mode passes { symbols: ['AAPL', ...] }; labels come from Yahoo.
    let tickers = DEFAULT;
    if (opts && Array.isArray(opts.symbols) && opts.symbols.length) {
      tickers = opts.symbols
        .map(s => String(s || '').trim().toUpperCase())
        .filter(Boolean)
        .map(s => ({ symbol: s, label: s })); // show the ticker in the narrow card
    }
    const yf = getYF();
    const results = await Promise.all(tickers.map(async (t) => {
      try {
        const q = await yf.quote(t.symbol);
        const prevClose = q.regularMarketPreviousClose ?? q.chartPreviousClose ?? null;
        let spark = [];
        try {
          // Today's intraday shape: 5-minute closes since midnight.
          const start = new Date(); start.setHours(0, 0, 0, 0);
          const ch = await yf.chart(t.symbol, { period1: start, interval: '5m' });
          spark = (ch.quotes || []).map(p => p.close).filter(v => v != null);
        } catch (e) {}
        // Anchor the line at yesterday's close so its direction (and the color
        // we pick from changePct) always agree with the day's actual movement.
        if (prevClose != null) spark = [prevClose, ...spark];
        // Weekend / holiday / pre-market: fall back to a short daily history.
        if (spark.length < 2) {
          try {
            const ch2 = await yf.chart(t.symbol, {
              period1: new Date(Date.now() - 7 * 24 * 3600 * 1000),
              interval: '1d',
            });
            spark = (ch2.quotes || []).map(p => p.close).filter(v => v != null);
          } catch (e) {}
        }
        return {
          symbol: t.symbol,
          label: t.label || q.shortName || q.symbol || t.symbol,
          price: q.regularMarketPrice ?? null,
          change: q.regularMarketChange ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          spark,
        };
      } catch (e) {
        return { symbol: t.symbol, label: t.label || t.symbol, price: null, change: null, changePct: null, spark: [] };
      }
    }));
    return results;
  });

  const { onMediaUpdate } = require('./modules/media');
  onMediaUpdate((data) => {
    safeSend('media-update', data);
  });

  ipcMain.on('open-login-window', () => {
    showMessagesLogin();
  });
});

// ─── Clean shutdown ───
app.on('before-quit', () => {
  globalShortcut.unregisterAll();
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





