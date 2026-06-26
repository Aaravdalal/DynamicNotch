const { spawn } = require('child_process');
const path = require('path');

let callback = null;

function startBluetoothMonitor(onChange) {
  callback = onChange;
  
  const scriptPath = path.join(__dirname, '..', 'scripts', 'bluetooth-monitor.ps1');
  
  try {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    
    p.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const str = line.trim();
        if (str.startsWith('EVENT:')) {
          try {
            const device = JSON.parse(str.substring(6));
            if (callback) callback(device);
          } catch(e) {}
        }
      }
    });

    p.stderr.on('data', console.error);
    p.on('error', () => {});
    
  } catch (e) {
    console.error('Failed to spawn bluetooth monitor', e);
  }
}

// Dummy for backwards compatibility during transition
async function getBluetoothDevices() {
  return [];
}

module.exports = { startBluetoothMonitor, getBluetoothDevices };
