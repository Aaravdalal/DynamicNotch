const { globalShortcut, ipcMain } = require('electron');

module.exports = function initMessages(mainWindow) {
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow && mainWindow.webContents) {
      console.log('[Messages] Sending mock live-message to renderer...');
      mainWindow.webContents.send('live-message', {
        sender: 'Michel',
        text: 'Hello World!',
        app: 'messages',
        time: 'now'
      });
    }
  });

  ipcMain.on('send-reply', (event, text) => {
    console.log('[Messages] Received reply from user:', text);
  });
};
