const { spawn } = require('child_process');
const path = require('path');

let batteryState = {
  hasBattery: false,
  isCharging: false,
  percent: 100,
  powerSaver: false
};

let monitorProcess = null;
let callback = null;

function startBatteryMonitor(onChange) {
  callback = onChange;
  
  if (monitorProcess) return;

  const scriptPath = path.join(__dirname, '..', 'scripts', 'battery-monitor.ps1');
  
  try {
    monitorProcess = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    
    monitorProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const str = line.trim();
        if (str.startsWith('EVENT:')) {
          const parts = str.substring(6).split('|');
          if (parts.length === 3) {
            batteryState.hasBattery = true;
            batteryState.isCharging = parts[0] === 'true';
            batteryState.percent = parseInt(parts[1], 10) || 100;
            batteryState.powerSaver = parts[2] === 'true';
            
            if (callback) callback({ ...batteryState });
          }
        }
      }
    });

    monitorProcess.on('error', () => {
      // Fallback or ignore
    });
    
  } catch (e) {
    console.error('Failed to spawn battery monitor', e);
  }
}

function getBatteryStatus() {
  return batteryState;
}

module.exports = { startBatteryMonitor, getBatteryStatus };
