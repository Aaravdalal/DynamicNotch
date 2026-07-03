const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notchAPI', {
  getMedia: () => ipcRenderer.invoke('get-media'),
  controlMedia: (action) => ipcRenderer.invoke('control-media', action),
  getCalendar: (targetDate) => ipcRenderer.invoke('get-calendar', targetDate),
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
  onExternalTimerUpdate: (callback) => {
    ipcRenderer.on('external-timer-update', (event, data) => callback(data));
  },
  onDownloadUpdate: (callback) => {
    ipcRenderer.on('download-update', (event, data) => callback(data));
  },
  onAudioPeak: (callback) => {
    ipcRenderer.on('audio-peak', (event, val) => callback(val));
  },
  onMicPeak: (callback) => {
    ipcRenderer.on('mic-peak', (event, val) => callback(val));
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
    onLiveMessage: (callback) => {
    ipcRenderer.on('live-message', (event, data) => callback(data));
  },
  sendReply: (text) => ipcRenderer.send('send-reply', text),
  onMockMessage: (callback) => {
    ipcRenderer.on('mock-message', () => callback());
  },
  onMockCall: (callback) => {
    ipcRenderer.on('mock-call', () => callback());
  },
  selectProfileImage: () => ipcRenderer.invoke('select-profile-image'),
  loadProfileImage: () => ipcRenderer.invoke('load-profile-image'),
  openCalendar: () => ipcRenderer.invoke('open-calendar'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  getYoutubeStream: (id) => ipcRenderer.invoke('get-youtube-stream', id),
  fetchWeather: (city) => ipcRenderer.invoke('fetch-weather', city),
  simulateWinH: () => ipcRenderer.invoke('simulate-win-h'),
  
  // File Tray APIs
  storeFiles: (paths) => ipcRenderer.invoke('store-files', paths),
  getTrayFiles: () => ipcRenderer.invoke('get-tray-files'),
  removeTrayFile: (path) => ipcRenderer.invoke('remove-tray-file', path),
  startDragOut: (path) => ipcRenderer.send('start-drag-out', path),
  onOpenFileTray: (callback) => ipcRenderer.on('open-file-tray', callback),
  openQuickShare: () => ipcRenderer.invoke('open-quickshare'),
  shareFiles: (paths) => ipcRenderer.invoke('share-files', paths),
  onShareInitiated: (callback) => ipcRenderer.on('share-initiated', (event, paths) => callback(paths))
});


