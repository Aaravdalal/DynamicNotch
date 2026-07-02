const { exec } = require('child_process');

let isRecording = false;
let recordingStartTime = null;

function execAsync(cmd, timeout = 3000) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf-8', timeout, windowsHide: true }, (err, stdout) => {
      if (err) resolve('');
      else resolve((stdout || '').trim());
    });
  });
}

async function getRecordingStatus() {
  try {
    const cmd = `powershell -NoProfile -Command "$active = $false; $paths = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged'); foreach ($p in $paths) { if (Test-Path $p) { Get-ChildItem -Path $p | ForEach-Object { $val = Get-ItemProperty -Path $_.PSPath -Name 'LastUsedTimeStop' -ErrorAction SilentlyContinue; if ($val -and $val.LastUsedTimeStop -eq 0) { $active = $true } } } }; if ($active) { Write-Output 'ACTIVE' } else { Write-Output 'INACTIVE' }"`;
    const output = await execAsync(cmd, 3000);

    if (output === 'ACTIVE') {
      if (!isRecording) {
        isRecording = true;
        recordingStartTime = Date.now();
      }
      return { recording: true, app: 'Microphone', elapsed: Date.now() - recordingStartTime };
    } else {
      isRecording = false;
      recordingStartTime = null;
      return { recording: false };
    }
  } catch (e) {
    return { recording: false };
  }
}

module.exports = { getRecordingStatus };
