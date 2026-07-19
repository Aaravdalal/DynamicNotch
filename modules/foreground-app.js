const { spawn } = require('child_process');
const path = require('path');

let lastApp = null;
let monitorProcess = null;

function startForegroundMonitor(excludePid) {
  if (monitorProcess) return;

  const scriptPath = path.join(__dirname, '..', 'scripts', 'foreground-monitor.ps1');

  try {
    monitorProcess = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ExcludePid', String(excludePid)], { windowsHide: true });

    let buffer = '';
    monitorProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const str = line.trim();
        if (str.startsWith('EVENT:')) {
          const parts = str.substring(6).split('|');
          if (parts.length === 2) {
            lastApp = { path: parts[0], name: parts[1] };
          }
        }
      }
    });

    monitorProcess.on('error', () => {
      // Fallback or ignore
    });
  } catch (e) {
    console.error('Failed to spawn foreground monitor', e);
  }
}

function getLastForegroundApp() {
  return lastApp;
}

module.exports = { startForegroundMonitor, getLastForegroundApp };
