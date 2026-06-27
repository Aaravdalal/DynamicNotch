const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notchAPI', {
  getMedia: () => ipcRenderer.invoke('get-media'),
  controlMedia: (action) => ipcRenderer.invoke('control-media', action),
  getCalendar: () => ipcRenderer.invoke('get-calendar'),
  googleCalendarConnect: (config) => ipcRenderer.invoke('google-calendar-connect', config),
  getBluetooth: () => ipcRenderer.invoke('get-bluetooth'),
  getRecording: () => ipcRenderer.invoke('get-recording'),
  startSpeechRecognition: () => ipcRenderer.invoke('start-speech-recognition'),
  transcribeAudio: (pcmData) => ipcRenderer.invoke('transcribe-audio', pcmData),
  getBattery: () => ipcRenderer.invoke('get-battery'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  focusWindow: () => ipcRenderer.send('focus-window'),
  onBatteryUpdate: (callback) => {
    ipcRenderer.on('battery-update', (event, batState) => callback(batState));
  },
  onBluetoothUpdate: (callback) => {
    ipcRenderer.on('bluetooth-update', (event, device) => callback(device));
  },
  onMediaUpdate: (callback) => {
    ipcRenderer.on('media-update', (event, data) => callback(data));
  },
  onLockUpdate: (callback) => {
    ipcRenderer.on('lock-update', (event, str) => callback(str));
  },
  onAudioPeak: (callback) => {
    ipcRenderer.on('audio-peak', (event, val) => callback(val));
  },
  setSysVal: (type, val) => ipcRenderer.invoke('set-sys-val', type, val),
  onSysVol: (callback) => {
    ipcRenderer.on('sys-vol', (event, val) => callback(val));
  },
  onSysBright: (callback) => {
    ipcRenderer.on('sys-bright', (event, val) => callback(val));
  },
  onSysDnd: (callback) => {
    ipcRenderer.on('sys-dnd', (event, val) => callback(val));
  },
  selectProfileImage: () => ipcRenderer.invoke('select-profile-image'),
  loadProfileImage: () => ipcRenderer.invoke('load-profile-image'),
  openCalendar: () => ipcRenderer.invoke('open-calendar'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  fetchWeather: (city) => ipcRenderer.invoke('fetch-weather', city),
  simulateWinH: () => ipcRenderer.invoke('simulate-win-h')
});
