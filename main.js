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
ipcMain.handle('get-bluetooth', async () => await getBluetoothDevices());
ipcMain.handle('get-recording', async () => await getRecordingStatus());
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

  const { onMediaUpdate } = require('./modules/media');
  onMediaUpdate((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media-update', data);
    }
  });
});

app.on('window-all-closed', () => app.quit());