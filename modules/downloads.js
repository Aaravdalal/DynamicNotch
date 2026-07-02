const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let watcher = null;
let activeDownloads = new Set();
let downloadTimer = null;

function startDownloadsMonitor(callback) {
  const downloadsPath = app.getPath('downloads');
  
  if (fs.existsSync(downloadsPath)) {
    try {
      watcher = fs.watch(downloadsPath, (eventType, filename) => {
        if (!filename) return;
        
        const isTemp = filename.endsWith('.crdownload') || filename.endsWith('.part') || filename.endsWith('.opdownload');
        
        if (isTemp) {
          if (!activeDownloads.has(filename)) {
            activeDownloads.add(filename);
            callback({ state: 'downloading', filename: filename.replace(/\.(crdownload|part|opdownload)$/, '') });
          }
        } else {
          if (activeDownloads.size > 0) {
            clearTimeout(downloadTimer);
            downloadTimer = setTimeout(() => {
              let completedAny = false;
              for (const tempFile of activeDownloads) {
                const fullPath = path.join(downloadsPath, tempFile);
                if (!fs.existsSync(fullPath)) {
                  activeDownloads.delete(tempFile);
                  completedAny = true;
                }
              }
              if (completedAny) {
                callback({ state: 'complete', filename: filename });
              }
            }, 500);
          }
        }
      });
    } catch (e) {
      console.error('Error watching downloads folder:', e);
    }
  }
  
  // Track Electron app internal downloads
  app.whenReady().then(() => {
    const { session } = require('electron');
    session.defaultSession.on('will-download', (event, item, webContents) => {
      const name = item.getFilename();
      callback({ state: 'downloading', filename: name });
      
      item.on('updated', (event, state) => {
        if (state === 'progressing') {
          callback({ state: 'downloading', filename: name });
        }
      });
      item.once('done', (event, state) => {
        if (state === 'completed') {
          callback({ state: 'complete', filename: name });
        }
      });
    });
  });
}

module.exports = { startDownloadsMonitor };
