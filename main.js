const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { getMediaInfo, controlMedia } = require('./modules/media');
const googleCalendar = require('./modules/google-calendar');
const { startBluetoothMonitor } = require('./modules/bluetooth');
const { getRecordingStatus } = require('./modules/recording');
const { startBatteryMonitor, getBatteryStatus } = require('./modules/battery');
const { spawn } = require('child_process');

let mainWindow;
let tray;
const userDataPath = app.getPath('userData');
const profileImageStore = path.join(userDataPath, 'profileImage.json');

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

  startBatteryMonitor((batState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('battery-update', batState);
    }
  });

  startBluetoothMonitor((device) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bluetooth-update', device);
    }
  });

  try {
    const lockMonitorProcess = spawn(path.join(__dirname, 'scripts', 'lock-monitor.exe'), [], { windowsHide: true });
    lockMonitorProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const str = line.trim();
        if (str.startsWith('EVENT:')) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('lock-update', str.substring(6));
          }
        }
      }
    });

    // Start Audio Peak Meter
    const audioMeterProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'audio-meter.ps1')], { windowsHide: true });
    let audioBuffer = '';
    audioMeterProc.stdout.on('data', (data) => {
      audioBuffer += data.toString();
      const lines = audioBuffer.split(/\r?\n/);
      audioBuffer = lines.pop(); // keep partial line for next chunk
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('PEAK:')) {
          const val = parseInt(trimmed.substring(5));
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('audio-peak', val);
          }
        }
      }
    });

    // Start Sys Monitor (Volume & Brightness)
    const sysMonitorProc = spawn(path.join(__dirname, 'scripts', 'sys-monitor.exe'), [], { windowsHide: true });
    let sysBuffer = '';
    sysMonitorProc.stdout.on('data', (data) => {
      sysBuffer += data.toString();
      const lines = sysBuffer.split(/\r?\n/);
      sysBuffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('VOL|')) {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sys-vol', parseInt(trimmed.substring(4)));
        } else if (trimmed.startsWith('BRIGHT|')) {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sys-bright', parseInt(trimmed.substring(7)));
        } else if (trimmed.startsWith('DND|')) {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sys-dnd', parseInt(trimmed.substring(4)));
        }
      }
    });
  } catch(e) {}
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Notch', click: () => mainWindow.show() },
    { label: 'Test AirPods', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bluetooth-update', {name: "AirPods", connected: true, battery: 72, type: "earbuds"});
        }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Dynamic Notch');
  tray.setContextMenu(contextMenu);
}

ipcMain.handle('control-media', async (_, action) => await controlMedia(action));
ipcMain.handle('set-sys-val', async (_, type, val) => {
  const p = spawn(path.join(__dirname, 'scripts', 'sys-monitor.exe'), [type, val.toString()]);
  return true;
});

ipcMain.handle('simulate-win-h', async () => {
  require('child_process').execFile(path.join(__dirname, 'scripts', 'sys-monitor.exe'), ['winH']);
  return true;
});

ipcMain.handle('get-bluetooth', async () => await getBluetoothDevices());
ipcMain.handle('get-recording', async () => await getRecordingStatus());

ipcMain.handle('start-speech-recognition', async () => {
  return new Promise((resolve) => {
    const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'speech-recognizer.ps1')], { windowsHide: true });
    
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
  });
});

ipcMain.handle('transcribe-audio', async (e, pcmData) => {
  return new Promise((resolve) => {
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
  });
});

ipcMain.handle('get-battery', async () => await getBatteryStatus());
ipcMain.handle('get-calendar', async () => await googleCalendar.getEvents());
ipcMain.handle('google-calendar-connect', async (e, config) => {
    googleCalendar.saveConfig({ ...config, connected: true });
    return { success: true };
});

ipcMain.handle('open-calendar', () => {
  require('child_process').exec('start outlookcal:');
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
  return null;
});

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
      mainWindow.setFocusable(!ignore);
    }
  });

  ipcMain.on('focus-window', () => {
    if (mainWindow) {
      mainWindow.setFocusable(true);
      mainWindow.focus();
    }
  });

app.whenReady().then(() => {
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

  ipcMain.handle('get-media', async () => getMediaInfo());
  
  const weather = require('weather-js');
  ipcMain.handle('fetch-weather', async (_, city) => {
    return new Promise((resolve, reject) => {
      weather.find({search: city, degreeType: 'F'}, function(err, result) {
        if(err) resolve(null);
        else resolve(result[0] || null);
      });
    });
  });

  ipcMain.handle('fetch-hourly-weather', async (_, city) => {
    return new Promise((resolve) => {
      const https = require('https');
      https.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const geo = JSON.parse(data);
            if (!geo.results || geo.results.length === 0) return resolve(null);
            const lat = geo.results[0].latitude;
            const lon = geo.results[0].longitude;
            https.get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weathercode&temperature_unit=fahrenheit&timezone=auto`, (res2) => {
              let wdata = '';
              res2.on('data', c => wdata += c);
              res2.on('end', () => {
                try { resolve(JSON.parse(wdata)); } catch(e) { resolve(null); }
              });
            });
          } catch(e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  });

  ipcMain.handle('fetch-stocks', async (_, symbols) => {
    return new Promise((resolve) => {
      const https = require('https');
      const results = [];
      let completed = 0;
      if (!symbols || symbols.length === 0) return resolve([]);
      
      symbols.forEach(symbol => {
        https.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const meta = json.chart.result[0].meta;
              results.push({ symbol: meta.symbol, price: meta.regularMarketPrice, previousClose: meta.chartPreviousClose });
            } catch(e) {}
            completed++;
            if (completed === symbols.length) resolve(results);
          });
        }).on('error', () => {
          completed++;
          if (completed === symbols.length) resolve(results);
        });
      });
    });
  });

  ipcMain.handle('fetch-sports', async () => {
    return new Promise((resolve) => {
      const https = require('https');
      https.get('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  });

  const configPath = path.join(app.getPath('userData'), 'config.json');
  ipcMain.handle('get-config', () => {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e) { return {}; }
  });
  ipcMain.handle('save-config', (_, cfg) => {
    try {
      const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
      fs.writeFileSync(configPath, JSON.stringify({ ...existing, ...cfg }));
      return true;
    } catch(e) { return false; }
  });

  ipcMain.handle('ask-gaming-ai', async (_, prompt, key) => {
    return new Promise((resolve) => {
      const https = require('https');
      const data = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
      const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
      }, (res) => {
        let respData = '';
        res.on('data', c => respData += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(respData);
            if (json.candidates && json.candidates[0].content) {
              resolve(json.candidates[0].content.parts[0].text);
            } else {
              resolve('AI Error: Unexpected response.');
            }
          } catch(e) { resolve('AI Error: ' + e.message); }
        });
      });
      req.on('error', (e) => resolve('API Error: ' + e.message));
      req.write(data);
      req.end();
    });
  });

  const { onMediaUpdate } = require('./modules/media');
  onMediaUpdate((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media-update', data);
    }
  });
});

app.on('window-all-closed', () => app.quit());