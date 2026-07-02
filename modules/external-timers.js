const { spawn } = require('child_process');
const path = require('path');

let timerProcess = null;

function startExternalTimersMonitor(callback) {
  if (timerProcess) return;

  const scriptPath = path.join(__dirname, '..', 'scripts', 'external-timers.ps1');
  
  const runCheck = () => {
    timerProcess = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', scriptPath], { windowsHide: true });
    
    timerProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('CHROME_TIMER:')) {
          const parts = line.split(':');
          const totalSeconds = parseInt(parts[1], 10);
          const state = parts[2] || 'ACTIVE';
          if (!isNaN(totalSeconds)) callback({ type: 'chrome', seconds: totalSeconds, state });
        } else if (line.startsWith('FOCUS_SESSION:')) {
          const parts = line.split(':');
          const totalSeconds = parseInt(parts[1], 10);
          const state = parts[2] || 'ACTIVE';
          if (!isNaN(totalSeconds)) callback({ type: 'focus', seconds: totalSeconds, state });
        } else if (line.startsWith('RECORDING:')) {
          const parts = line.split(':');
          const state = parts.pop();
          const timeStr = parts.slice(1).join(':');
          callback({ type: 'recording', timeStr, state });
        } else if (line.startsWith('NONE_TIMER')) {
          callback({ type: 'none_timer' });
        } else if (line.startsWith('MIC_ACTIVE')) {
          callback({ type: 'mic_active' });
        } else if (line.startsWith('MIC_PAUSED')) {
          callback({ type: 'mic_paused' });
        } else if (line.startsWith('MIC_INACTIVE')) {
          callback({ type: 'mic_inactive' });
        }
      }
    });
    
    timerProcess.on('close', () => {
      timerProcess = null;
    });
  };

  runCheck();
}

function sendTimerCommand(command) {
  if (command === 'toggleChrome') {
    spawn('powershell.exe', ['-Command', '$c = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match " - Google Search" } | Select-Object -First 1; if ($c) { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($c.Id); Start-Sleep -Milliseconds 50; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(" ") }'], { windowsHide: true });
  } else if (command === 'toggleRecording') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'control-recorder.ps1');
    spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-WindowStyle', 'Hidden', '-File', scriptPath, 'Pause'], { windowsHide: true });
  } else if (command === 'stopRecording') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'control-recorder.ps1');
    spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-WindowStyle', 'Hidden', '-File', scriptPath, 'Stop'], { windowsHide: true });
  }
}

module.exports = { startExternalTimersMonitor, sendTimerCommand };
