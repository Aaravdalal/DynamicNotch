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
    const cmd = `powershell -NoProfile -Command "(Get-Process -Name 'obs64','obs32','OBS','ScreenClip','ScreenSketch','Camtasia','XSplit','Streamlabs OBS' -ErrorAction SilentlyContinue | Select-Object -First 1).ProcessName"`;
    const proc = await execAsync(cmd, 3000);

    if (proc && proc !== '') {
      if (!isRecording) {
        isRecording = true;
        recordingStartTime = Date.now();
      }
      return { recording: true, app: proc, elapsed: Date.now() - recordingStartTime };
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
